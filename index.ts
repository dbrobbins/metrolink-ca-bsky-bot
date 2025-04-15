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
logger.info('lines to post', linesToPost.join(','));
const serviceUrl: string = process.env.SERVICE_URL ?? '';
logger.info('service url', serviceUrl);
const serviceUrlWithQuery = serviceUrl + '?lines=' + linesToPost.join('&lines=');
logger.info('service url with query', serviceUrlWithQuery);
const dataRequestEnabled: boolean = process.env.DATA_REQUEST_ENABLED === 'true';
logger.info('data request enabled', dataRequestEnabled);
// only post if we're also getting real data
const postingEnabled: boolean = dataRequestEnabled && process.env.POSTING_ENABLED === 'true';
logger.info('posting enabled', postingEnabled);
const maxPostLength: number = process.env.MAX_POST_LENGTH ? parseInt(process.env.MAX_POST_LENGTH) : 290;
logger.info('max post length', maxPostLength);

let atpSessionData: AtpSessionData | undefined = undefined;
const agent = new AtpAgent({
    service: 'https://bsky.social',
    persistSession: (event: AtpSessionEvent, session?: AtpSessionData) => {
        atpSessionData = session;
        logger.debug('session persisted in memory');
    }
});
const startUpDate = util.getPtNow();
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

    logger.debug('now', now.toISOString(), 'postDate', postDate.toISOString(), 'postTime', postTime, 'range', intervalStart, '-', intervalEnd);

    return postTime >= intervalStart && postTime <= intervalEnd;
}

const postedSinceStartUp = (timestamp: string): boolean => {
    const now = util.getPtNow();

    return postedInIntervalMs(timestamp, now.getTime() - startUpDate.getTime());
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

    // plain GET with manual cache-busting by adding to the lines arg
    return fetch(`${serviceUrlWithQuery}&lines=${loopCount}`)
        .then(response => {
            logger.debug('cf-cache-status', response.headers.get("cf-cache-status"), 'date', response.headers.get('date'));
            return response.json();
        })
        .catch(error => {
            logger.error('failed to fetch advisories');
            throw error;
        });
}

const getPostsFromAdvisories = (lineServiceAdvisories: LineServiceAdvisory[]): AdvisoryPost[] => {
    return lineServiceAdvisories
        // only attempt to post lines we know about
        .filter(lineAdvisory => {
            const keep = Lines.getLineByExternalId(lineAdvisory.LineAbbreviation) !== undefined;
            if (!keep) logger.debug('not posting: unrecognized external id', lineAdvisory.LineAbbreviation);
            return keep;
        })
        // filter to lines we care about
        .filter(lineAdvisory => {
            const keep = linesToPost.indexOf(lineAdvisory.LineAbbreviation) >= 0;
            if (!keep) logger.debug('not posting: not in lines to post', lineAdvisory.LineAbbreviation);
            return keep;
        })
        // collect our service advisories
        .flatMap(lineAdvisory => lineAdvisory.ServiceAdvisories)
        // filter out non-advisories
        .filter(serviceAdvisory => {
            const keep = serviceAdvisory.Type === TYPE_SERVICE_ADVISORY;
            if (!keep) logger.debug('not posting: not of type service advisory', serviceAdvisory.Id, serviceAdvisory.Type);
            return keep;
        })
        // filter out empty messages
        .filter(serviceAdvisory => {
            const keep = serviceAdvisory.Message.trim();
            if (!keep) logger.debug('not posting: message empty', serviceAdvisory.Id);
            return keep;
        })
        // filter out things we already posted during this run
        .filter(serviceAdvisory => {
            const keep = knownPostedIds.indexOf(serviceAdvisory.Id) < 0;
            if (!keep) logger.debug('not posting: already posted', serviceAdvisory.Id);
            return keep;
        })
        // filter out things that weren't posted since the last time we ran
        .filter(serviceAdvisory => {
            const insideRunInterval = postedInIntervalMs(serviceAdvisory.Timestamp, RUN_INTERVAL_MS);
            // turns out the advisories page can be >5 minutes behind, so check against startup time too
            const insideStartUpIntervalAndNotPosted = postedSinceStartUp(serviceAdvisory.Timestamp) && knownPostedIds.indexOf(serviceAdvisory.Id) < 0;
            logger.debug('age check: inside run interval?', insideRunInterval, serviceAdvisory.Id, serviceAdvisory.Timestamp);
            logger.debug('age check: unposted inside startup interval?', insideRunInterval, serviceAdvisory.Id, serviceAdvisory.Timestamp);
            return insideRunInterval || insideStartUpIntervalAndNotPosted;
        })
        .flatMap(serviceAdvisory => {
            // Since we can end up posting on a delay, always include the post time.
            let message = `${serviceAdvisory.Message} (${serviceAdvisory.Timestamp})`;

            // If the message doesn't include the line, then we'll add our short name
            if (message.indexOf(serviceAdvisory.Line) < 0) {
                const line = Lines.getLineByExternalId(serviceAdvisory.Line);
                message = `(${line?.shortName}) ${message}`;
            }

            if (message.length > maxPostLength) {
                const chunks = util.chunkMessage(message, maxPostLength);

                return chunks.map((chunk, index) => {
                    const chunkedMessage = `(${index + 1}/${chunks.length}) ${chunk}`;
                    return new AdvisoryPost(serviceAdvisory.Id, chunkedMessage);
                });
            }

            return [new AdvisoryPost(serviceAdvisory.Id, message)];
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
                    })
                    .catch(error => {
                        logger.error('failed to post', post.message);
                        logger.error('with error', error.message);
                        return 0;
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
                const lineAdvisories = json as LineServiceAdvisory[];
                logger.debug('received advisories for lines', lineAdvisories.map(lineAdvisory => lineAdvisory.LineAbbreviation).join(','));
                logger.debug('received service advisories with ids', lineAdvisories
                    .flatMap(lineAdvisory => lineAdvisory.ServiceAdvisories)
                    .map(serviceAdvisory => serviceAdvisory.Id)
                    .join(','));
                return getPostsFromAdvisories(lineAdvisories);
            })
            .then(posts => {
                if (posts.length > 0) {
                    logger.debug('posting all', posts.join(','));
                    logger.info('posting count', posts.length);
                }
                return postAll(posts);
            })
            .then(postedIds => {
                if (postedIds.length > 0) {
                    logger.info('marking posted', postedIds.join(','));
                }
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
