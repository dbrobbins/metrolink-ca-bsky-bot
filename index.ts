import { AtpAgent, AtpSessionData, AtpSessionEvent } from "@atproto/api";
import * as util from './general-util';
import * as apiUtil from './api-object-util';
import { AdvisoryPost, ContentEqualitySet, FETCH_ERROR_RESPONSE, GetAdvisoriesResponse, GetAdvisoryResult, Line, Lines, ServiceAlert } from './types';
import { readFileSync } from "fs";

const logger: util.Logger = new util.Logger(process.env.LOG_LEVEL ?? "debug");

const linesToPost = (() => {
    let toPost: string[] = [];

    if (process.env.LINES_TO_POST) {
        process.env.LINES_TO_POST.split(',').forEach(lineId => {
            const resolvedLine = Lines.getLineById(lineId);
            if (resolvedLine) {
                toPost.push(resolvedLine.id);
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
let erroredCount = 0;
let errored = false;
let erroredDate: Date | null = null;

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
        return new Promise(resolve => {
            try {
                resolve(JSON.parse(readFileSync('./test.json', 'utf-8')));
            } catch (error) {
                resolve('failed to load test data');
            }
        });
    }

    if (!serviceUrl) {
        throw new Error('env has no service url configured');
    }

    logger.debug('fetching data');
    // plain GET with manual cache-busting by adding to the lines arg
    return fetch(`${serviceUrlWithQuery}&lines=${loopCount}`)
        .then(response => {
            logger.debug('cf-cache-status', response.headers.get("cf-cache-status"), 'date', response.headers.get('date'));
            return response.json();
        })
        .catch(e => {
            logger.error('failed to fetch advisories');
            return FETCH_ERROR_RESPONSE;
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
                logger.info('marking rejected - does not affect our lines', serviceAlert.Id);
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
                logger.info('marking rejected - no english header', serviceAlert.Id);
                logger.debug('not posting: header empty', serviceAlert.Id);
            }
            return keep;
        })
        // filter out things that weren't posted since the last time we ran
        .filter(serviceAlert => {
            // sort active periods by start, in descending order
            serviceAlert.Alert.ActivePeriod?.sort(apiUtil.activePeriodsByStart).reverse();

            // account for jitter to check if current run is in an active period
            const lastRunInterval = util.msElapsedSince(lastRunDate.getTime());
            const currentRunActivePeriod = apiUtil.getCurrentRunActivePeriod(serviceAlert.Alert.ActivePeriod, lastRunInterval, logger);

            // check against start up time as well in case caching made us miss something
            const activePeriodSinceStartup = apiUtil.getActivePeriodSinceStartup(serviceAlert.Alert.ActivePeriod, startUpDate.getTime(), logger);

            // explicitly keep if there is no active period so that we'll post it at least once
            const keep = !serviceAlert.Alert.ActivePeriod || currentRunActivePeriod !== undefined || activePeriodSinceStartup !== undefined;

            if (!keep) {
                // if there's only one active period and we aren't in it, then we don't have to check this alert again this run
                if (!serviceAlert.Alert.ActivePeriod || serviceAlert.Alert.ActivePeriod.length === 1) {
                    logger.info('marking rejected - outside only active period', serviceAlert.Id);
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

const getPostsForAlert = (serviceAlert: ServiceAlert, postPrefix: string = ''): AdvisoryPost[] => {
    const affectedLines = getAffectedLines(serviceAlert);
    // Maintain a content-comparing set so we don't post the exact same message across multiple lines,
    // ie when post contains all line names already and does not require differentiation.
    const posts = new ContentEqualitySet<AdvisoryPost>();

    const header = `${apiUtil.getEnHeader(serviceAlert).Text}`;
    const description = apiUtil.getEnDescription(serviceAlert);

    affectedLines.forEach((line: Line) => {
        let message = `${postPrefix}${header}`;

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
}

const convertAdvisoryResultToPosts = (getAdvisoryResult: GetAdvisoryResult): AdvisoryPost[] => {
    const posts: AdvisoryPost[] = [];

    // If the result state is now errored but wasn't previously, take note so we can post a notice.
    if (getAdvisoryResult.errored && !errored) {
        logger.info('received errored response');
        errored = true;
        erroredDate = new Date();
    }

    // If the result state has cleared, clean up.
    if (!getAdvisoryResult.errored && errored) {
        logger.info('cleared errored response');
        errored = false;
        erroredDate = null;
    }

    // If we're in an active error state, then consider posting
    if (getAdvisoryResult.errored && errored) {
        // If it's been 5 minutes and we haven't posted too much, post a notice
        if (erroredDate && erroredCount < 10 && util.msElapsedSince(erroredDate.getTime()) >= util.FIVE_MINUTES_MS) {
            erroredCount += 1;
            posts.push(new AdvisoryPost(
                `errorCount=${erroredCount}`,
                '🤖 Per Metrolink, some service advisories may be temporarily unavailable. Posts will resume as soon as service is restored.'
            ));

            // We still need to partially empty the error state so we won't just keep posting this
            erroredDate = null;
        }
    }

    return posts.concat(
        getAdvisoryResult.serviceAlerts.flatMap(serviceAlert => getPostsForAlert(serviceAlert)),
        getAdvisoryResult.bannerAlerts.flatMap(bannerAlert => getPostsForAlert(bannerAlert, '(Priority Notice) '))
    );
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
            // force a wait between posts
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
    loopCount += 1;

    logger.info('loop count', loopCount);
    logger.info('post/reject count', knownPostedIds.size);

    getServiceAdvisories()
        .then(json => {
            const response = (json as GetAdvisoriesResponse);

            const serviceAndBannerAlerts = [...response.Alerts.ServiceAlerts, ...response.Alerts.BannerAlerts];
            logger.debug('received advisories with ids', serviceAndBannerAlerts.map(serviceAlert => serviceAlert.Id).join(','));
            logger.debug('received advisories for lines', serviceAndBannerAlerts
                .flatMap(serviceAlert => serviceAlert.Alert.InformedEntity)
                .map(informedEntity => informedEntity.Id)
                .filter(id => id !== 0)
                .join(','));

            return new GetAdvisoryResult(
                filterToRelevantAlerts(response.Alerts.ServiceAlerts),
                filterToRelevantAlerts(response.Alerts.BannerAlerts),
                response.Alerts.Errored
            );
        })
        .then(convertAdvisoryResultToPosts)
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
                logger.error(e.cause);
                logger.error(e.stack);
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
