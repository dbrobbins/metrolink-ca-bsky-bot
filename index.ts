import { AtpAgent, AtpSessionData, AtpSessionEvent } from "@atproto/api";
import { RESPONSE } from './test';
import * as util from './general-util';
import * as apiUtil from './api-object-util';
import { ActivePeriod, AdvisoryPost, GetAdvisoriesResponse, Line, Lines, ServiceAlert, Translation, TRANSLATION_EN } from './types';

const RUN_INTERVAL_JITTER_MS: number = process.env.RUN_INTERVAL_JITTER_MS ? parseInt(process.env.RUN_INTERVAL_JITTER_MS) : 30000;
const RUN_INTERVAL_MINUTES: number = process.env.RUN_INTERVAL_MINUTES ? parseInt(process.env.RUN_INTERVAL_MINUTES) : 30;
const RUN_INTERVAL_MS: number = RUN_INTERVAL_MINUTES * 60 * 1000;

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
let loopCount = 0;
let knownPostedIds: string[] = [];
let isOnline = false;

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

    // always check server for new data according to cache headers
    return fetch(serviceUrlWithQuery, { cache: 'no-cache' })
        .then(response => {
            logger.debug('cf-cache-status', response.headers.get("cf-cache-status"), 'date', response.headers.get('date'));
            return response.json();
        })
        .catch(error => {
            logger.error('failed to fetch advisories');
            throw error;
        });
}

const getPostsFromServiceAlerts = (serviceAlerts: ServiceAlert[]): AdvisoryPost[] => {
    return serviceAlerts
        // filter out things we know we've already posted or rejected for posting
        .filter(serviceAlert => {
            const keep = knownPostedIds.indexOf(serviceAlert.Id) < 0;
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
                knownPostedIds.push(serviceAlert.Id);
                logger.debug('not posting: affected lines are not in lines to post', serviceAlert.Id);
            }
            return keep;
        })
        // filter out non-english alerts
        .filter(serviceAlert => {
            const keep = apiUtil.getEnHeader(serviceAlert) !== undefined;
            if (!keep) {
                // don't have to check this alert again this run
                knownPostedIds.push(serviceAlert.Id);
                logger.debug('not posting: header empty', serviceAlert.Id);
            }
            return keep;
        })
        // filter out things that weren't posted since the last time we ran
        .filter(serviceAlert => {
            // sort active periods by start, in descending order
            serviceAlert.Alert.ActivePeriod.sort(apiUtil.activePeriodsByStart).reverse();

            const currentRunActivePeriod = apiUtil.getCurrentRunActivePeriod(serviceAlert.Alert.ActivePeriod, RUN_INTERVAL_MS, logger);

            // turns out the advisories page can be >5 minutes behind, so check against startup time too
            const activePeriodSinceStartup = apiUtil.getActivePeriodSinceStartup(serviceAlert.Alert.ActivePeriod, startUpDate.getTime(), logger);

            const keep = currentRunActivePeriod !== undefined || activePeriodSinceStartup !== undefined;

            if (!keep) {
                // if there's only one active period and we aren't in it, then we don't have to check this alert again this run
                if (serviceAlert.Alert.ActivePeriod.length === 1) {
                    knownPostedIds.push(serviceAlert.Id);
                }
                if (currentRunActivePeriod === undefined) {
                    logger.debug('not posting: no active period within current run interval', serviceAlert.Id);
                }
                if (activePeriodSinceStartup === undefined) {
                    logger.debug('not posting: no active period within startup period', serviceAlert.Id);
                }
            }

            return keep;
        })
        .flatMap(serviceAlert => {
            let message = `${apiUtil.getEnHeader(serviceAlert).Text}`;

            const description = apiUtil.getEnDescription(serviceAlert);
            if (description) {
                message += ` ${description.Text}`;
            }

            // Since we can end up posting on a delay, always include the post time.
            const currentActivePeriod = apiUtil.getCurrentActivePeriod(serviceAlert.Alert.ActivePeriod, RUN_INTERVAL_MS, startUpDate.getTime(), logger);
            if (currentActivePeriod) {
                message += ` (${apiUtil.activePeriodStartToPtString(currentActivePeriod)})`;
            }

            const affectedLines = getAffectedLines(serviceAlert);
            const posts: AdvisoryPost[] = [];

            affectedLines.forEach((line: Line) => {
                // If the message doesn't include the line, then we'll add our short name
                if (message.indexOf(line.externalId) < 0) {
                    message = `(${line.shortName}) ${message}`;
                }

                if (message.length > maxPostLength) {
                    const chunks = util.chunkMessage(message, maxPostLength);

                    chunks.forEach((chunk: string, index: number) => {
                        const chunkedMessage = `(${index + 1}/${chunks.length}) ${chunk}`;
                        posts.push(new AdvisoryPost(serviceAlert.Id, chunkedMessage));
                    });
                } else {
                    posts.push(new AdvisoryPost(serviceAlert.Id, message));
                }
            });

            return posts;
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

const online = (): boolean => {
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

function main(): void {
    logger.info('loop count', loopCount);
    logger.info('post/reject count', knownPostedIds.length);

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
                const serviceAlerts = (json as GetAdvisoriesResponse).Alerts.ServiceAlerts;
                logger.debug('received advisories with ids', serviceAlerts.map(serviceAlert => serviceAlert.Id).join(','));
                logger.debug('received advisories for lines', serviceAlerts
                    .flatMap(serviceAlert => serviceAlert.Alert.InformedEntity)
                    .map(informedEntity => informedEntity.Id)
                    .filter(id => id !== 0)
                    .join(','));
                return getPostsFromServiceAlerts(serviceAlerts);
            })
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
    util.jitterInterval(main, RUN_INTERVAL_MS, RUN_INTERVAL_JITTER_MS);
} else {
    logger.error('env has empty set of lines to post');
}
