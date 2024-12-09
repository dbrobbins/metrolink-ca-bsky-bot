import { AtpAgent, AtpSessionData, AtpSessionEvent } from "@atproto/api";
import { RESPONSE } from './test';
import * as util from './util';
import { AdvisoryPost, Lines, LineServiceAdvisory, TYPE_SERVICE_ADVISORY } from './types';

const RUN_INTERVAL_MINUTES: number = process.env.RUN_INTERVAL_MINUTES ? parseInt(process.env.RUN_INTERVAL_MINUTES) : 30;
const RUN_INTERVAL_MS = RUN_INTERVAL_MINUTES * 60 * 1000;

const logger: util.Logger = new util.Logger(process.env.LOG_LEVEL);

const linesToPost = (() => {
    let toPost: string[] = [];

    if (process.env.LINES_TO_POST) {
        process.env.LINES_TO_POST.split(',').forEach(lineId => {
            const resolvedLine = Lines.getLineById(lineId);
            if (resolvedLine) {
                toPost.push(resolvedLine.externalId);
            }
        });
    }

    return toPost;
})();
logger.info('lines to post', linesToPost);
const serviceUrl: string = process.env.SERVICE_URL ?? '';
logger.info('service url', serviceUrl);
const serviceUrlWithQuery = serviceUrl + '?lines=' + linesToPost.join('&lines=');
logger.info('service url with query', serviceUrlWithQuery);
const dataRequestEnabled: boolean = process.env.DATA_REQUEST_ENABLED === 'true';
logger.info('data request enabled', dataRequestEnabled);
// only post if we're also getting real data
const postingEnabled: boolean = dataRequestEnabled && process.env.POSTING_ENABLED === 'true';
logger.info('posting enabled', postingEnabled);

let atpSessionData: AtpSessionData | undefined = undefined;
const agent = new AtpAgent({
    service: 'https://bsky.social',
    persistSession: (event: AtpSessionEvent, session?: AtpSessionData) => {
        atpSessionData = session;
        logger.debug('session persisted in memory');
    }
});
let loopCount = 0;
let knownPostedIds: number[] = [];
let isOnline = false;

const postedInIntervalMs = (timestamp: string, intervalMs: number): boolean => {
    // timezone-adjusted now
    const now = util.getPtNow();
    // post date already timezone-adjusted
    const postDate = new Date(timestamp);

    const intervalEnd = now.getTime();
    const intervalStart = intervalEnd - intervalMs;
    const postTime = postDate.getTime();

    return postTime >= intervalStart && postTime <= intervalEnd;
}

const getServiceAdvisories = (): Promise<any> => {
    // if using local env then return a promise that resolves our test data
    if (!dataRequestEnabled) {
        logger.warn('using local data');
        return new Promise(resolve => resolve(JSON.parse(RESPONSE)));
    }

    if (!serviceUrl) {
        throw new Error('env has no service url configured');
    }

    logger.debug('fetching data');
    loopCount += 1;

    // plain GET, no options needed
    return fetch(serviceUrlWithQuery)
        .then(response => response.json())
        .catch(error => {
            logger.error('failed to fetch advisories');
            throw error;
        });
}

const getPostsFromAdvisories = (lineServiceAdvisories: LineServiceAdvisory[]): AdvisoryPost[] => {
    return lineServiceAdvisories
        // only attempt to post lines we know about
        .filter(lineAdvisory => Lines.getLineByExternalId(lineAdvisory.LineAbbreviation) !== undefined)
        // filter to lines we care about
        .filter(lineAdvisory => linesToPost.indexOf(lineAdvisory.LineAbbreviation) >= 0)
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
    try {
        const id = process.env.BLUESKY_ID;
        const pass = process.env.BLUESKY_PASS;

        if (!id || !pass) {
            throw new Error('env has no id or no pass');
        }

        if (postingEnabled && posts.length > 0) {
            if (atpSessionData) {
                logger.debug('resuming session');
                await agent.resumeSession(atpSessionData);
            } else {
                logger.debug('logging in');
                await agent.login({ identifier: id, password: pass });
            }
        }

        return Promise.all(posts.map(async (post, index) => {
            // force a wait
            await new Promise(resolve => setTimeout(resolve, 500 * index));

            if (postingEnabled) {
                logger.debug('attempting to post', post.message);
                return agent.post({ text: post.message })
                    .then((response) => {
                        logger.debug('post response', response);
                        logger.info('posted', post.message);
                        return post.id;
                    });
            }

            logger.warn('pretend posting', post.message);
            return post.id;
        }))
    } catch (error) {
        logger.error('failed to post advisories');
        throw error;
    }
}

function online() {
    const now = util.getPtNow();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();

    // Sat / Sun 6a-11p
    if (currentDay === 6 || currentDay === 0) {
        return currentHour >= 6 && currentHour < 23;
    }

    // Mon-Fri 4a-11:30p
    return currentHour >= 4 && !(currentHour === 23 && currentMinute > 30);
}

function main() {
    logger.info('loop count', loopCount);
    logger.info('post count', knownPostedIds.length);

    // don't make requests when things aren't getting posted
    if (!online()) {
        if (isOnline) {
            isOnline = false;
            logger.info('going offline...');
        }
        return;
    }

    if (!isOnline) {
        isOnline = true;
        logger.info('coming online...');
    }

    try {
        getServiceAdvisories()
            .then(json => {
                console.debug('data fetch response', json);
                const lineAdvisories = json as LineServiceAdvisory[];
                console.info('received advisories for lines', lineAdvisories.map(lineAdvisory => lineAdvisory.LineAbbreviation).join(','));
                return getPostsFromAdvisories(lineAdvisories);
            })
            .then(posts => {
                console.debug('posting all', posts);
                console.info('posting count', posts.length);
                return postAll(posts);
            })
            .then(postedIds => {
                console.info('marking posted', postedIds);
                postedIds.forEach(id => knownPostedIds.push(id));
            });
    } catch (e) {
        if (e instanceof Error) {
            logger.error(e.message);
        } else {
            logger.error(e);
        }
    }
}

main();

if (linesToPost.length > 0) {
    setInterval(main, RUN_INTERVAL_MS);
} else {
    logger.error('env has empty set of lines to post');
}
