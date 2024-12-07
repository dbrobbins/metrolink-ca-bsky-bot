# metrolink-ca-bluesky-bot

Use CA Metrolink's public service endpoints to re-post service advisories to Bluesky.

## Setup

You'll need `typescript`:

`npm install -g typescript`

## Local Development

### Environment

You'll need to configure a local `.env.local` containing the following:

```
SERVICE_URL=
RUN_INTERVAL_MINUTES=5
DATA_REQUEST_ENABLED=false
POSTING_ENABLED=false
BLUESKY_ID=
BLUESKY_PASS=
```

### Build

`npm run build`

### Run

`npm run dev`

## Production

### Run

With node:

`node index.js`

Or npm:

`npm run start`

## About

Bluesky being a new platform with (virtually) unlimited API access inspired me to build a bot that would post content that someone might care about.

At first, I thought maybe I could just scrape Twitter. As you might imagine, however, there are a lot of roadblocks there. Twitter REALLY doesn't want you to do that, and setting it up was a pain. `puppeteer` got me most of the way there, but it really wasn't worth it.

Next, I figured I'd just use `puppeteer` to scrape a less militantly defensive source. I got that working, and then realized that in order to deploy anywhere I'd have to also install `puppeteer` in my host environment, and that was going to be less fun too.

Instead, I figured maybe I could just make a request and use `jsdom` to navigate it. Works alright, but I need async requests to finish, so I was starting to look into making sure a page was fully loaded when I realized I never checked if there were open service calls I could make.

Turns out yes! So now we just fetch, parse some JSON, standard data transformation, log into Bluesky, post, sit around and poll.

Now I just cross my fingers that the owners of this service don't mind me polling it. They probably get a fair bit of traffic and won't notice, right?