"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@atproto/api");
const test_1 = require("./test");
const util = __importStar(require("./util"));
const types_1 = require("./types");
const RUN_INTERVAL_MINUTES = process.env.RUN_INTERVAL_MINUTES ? parseInt(process.env.RUN_INTERVAL_MINUTES) : 30;
const RUN_INTERVAL_MS = RUN_INTERVAL_MINUTES * 60 * 1000;
const linesToPost = (() => {
    let toPost = [];
    if (process.env.LINES_TO_POST) {
        process.env.LINES_TO_POST.split(',').forEach(lineId => {
            const resolvedLine = types_1.Lines.getLineById(lineId);
            if (resolvedLine) {
                toPost.push(resolvedLine.externalId);
            }
        });
    }
    return toPost;
})();
const serviceUrl = process.env.SERVICE_URL ?? '';
const serviceUrlWithQuery = serviceUrl + '?lines=' + linesToPost.join('&lines=');
const dataRequestEnabled = process.env.DATA_REQUEST_ENABLED === 'true';
// only post if we're also getting real data
const postingEnabled = dataRequestEnabled && process.env.POSTING_ENABLED === 'true';
const agent = new api_1.AtpAgent({ service: 'https://bsky.social' });
let knownPostedIds = [];
let isOnline = false;
const postedInIntervalMs = (timestamp, intervalMs) => {
    // timezone-adjusted now
    const now = util.getPtNow();
    // post date already timezone-adjusted
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
    return fetch(serviceUrlWithQuery)
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
        .filter(lineAdvisory => linesToPost.indexOf(lineAdvisory.LineAbbreviation) >= 0)
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
function online() {
    const now = util.getPtNow();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();
    // Sat / Sun 6a-11p
    if (currentDay === 6 || currentDay === 0) {
        return currentHour >= 6 && currentHour < 23;
    }
    // Mon-Fri 4a-11:30p
    return currentHour >= 4 && !(currentHour === 23 && currentMinute > 30);
}
function main() {
    // don't make requests when things aren't getting posted
    if (!online()) {
        if (isOnline) {
            isOnline = false;
            console.log('going offline...');
        }
        return;
    }
    if (!isOnline) {
        isOnline = true;
        console.log('coming online...');
    }
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
if (linesToPost.length > 0) {
    setInterval(main, RUN_INTERVAL_MS);
}
else {
    console.error('env has empty set of lines to post');
}
