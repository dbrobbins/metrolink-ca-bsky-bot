/**
 * Types and data associated with said types.
 */

export type Line = {
    // my own static ID in case I ever need a reference
    id: number,
    // the "line abbreviation" used in Metrolink's data, subject to change
    externalId: string,
    // a human-readable display name
    name: string,
    // a human-readable short display name that may match the external ID
    shortName: string
}

export class Lines {
    static readonly AV: Line = { id: 1, externalId: 'AV', name: 'Antellope Valley Line', shortName: 'AV Line' };
    static readonly IEOC: Line = { id: 2, externalId: 'IEOC', name: "Inland Empire-Orange County Line", shortName: 'IEOC Line' };
    static readonly OC: Line = { id: 3, externalId: 'OC', name: 'Orange County Line', shortName: 'OC Line' };
    static readonly RIV: Line = { id: 4, externalId: 'RIV', name: 'Riverside Line', shortName: 'RIV Line' };
    static readonly SB: Line = { id: 5, externalId: 'SB', name: 'San Bernardino Line', shortName: 'SB Line' };
    static readonly VC: Line = { id: 6, externalId: 'VC', name: 'Ventura County Line', shortName: 'VC Line' };
    static readonly PV91: Line = { id: 7, externalId: '91/PV', name: '91/Perris Valley Line', shortName: '91/PV Line' };

    static readonly ALL: Line[] = [Lines.AV, Lines.IEOC, Lines.OC, Lines.RIV, Lines.SB, Lines.VC, Lines.PV91];

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

    public constructor(id: number, message: string) {
        this.id = id;
        this.message = message;
    }
}
