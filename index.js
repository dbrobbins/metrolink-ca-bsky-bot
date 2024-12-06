"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@atproto/api");
const test_1 = require("./test");
const types_1 = require("./types");
const RUN_INTERVAL_MINUTES = 1;
const RUN_INTERVAL_MS = RUN_INTERVAL_MINUTES * 60 * 1000;
const LINES_TO_POST = [types_1.Lines.IEOC.externalId];
const agent = new api_1.AtpAgent({ service: 'https://bsky.social' });
const serviceUrl = process.env.SERVICE_URL ?? '';
const dataRequestEnabled = process.env.DATA_REQUEST_ENABLED === 'true';
// only post if we're also getting real data
const postingEnabled = dataRequestEnabled && process.env.POSTING_ENABLED === 'true';
let knownPostedIds = [];
const postedInIntervalMs = (timestamp, intervalMs) => {
    const now = new Date();
    const postDate = new Date(timestamp);
    const intervalEnd = now.getTime();
    const intervalStart = intervalEnd - intervalMs;
    const postTime = postDate.getTime();
    return postTime >= intervalStart && postTime <= intervalEnd;
};
const getServiceAdvisories = () => {
    // if using local env then return a promise that resolves our test data
    if (!dataRequestEnabled) {
        console.log('using local data');
        return new Promise(resolve => resolve(JSON.parse(test_1.RESPONSE)));
    }
    if (!serviceUrl) {
        throw new Error('env has no service url configured');
    }
    // plain GET, no options needed
    return fetch(serviceUrl)
        .then(response => response.json())
        .catch(error => {
        console.error('failed to fetch advisories');
        throw error;
    });
};
const getPostsFromAdvisories = (lineServiceAdvisories) => {
    return lineServiceAdvisories
        // only attempt to post lines we know about
        .filter(lineAdvisory => types_1.Lines.getLineByExternalId(lineAdvisory.LineAbbreviation) !== undefined)
        // filter to lines we care about
        .filter(lineAdvisory => LINES_TO_POST.indexOf(lineAdvisory.LineAbbreviation) >= 0)
        // collect our service advisories
        .flatMap(lineAdvisory => lineAdvisory.ServiceAdvisories)
        // filter out non-advisories
        .filter(serviceAdvisory => serviceAdvisory.Type === types_1.TYPE_SERVICE_ADVISORY)
        // filter out empty messages
        .filter(serviceAdvisory => serviceAdvisory.Message.trim())
        // filter out things we already posted during this run
        .filter(serviceAdvisory => knownPostedIds.indexOf(serviceAdvisory.Id) < 0)
        // filter out things that weren't posted since the last time we ran
        .filter(serviceAdvisory => postedInIntervalMs(serviceAdvisory.Timestamp, RUN_INTERVAL_MS))
        .map(serviceAdvisory => {
        // If the message doesn't include the line, then we'll add our short name
        if (serviceAdvisory.Message.indexOf(serviceAdvisory.Line) < 0) {
            const line = types_1.Lines.getLineByExternalId(serviceAdvisory.Line);
            return new types_1.AdvisoryPost(serviceAdvisory.Id, `(${line?.shortName}) ${serviceAdvisory.Message}`);
        }
        return new types_1.AdvisoryPost(serviceAdvisory.Id, serviceAdvisory.Message);
    });
};
const postAll = async (posts) => {
    if (!postingEnabled) {
        return new Promise(resolve => {
            resolve(posts.map(post => {
                console.log('pretend posting', post.message);
                return post.id;
            }));
        });
    }
    try {
        const id = process.env.BLUESKY_ID;
        const pass = process.env.BLUESKY_PASS;
        if (!id || !pass) {
            throw new Error('env has no id or no pass');
        }
        await agent.login({ identifier: id, password: pass });
        return Promise.all(posts.map(post => {
            return agent.post({ text: post.message })
                .then((response) => {
                return post.id;
            });
        }));
    }
    catch (error) {
        console.error('failed to post advisories');
        throw error;
    }
};
async function main() {
    try {
        getServiceAdvisories()
            .then(json => getPostsFromAdvisories(json))
            .then(posts => postAll(posts))
            .then(postedIds => postedIds.forEach(id => knownPostedIds.push(id)));
    }
    catch (e) {
        if (e instanceof Error) {
            console.error(e.message);
        }
        else {
            console.error(e);
        }
    }
}
main();
setInterval(main, RUN_INTERVAL_MS);
