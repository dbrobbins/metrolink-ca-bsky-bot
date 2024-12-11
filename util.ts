/**
 * @returns time adjusted to PT time zone
 */
export function getPtNow() {
    return new Date(toPtString(new Date()));
}

export function toPtString(date: Date): string {
    return date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
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
