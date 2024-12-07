/**
 * @returns time adjusted to PT time zone
 */
export function getPtNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
}