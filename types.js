"use strict";
/**
 * Types and data associated with said types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdvisoryPost = exports.TYPE_SERVICE_ADVISORY = exports.Lines = void 0;
class Lines {
    static AV = { id: 'AV', externalId: 'AV', name: 'Antellope Valley Line', shortName: 'AV Line' };
    static IEOC = { id: 'IEOC', externalId: 'IEOC', name: "Inland Empire-Orange County Line", shortName: 'IEOC Line' };
    static OC = { id: 'OC', externalId: 'OC', name: 'Orange County Line', shortName: 'OC Line' };
    static RIV = { id: 'RIV', externalId: 'RIV', name: 'Riverside Line', shortName: 'RIV Line' };
    static SB = { id: 'SB', externalId: 'SB', name: 'San Bernardino Line', shortName: 'SB Line' };
    static VC = { id: 'VC', externalId: 'VC', name: 'Ventura County Line', shortName: 'VC Line' };
    static PV91 = { id: 'PV91', externalId: '91/PV', name: '91/Perris Valley Line', shortName: '91/PV Line' };
    static ALL = [Lines.AV, Lines.IEOC, Lines.OC, Lines.RIV, Lines.SB, Lines.VC, Lines.PV91];
    static getLineById(id) {
        for (let line of Lines.ALL) {
            if (line.id === id) {
                return line;
            }
        }
    }
    static getLineByExternalId(externalId) {
        for (let line of Lines.ALL) {
            if (line.externalId === externalId) {
                return line;
            }
        }
    }
}
exports.Lines = Lines;
// ServiceAdvisory.Type that we have a specific interest in
exports.TYPE_SERVICE_ADVISORY = 'Service Advisory';
class AdvisoryPost {
    id;
    message;
    constructor(id, message) {
        this.id = id;
        this.message = message;
    }
}
exports.AdvisoryPost = AdvisoryPost;
