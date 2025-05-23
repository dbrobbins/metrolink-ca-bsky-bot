/**
 * Types and data associated with said types.
 */

export type Line = {
    // my own static ID for my own internal reference
    id: string,
    // the "line abbreviation" used in Metrolink's data, subject to change
    externalId: string,
    // the numerical ID used in Metrolink's data
    databaseId: number,
    // a human-readable display name
    name: string,
    // a human-readable short display name that may match the external ID
    shortName: string
}

export class Lines {
    static readonly AV: Line = { id: 'AV', externalId: 'AV', databaseId: 2, name: 'Antellope Valley Line', shortName: 'AV Line' };
    static readonly IEOC: Line = { id: 'IEOC', externalId: 'IEOC', databaseId: 3, name: "Inland Empire-Orange County Line", shortName: 'IEOC Line' };
    static readonly OC: Line = { id: 'OC', externalId: 'OC', databaseId: 4, name: 'Orange County Line', shortName: 'OC Line' };
    static readonly RIV: Line = { id: 'RIV', externalId: 'RIV', databaseId: 5, name: 'Riverside Line', shortName: 'RIV Line' };
    static readonly SB: Line = { id: 'SB', externalId: 'SB', databaseId: 6, name: 'San Bernardino Line', shortName: 'SB Line' };
    static readonly VC: Line = { id: 'VC', externalId: 'VC', databaseId: 7, name: 'Ventura County Line', shortName: 'VC Line' };
    static readonly PV91: Line = { id: 'PV91', externalId: '91/PV', databaseId: 1, name: '91/Perris Valley Line', shortName: '91/PV Line' };

    static readonly ALL: Line[] = [Lines.AV, Lines.IEOC, Lines.OC, Lines.RIV, Lines.SB, Lines.VC, Lines.PV91];

    static getLineById(id: string): Line | undefined {
        for (let line of Lines.ALL) {
            if (line.id === id) {
                return line;
            }
        }
    }

    static getLineByExternalId(externalId: string): Line | undefined {
        for (let line of Lines.ALL) {
            if (line.externalId === externalId) {
                return line;
            }
        }
    }

    static getLineByDatabaseId(databaseId: number): Line | undefined {
        for (let line of Lines.ALL) {
            if (line.databaseId === databaseId) {
                return line;
            }
        }
    }
}

export type GetAdvisoriesResponse = {
    'Alerts': Alert // no, it's not an array despite the name
}

export type Alert = {
    // 'PlannedAlerts'
    'ServiceAlerts': ServiceAlert[]
    // 'BannerAlerts'
    'Errored': boolean  // error is oddly nested
}

export type ServiceAlert = {
    'Id': string,    // guid
    'Alert': AlertDetail
}

export type AlertDetail = {
    'ActivePeriod': ActivePeriod[]
    'InformedEntity': InformedEntity[],
    'HeaderText': AlertText,
    'DescriptionText': AlertText
}

export type ActivePeriod = {
    'Start': number // timestamp (seconds)
}

/**
 * An "informed entity" is an arbitrary thing that needs to know.
 *
 * It could be a line, a particular trip, etc.
 */
export type InformedEntity = {
    'Id': number,   // ID matching the Line's database ID
    'RouteId': string | null    // ID generally matching the Line's name
}

export type AlertText = {
    'Translation': Translation[]
}

export const TRANSLATION_EN = 'en';

export type Translation = {
    'Text': string,
    'Language': string
}

export class AdvisoryPost {
    public readonly id: string;
    public readonly message: string;

    constructor(id: string, message: string) {
        this.id = id;
        this.message = message;
    }

    toString(): string {
        return `{ AdvisoryPost: ${this.id}: ${this.message} }`;
    }
}
