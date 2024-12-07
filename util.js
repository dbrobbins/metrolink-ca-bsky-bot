"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPtNow = getPtNow;
/**
 * @returns time adjusted to PT time zone
 */
function getPtNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
}
