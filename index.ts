import { AtpAgent } from "@atproto/api";
import { RESPONSE } from './test';
import { AdvisoryPost, Lines, LineServiceAdvisory, TYPE_SERVICE_ADVISORY } from './types';

const RUN_INTERVAL_MINUTES = 1;
const RUN_INTERVAL_MS = RUN_INTERVAL_MINUTES * 60 * 1000;
const LINES_TO_POST = [Lines.IEOC.externalId]

const agent = new AtpAgent({ service: 'https://bsky.social' });

const serviceUrl: string = process.env.SERVICE_URL ?? '';
const dataRequestEnabled: boolean = process.env.DATA_REQUEST_ENABLED === 'true';
// only post if we're also getting real data
const postingEnabled: boolean = dataRequestEnabled && process.env.POSTING_ENABLED === 'true';

let knownPostedIds: number[] = [];

const postedInIntervalMs = (timestamp: string, intervalMs: number): boolean => {
    const now = new Date();
    const postDate = new Date(timestamp);

    const intervalEnd = now.getTime();
    const intervalStart = intervalEnd - intervalMs;
    const postTime = postDate.getTime();

    return postTime >= intervalStart && postTime <= intervalEnd;
}

const getServiceAdvisories = (): Promise<any> => {
    // if using local env then return a promise that resolves our test data
    if (!dataRequestEnabled) {
        console.log('using local data');
        return new Promise(resolve => resolve(JSON.parse(RESPONSE)));
    }

    if (!serviceUrl) {
        throw new Error('env has no service url configured');
    }

    // plain GET, no options needed
    return fetch(serviceUrl)
        .then(response => response.json())
        .catch(error => {
            console.error('failed to fetch advisories');
            throw error;
        });
}

const getPostsFromAdvisories = (lineServiceAdvisories: LineServiceAdvisory[]): AdvisoryPost[] => {
    return lineServiceAdvisories
        // only attempt to post lines we know about
        .filter(lineAdvisory => Lines.getLineByExternalId(lineAdvisory.LineAbbreviation) !== undefined)
        // filter to lines we care about
        .filter(lineAdvisory => LINES_TO_POST.indexOf(lineAdvisory.LineAbbreviation) >= 0)
        // collect our service advisories
        .flatMap(lineAdvisory => lineAdvisory.ServiceAdvisories)
        // filter out non-advisories
        .filter(serviceAdvisory => serviceAdvisory.Type === TYPE_SERVICE_ADVISORY)
        // filter out empty messages
        .filter(serviceAdvisory => serviceAdvisory.Message.trim())
        // filter out things we already posted during this run
        .filter(serviceAdvisory => knownPostedIds.indexOf(serviceAdvisory.Id) < 0)
        // filter out things that weren't posted since the last time we ran
        .filter(serviceAdvisory => postedInIntervalMs(serviceAdvisory.Timestamp, RUN_INTERVAL_MS))
        .map(serviceAdvisory => {
            // If the message doesn't include the line, then we'll add our short name
            if (serviceAdvisory.Message.indexOf(serviceAdvisory.Line) < 0) {
                const line = Lines.getLineByExternalId(serviceAdvisory.Line);
                return new AdvisoryPost(
                    serviceAdvisory.Id,
                    `(${line?.shortName}) ${serviceAdvisory.Message}`
                )
            }

            return new AdvisoryPost(serviceAdvisory.Id, serviceAdvisory.Message)
        });
}

const postAll = async (posts: AdvisoryPost[]): Promise<number[]> => {
    if (!postingEnabled) {
        return new Promise(resolve => {
            resolve(posts.map(post => {
                console.log('pretend posting', post.message);
                return post.id;
            }));
        });
    }

    try {
        const id = process.env.BLUESKY_ID;
        const pass = process.env.BLUESKY_PASS;

        if (!id || !pass) {
            throw new Error('env has no id or no pass');
        }

        await agent.login({ identifier: id, password: pass });

        return Promise.all(posts.map(post => {
            return agent.post({ text: post.message })
                .then((response) => {
                    return post.id;
                });
        }))
    } catch (error) {
        console.error('failed to post advisories');
        throw error;
    }
}

async function main() {
    try {
        getServiceAdvisories()
            .then(json => getPostsFromAdvisories(json as LineServiceAdvisory[]))
            .then(posts => postAll(posts))
            .then(postedIds => postedIds.forEach(id => knownPostedIds.push(id)));
    } catch (e) {
        if (e instanceof Error) {
            console.error(e.message);
        } else {
            console.error(e);
        }
    }
}

main();

setInterval(main, RUN_INTERVAL_MS);
