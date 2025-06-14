import { AtpAgent, AtpSessionData, AtpSessionEvent } from "@atproto/api";
import { RESPONSE } from './test';
import * as util from './general-util';
import * as apiUtil from './api-object-util';
import { AdvisoryPost, ContentEqualitySet, GetAdvisoriesResponse, Line, Lines, ServiceAlert } from './types';

const logger: util.Logger = new util.Logger(process.env.LOG_LEVEL ?? "debug");

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
const runIntervalJitterMs: number = process.env.RUN_INTERVAL_JITTER_MS ? parseInt(process.env.RUN_INTERVAL_JITTER_MS) : 30000;
const runIntervalMinutes: number = process.env.RUN_INTERVAL_MINUTES ? parseInt(process.env.RUN_INTERVAL_MINUTES) : 30;
const runIntervalMs: number = runIntervalMinutes * 60 * 1000;
logger.info('run interval (minutes)', runIntervalMinutes, 'run interval jitter (ms)', runIntervalJitterMs);
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
const startUpDate = new Date();
let lastRunDate = new Date((new Date()).getTime() - runIntervalMs);
let loopCount = 0;
let knownPostedIds = new Set<string>();

const getAffectedLines = (serviceAlert: ServiceAlert): Line[] => {
    return serviceAlert.Alert.InformedEntity
        .filter(informedEntity => {
            const affectedLine = Lines.getLineByDatabaseId(informedEntity.Id);
            return affectedLine && linesToPost.indexOf(affectedLine.id) >= 0;
        })
        // cast to Line since we already know these are safe
        .map(informedEntity => Lines.getLineByDatabaseId(informedEntity.Id) as Line);
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

const filterToRelevantAlerts = (serviceAlerts: ServiceAlert[]): ServiceAlert[] => {
    return serviceAlerts
        // filter out things we know we've already posted or rejected for posting
        .filter(serviceAlert => {
            const keep = !knownPostedIds.has(serviceAlert.Id);
            if (!keep) {
                logger.debug('not posting: already posted or rejected', serviceAlert.Id);
            }
            return keep;
        })
        // filter to lines we care about
        .filter(serviceAlert => {
            const keep = getAffectedLines(serviceAlert).length > 0;
            if (!keep) {
                // don't have to check this alert again this run
                knownPostedIds.add(serviceAlert.Id);
                logger.debug('not posting: affected lines are not in lines to post', serviceAlert.Id);
            }
            return keep;
        })
        // filter out non-english alerts
        .filter(serviceAlert => {
            const keep = apiUtil.getEnHeader(serviceAlert) !== undefined;
            if (!keep) {
                // don't have to check this alert again this run
                knownPostedIds.add(serviceAlert.Id);
                logger.debug('not posting: header empty', serviceAlert.Id);
            }
            return keep;
        })
        // filter out things that weren't posted since the last time we ran
        .filter(serviceAlert => {
            // sort active periods by start, in descending order
            serviceAlert.Alert.ActivePeriod.sort(apiUtil.activePeriodsByStart).reverse();

            // account for jitter as well
            const lastRunInterval = util.msElapsedSince(lastRunDate.getTime());
            const currentRunActivePeriod = apiUtil.getCurrentRunActivePeriod(serviceAlert.Alert.ActivePeriod, lastRunInterval, logger);

            // turns out the advisories page can be >5 minutes behind, so check against startup time too
            const activePeriodSinceStartup = apiUtil.getActivePeriodSinceStartup(serviceAlert.Alert.ActivePeriod, startUpDate.getTime(), logger);

            const keep = currentRunActivePeriod !== undefined || activePeriodSinceStartup !== undefined;

            if (!keep) {
                // if there's only one active period and we aren't in it, then we don't have to check this alert again this run
                if (serviceAlert.Alert.ActivePeriod.length === 1) {
                    knownPostedIds.add(serviceAlert.Id);
                }
                if (currentRunActivePeriod === undefined) {
                    logger.debug('not posting: no active period within current run interval', serviceAlert.Id);
                }
                if (activePeriodSinceStartup === undefined) {
                    logger.debug('not posting: no active period within startup period', serviceAlert.Id);
                }
            }

            return keep;
        });
}

const convertAlertsToPosts = (serviceAlerts: ServiceAlert[]): AdvisoryPost[] => {
    return serviceAlerts.flatMap(serviceAlert => {
        const affectedLines = getAffectedLines(serviceAlert);
        // Maintain a content-comparing set so we don't post the exact same message across multiple lines,
        // ie when post contains all line names already and does not require differentiation.
        const posts = new ContentEqualitySet<AdvisoryPost>();

        const header = `${apiUtil.getEnHeader(serviceAlert).Text}`;
        const description = apiUtil.getEnDescription(serviceAlert);

        affectedLines.forEach((line: Line) => {
            let message = `${header}`;

            if (description) {
                message += ` ${description.Text}`;
            }

            // If the message doesn't include the line, then we'll add our short name
            if (message.indexOf(line.externalId) < 0) {
                message = `(${line.shortName}) ${message}`;
            }

            if (message.length > maxPostLength) {
                const chunks = util.chunkMessage(message, maxPostLength);

                chunks.forEach((chunk: string, index: number) => {
                    const messageChunk = `(${index + 1}/${chunks.length}) ${chunk}`;
                    posts.add(new AdvisoryPost(serviceAlert.Id, messageChunk));
                });
            } else {
                posts.add(new AdvisoryPost(serviceAlert.Id, message));
            }
        });

        return posts.values();
    });
}

const postAll = async (posts: AdvisoryPost[]): Promise<string[]> => {
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
                        return '';
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

function main(): void {
    logger.info('loop count', loopCount);
    logger.info('post/reject count', knownPostedIds.size);

    getServiceAdvisories()
        .then(json => {
            const serviceAlerts = (json as GetAdvisoriesResponse).Alerts.ServiceAlerts;
            logger.debug('received advisories with ids', serviceAlerts.map(serviceAlert => serviceAlert.Id).join(','));
            logger.debug('received advisories for lines', serviceAlerts
                .flatMap(serviceAlert => serviceAlert.Alert.InformedEntity)
                .map(informedEntity => informedEntity.Id)
                .filter(id => id !== 0)
                .join(','));
            return filterToRelevantAlerts(serviceAlerts);
        })
        .then(convertAlertsToPosts)
        .then(posts => {
            if (posts.length > 0) {
                logger.debug('posting all', posts.join(','));
                logger.info('posting count', posts.length);
            } else {
                logger.debug('nothing to post');
            }
            return postAll(posts);
        })
        .then(postedIds => {
            if (postedIds.length > 0) {
                logger.info('marking posted', postedIds.join(','));
            }
            postedIds.forEach(id => knownPostedIds.add(id));

            lastRunDate = new Date();
        })
        .catch(e => {
            if (e instanceof Error) {
                logger.error(e.message);
            } else {
                logger.error(e);
            }
        });
}

main();

if (linesToPost.length > 0) {
    util.jitterInterval(main, runIntervalMs, runIntervalJitterMs);
} else {
    logger.error('env has empty set of lines to post');
}
