import * as util from "./general-util";
import { ActivePeriod, ServiceAlert, Translation, TRANSLATION_EN } from "./types";

export function activePeriodsByStart(a: ActivePeriod, b: ActivePeriod): number {
    if (!a && !b) {
        return 0;
    }

    if (!b) {
        return 1;
    }

    if (!a) {
        return -1;
    }

    if (!a.Start && !b.Start) {
        return 0;
    }

    if (a.Start && !b.Start) {
        return 1;
    }

    if (!a.Start && b.Start) {
        return -1;
    }

    // @ts-ignore cannot be null at this point, why you yellin'?
    return a.Start - b.Start;
}

export function getCurrentActivePeriod(activePeriods: ActivePeriod[], runInterval: number, startUpTimestamp: number, logger?: util.Logger): ActivePeriod | undefined {
    return getCurrentRunActivePeriod(activePeriods, runInterval)
        ?? getActivePeriodSinceStartup(activePeriods, startUpTimestamp);
}

/**
 * It's a little weird because they support multiple active periods.
 *
 * Returns the active period that's inside the current run interval, or
 * undefined.
 */
export function getCurrentRunActivePeriod(activePeriods: ActivePeriod[] | null, intervalMs: number, logger?: util.Logger): ActivePeriod | undefined {
    if (!activePeriods) {
        return;
    }

    for (const activePeriod of activePeriods) {
        if (activePeriod.Start) {
            if (util.timestampInIntervalFromNowMs(activePeriod.Start, intervalMs, logger)) {
                return activePeriod;
            }
        } else {
            // no start, check against end
            if (activePeriod.End && util.timestampSIsInFuture(activePeriod.End)) {
                return activePeriod;
            }
        }
    }
}

/**
 * It's a little weird because they support multiple active periods.
 *
 * Returns the active period that's inside the current start-up period, or
 * undefined.
 */
export function getActivePeriodSinceStartup(activePeriods: ActivePeriod[] | null, startUpTimestamp: number, logger?: util.Logger): ActivePeriod | undefined {
    if (!activePeriods) {
        return;
    }

    for (const activePeriod of activePeriods) {
        if (activePeriod.Start) {
            const msSinceStartup = util.msElapsedSince(startUpTimestamp);
            if (util.timestampInIntervalFromNowMs(activePeriod.Start, msSinceStartup, logger)) {
                return activePeriod;
            }
        } else {
            // no start, check against end
            if (activePeriod.End && util.timestampSIsInFuture(activePeriod.End)) {
                return activePeriod;
            }

        }
    }
}

export function getEnHeader(serviceAlert: ServiceAlert): Translation {
    return serviceAlert.Alert.HeaderText.Translation
        .findLast(translation => translation.Language === TRANSLATION_EN);
}

export function getEnDescription(serviceAlert: ServiceAlert): Translation {
    return serviceAlert.Alert.DescriptionText?.Translation
        .findLast(translation => translation.Language === TRANSLATION_EN);
}