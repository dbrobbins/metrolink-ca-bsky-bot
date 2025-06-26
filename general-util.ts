/**
 * @returns time adjusted to PT time zone
 */
export function getPtNow() {
    return new Date(toPtString(new Date()));
}

export function toPtString(date: Date): string {
    return date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short' });
}

export function msElapsedSince(timestampMs: number) {
    return (new Date()).getTime() - timestampMs;
}

export function timestampSIsInFuture(timestampS: number): boolean {
    return (new Date()).getTime() < (new Date(timestampS * 1000)).getTime();
}

export function timestampInIntervalFromNowMs(timestampS: number, intervalMs: number, logger?: Logger): boolean {
    const now = new Date();
    const intervalEnd = now.getTime();
    const intervalStart = intervalEnd - intervalMs;

    return timestampInIntervalMs(timestampS, intervalStart, intervalEnd, logger);
}

export function timestampInIntervalMs(timestampS: number, intervalStartMs: number, intervalEndMs: number, logger?: Logger): boolean {
    const now = new Date();
    const postDate = new Date(timestampS * 1000);
    const postTime = postDate.getTime();

    if (logger) {
        logger.debug('now', now.toISOString(), 'postDate', postDate.toISOString(), 'postTime', postTime, 'range', intervalStartMs, '-', intervalEndMs);
    }

    return postTime >= intervalStartMs && postTime <= intervalEndMs;
}

export function chunkMessage(message: string, chunkSize: number): string[] {
    const chunks: string[] = [];

    let currentPos = 0;
    // just in case
    let loopCount = 0;
    while (currentPos < message.length && loopCount < 5) {
        const targetPos = currentPos + chunkSize;
        let target = message.substring(currentPos, targetPos);
        // if we aren't consuming the end of the string yet, break at the last space
        if (targetPos < message.length) {
            target = target.substring(0, target.lastIndexOf(' '));
        }
        chunks.push(target);

        // account for the space we maybe split at, or go over which is fine
        currentPos += target.length + 1;
        loopCount += 1;
    }

    return chunks;
}

export function jitterInterval(callback: () => void, intervalMinMs: number, jitterMs: number) {
    // guarantee that we wait the min interval
    setInterval(() => {
        // then add a random wait between zero and the jitter interval
        setTimeout(callback, Math.floor(Math.random() * jitterMs));
    }, intervalMinMs);
}

export class Logger {

    private readonly logLevel: Logger.LogLevel;

    constructor(logLevel: string | undefined) {
        if (logLevel) {
            this.logLevel = Logger.LogLevel[logLevel.toUpperCase() as keyof typeof Logger.LogLevel];
        } else {
            this.logLevel = Logger.LogLevel.DEBUG;
        }
        this.debug("log level", logLevel)
    }

    debug(message?: any, ...optionalParams: any[]): void {
        this.shouldLog(Logger.LogLevel.DEBUG) && console.debug(`DEBUG ${message}`, ...optionalParams);
    }

    info(message?: any, ...optionalParams: any[]): void {
        this.shouldLog(Logger.LogLevel.INFO) && console.info(`--INFO ${message}`, ...optionalParams);
    }

    warn(message?: any, ...optionalParams: any[]): void {
        this.shouldLog(Logger.LogLevel.WARN) && console.warn(`----WARN ${message}`, ...optionalParams);
    }

    error(message?: any, ...optionalParams: any[]): void {
        this.shouldLog(Logger.LogLevel.ERROR) && console.error(`--------ERROR ${message}`, ...optionalParams);
    }

    shouldLog(level: Logger.LogLevel): boolean {
        return level.valueOf() >= this.logLevel.valueOf();
    }
}

export namespace Logger {
    export enum LogLevel {
        DEBUG = 1,
        INFO = 2,
        WARN = 3,
        ERROR = 4
    }
}
