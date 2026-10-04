# Troubleshooting

Start with the log. In the app, it is the monitor's log file. In the CLI, run with `--verbose` to get every step and every nbc call on stderr. A `page` entry says what a creator page showed (`ready`, `captcha`, `has_data`, `status_code`, how many videos the grid drew). A `request` entry carries the status, the time it took, and, when TikTok answered with something other than data, what that was (`refused`, `captcha`, `throttled`).

The monitor has not been verified against tiktok.com live yet. If a read fails on every pass, the most likely cause is that TikTok's page differs from the shape the monitor expects; see [reporting a problem](#reporting-a-problem) for what to capture.

## "TikTok put a captcha in front of this profile"

TikTok showed its slider or rotate puzzle: on the landing page, over a creator's page, or instead of a fetched page. The pass stopped, emitted `security_check`, and the next pass waits three intervals.

- Open tiktok.com in the profile in Nextbrowser and solve the puzzle by hand. The monitor never solves it for you.
- A captcha on every pass means the profile reads faster than TikTok accepts from it. Raise `--interval` (an hour is reasonable), watch fewer creators, or lower `--videos-per-creator`.
- Datacenter proxy addresses see far more captchas than residential ones. Try the profile with another proxy or country.
- A signed-in profile is asked less often than a signed-out one.

## "TikTok is limiting this profile"

TikTok answered HTTP 429, said "too many requests", or returned a `status_code` between 10000 and 10099. The pass stopped where it was; everything it read before is kept. The next pass waits three intervals. If it happens often, the same remedies as for a captcha apply. Other tools using the same profile or proxy count against the same limit.

## "tiktok.com could not be reached"

The request got no answer within 20 seconds, or the network failed. Check the proxy with Nextbrowser's proxy diagnostics. nbc reports `PROXY_TRAFFIC_EXHAUSTED` when the proxy's traffic has run out.

## "tiktok.com refused the profile (HTTP 403 …)"

TikTok answers a whole country this way where it is not available, and a proxy in such a country gets it on every page. Switch the profile's proxy to a country where TikTok works.

## "TikTok did not answer the comment list without its own signature"

TikTok's web app signs its call for a video's comments with values its own scripts compute (`msToken`, `X-Bogus`). The monitor makes the call plainly, from a creator's page where TikTok's scripts are running, and TikTok may answer it with nothing, with a page, or with a non-zero `status_code`.

When that happens the pass skips comments for the rest of the pass, keeps every comment watermark where it was, and notes it. New videos, counts, followers and engagement are still read. The next pass tries again, and anything that was missed is read once TikTok answers.

If it happens on every pass:

- comments on your videos and under the creators' are not being read at all. Check the `comments_refused` log entries: `status` and `refused` say what TikTok answered;
- signing the profile in to tiktok.com sometimes changes the answer;
- `--no-comments` turns the lists off, and the note with them, while the rest of the monitoring goes on.

## "TikTok drew no video grid for @name"

The profile's data was there — its follower count was read — but the web app did not draw the video grid within twenty seconds. Usually a captcha or a sign-in prompt over the grid, sometimes just a slow proxy. The creator's videos keep their old state and are read next pass. Open the creator in the profile by hand: if TikTok shows a puzzle or a "Log in to TikTok" dialog there, that is what the monitor met.

## "TikTok drew nothing for @name"

The page had neither TikTok's data nor a grid: an error page, a blank page, or a page that is not TikTok's. Check the creator's address in the profile by hand, and the proxy.

## "@name was not found on TikTok", "@name is private"

- **Not found**: TikTok's `statusCode` was 10202 or 10221: the account does not exist, was renamed, or was banned. The handle is the part after `@` in the creator's address. A `vm.tiktok.com` short link is not accepted; open it and copy the address it leads to.
- **Private**: only the followers the account approves see its videos. The follower count is still tracked.
- **"TikTok would not show @name (statusCode …)"**: another refusal for that one creator. It is tried again on the next pass.

## "TikTok served no data for N video pages"

A video's page came back without TikTok's data block, so the video keeps what the grid said: its rounded view count, the time in its id, and the cover's alt text as its description. Such items are marked `partial`, and their comments wait until a pass reads the page's exact counts. Occasional cases are normal; every video on every pass means TikTok changed the page.

## "The profile is not signed in to tiktok.com"

The home page named no account. The watched creators are still read, since their pages are public. Your own videos, the comments on them, and mentions of your account wait for a sign-in. Open the profile in Nextbrowser, sign in to tiktok.com, and the next pass picks up from there. Run with `--no-own` to watch creators only.

## A keyword finds nothing that TikTok's search shows

Keywords match whole words only: "acme" does not match "#acmeshop". Add the forms you mean, hashtags included, as keywords of their own. The monitor also does not search TikTok: it reads only the comments under your videos and the creators you watch. Add the creators whose comment sections matter to you.

## A new comment was not reported

- The video is not among the newest `--own-videos` or `--videos-per-creator`. Raise the number.
- The comment list is read one page deep, in TikTok's own order. On a busy video a new comment may not be on that page.
- Under a creator's video, a comment is reported only when it names a keyword or your handle.
- The comment is older than `--max-age`.

## Too many matches, or the wrong ones

- Add exclusion words for the noise that keeps coming back ("giveaway", "follow for follow", a namesake).
- A creator's every new video is reported. Watch fewer creators if that is too much.
- Lower `--max-age` if old items are still surfacing after a pause.

## An urgent item is marked "low"

The triage rules are listed in [how it works](how-it-works.md#7-urgency-triage). The urgent terms are a setting: add the words your customers write when something is wrong ("still waiting", "wrong size") with `--urgent-terms`, or in the app's settings.

## The profile does not start

`tiktok-monitor` starts the profile through nbc, and nbc reports why a start failed. Messages seen in practice:

| nbc says | Meaning |
| --- | --- |
| `ClawBrowser does not expose managed-proxy privacy capability 2` | The installed browser runtime is older than nbc requires for proxied profiles. Update the browser runtime from the Nextbrowser app. |
| `browser switch "--…" is not allowed before proxied runtime privacy verification` | A browser switch was passed to a proxied profile. Do not pass `browserArgs` for proxied profiles. |
| `SESSION_NOT_FOUND` | nbc is looking in the wrong runtime root. Point `--runtime-root` at the app's (`~/.nextbrowser/runtime` on macOS). |
| `API_KEY_REQUIRED`, `API_KEY_INVALID` | The Nextbrowser account setup is incomplete. Sign in to the app. |

In `run` mode, a profile that does not start is reported and retried at the next interval. `once` exits with code 1.

## Reporting a problem

Open a [bug report](https://github.com/nextbrowser-oss/nextbrowser-tiktok-monitoring/issues/new/choose) and include:

- the version or commit;
- the relevant `--verbose` log lines, with handles and comment text removed if they are private;
- for a page that read wrong: the `page` entry, and, if you can, whether the creator's page in the profile shows `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` and `data-e2e="user-post-item"` (in the browser's developer tools);
- for a request: its `status`, `refused`, `captcha` and `throttled` fields.
