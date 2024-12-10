/**
 * Types and data associated with said types.
 */

export type Line = {
    // my own static ID for my own internal reference
    id: string,
    // the "line abbreviation" used in Metrolink's data, subject to change
    externalId: string,
    // a human-readable display name
    name: string,
    // a human-readable short display name that may match the external ID
    shortName: string
}

export class Lines {
    static readonly AV: Line = { id: 'AV', externalId: 'AV', name: 'Antellope Valley Line', shortName: 'AV Line' };
    static readonly IEOC: Line = { id: 'IEOC', externalId: 'IEOC', name: "Inland Empire-Orange County Line", shortName: 'IEOC Line' };
    static readonly OC: Line = { id: 'OC', externalId: 'OC', name: 'Orange County Line', shortName: 'OC Line' };
    static readonly RIV: Line = { id: 'RIV', externalId: 'RIV', name: 'Riverside Line', shortName: 'RIV Line' };
    static readonly SB: Line = { id: 'SB', externalId: 'SB', name: 'San Bernardino Line', shortName: 'SB Line' };
    static readonly VC: Line = { id: 'VC', externalId: 'VC', name: 'Ventura County Line', shortName: 'VC Line' };
    static readonly PV91: Line = { id: 'PV91', externalId: '91/PV', name: '91/Perris Valley Line', shortName: '91/PV Line' };

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
}

// ServiceAdvisory.Type that we have a specific interest in
export const TYPE_SERVICE_ADVISORY: string = 'Service Advisory';

export type ServiceAdvisory = {
    'Id': number,
    'Message': string,
    'Line': string,
    'Platform': string,
    'PlayTime': string,
    'CreateDate': string,
    'StartDateTime': string,
    'ShortStartDateTime': string,
    'EndDateTime': string,
    'ShortEndDateTime': string,
    'Timestamp': string,
    'Type': string,
    'DetailsPage': string,
    'AlertDetailsPage': string,
    'DateRangeOutput': string
}

export type LineServiceAdvisory = {
    'Line': string,
    'LineAbbreviation': string,
    'ServiceAdvisories': ServiceAdvisory[]
}

export class AdvisoryPost {
    public readonly id: number;
    public readonly message: string;

    constructor(id: number, message: string) {
        this.id = id;
        this.message = message;
    }

    toString(): string {
        return `{ AdvisoryPost: ${this.id}: ${this.message} }`;
    }
}
