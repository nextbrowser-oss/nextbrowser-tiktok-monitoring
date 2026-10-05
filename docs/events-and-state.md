# Events and state

## Events

Every event is a plain JSON object with a `type` field and an `at` field, the pass time in epoch milliseconds. A pass returns its events in `result.events`. With `onEvent`, it also hands over each event as soon as it happens.

### `new_item`

Something new that matched: a comment on the account's video, a mention of or reply to the account, a watched creator's new video, or a comment under one that names a keyword.

```json
{
  "type": "new_item",
  "at": 1791163860000,
  "account": "acme",
  "source": { "kind": "own_comments", "name": "your videos" },
  "keywords": ["acme"],
  "triage": {
    "urgency": "high",
    "score": 8,
    "reasons": ["Replies to you", "Says \"never arrived\"", "Asks a question"]
  },
  "item": {
    "key": "comment:7558100000000000001",
    "id": "7558100000000000001",
    "kind": "comment",
    "author": "mila.makes",
    "text": "@acme my order never arrived, can you check?",
    "url": "https://www.tiktok.com/@acme/video/7557812345678901234",
    "video": {
      "id": "7557812345678901234",
      "author": "acme",
      "desc": "Hoodie restock, sizes S to XXL #acmewear",
      "url": "https://www.tiktok.com/@acme/video/7557812345678901234"
    },
    "createdAt": 1791162720000,
    "likes": 0,
    "replies": 0,
    "addressed": "reply"
  }
}
```

| Field | Meaning |
| --- | --- |
| `account` | The monitored account, when the profile is signed in. |
| `source.kind` | `own_comments`, `creator_videos`, or `creator_comments`. `source.name` is `your videos` or `@handle`. |
| `keywords` | The keywords the item names. Often empty for a comment on your video or a creator's new video, which are reported without one. |
| `triage.urgency` | `high`, `medium`, or `low`. `score` is the points behind it; `reasons` say why, strongest first. See [how it works](how-it-works.md#7-urgency-triage). |
| `item.key` | `video:<id>` or `comment:<id>`. Unique across sources: a reply flow uses it to avoid answering twice. |
| `item.kind` | `video` or `comment`. |
| `item.author` | The handle of who posted it, without the @. |
| `item.text` | A video's description or a comment's text, cut to 2,000 characters. |
| `item.url` | The video. TikTok has no link to a single comment, so a comment's link is the video it is under. |
| `item.video` | The video a comment is under, or the video itself, with the opening 200 characters of its description. |
| `item.createdAt` | When it was posted. For a video, its own `createTime`, or the time in its id when its page served no data. |
| `item.views`, `item.likes`, `item.comments`, `item.shares` | A video's counts when it was read. `likes` and `replies` on a comment are its own. |
| `item.partial` | The video's page served no data: `views` is the grid's rounded figure, and `text` is the cover's alt text. |
| `item.viewsGained` | Views a video gained since the last look, when that crossed the engagement threshold. |
| `item.addressed` | `mention`, `reply`, or `comment_on_video`, when it concerns the account. |

### `engagement_changed`

A watched video's views, likes or comments jumped past the thresholds in `settings.engagement`. One event per metric.

```json
{ "type": "engagement_changed", "at": 1791165720000, "key": "video:7558012345678901234", "videoId": "7558012345678901234", "url": "https://www.tiktok.com/@rivalwear/video/7558012345678901234", "handle": "rivalwear", "own": false, "metric": "views", "previous": 1840, "current": 26400, "delta": 24560 }
```

`metric` is `views`, `likes`, or `comments`. `own` is true for the account's own video. `approximate: true` means one of the two figures is the grid's rounded count.

### `followers_changed`

A follower count moved: the account's own, or a watched creator's.

```json
{ "type": "followers_changed", "at": 1791165720000, "handle": "acme", "own": true, "previous": 12480, "current": 12517, "delta": 37 }
```

### `signed_in`, `signed_out`, `account_changed`

```json
{ "type": "signed_in", "at": 1791162000000, "handle": "acme" }
{ "type": "signed_out", "at": 1791172800000, "handle": "acme" }
{ "type": "account_changed", "at": 1791176400000, "previous": "acme", "current": "acme.support" }
```

- **`signed_out`** is emitted once when the session ends. While the profile stays signed out, the watched creators are still read; the account's own videos and mentions of it are not.
- **`signed_in`** is emitted on the first pass, and again after a sign-out.
- **`account_changed`** means the comments on the account's own videos start from scratch, as a new starting line.

### `security_check`

TikTok put its captcha in front of the profile, and the pass stopped. Nothing more is read until a person solves it in the profile.

```json
{ "type": "security_check", "at": 1791169440000, "handle": "acme" }
```

## The matches as read

`result.matches` holds every item the pass found that matched, new or not, inside the `maxItemAgeMs` window, most urgent first and newest first within a level. The events say what is new. `matches` says what there is right now, which is what a dashboard displays, including after the first pass, which announces nothing.

## The pass summary

`result.summary` describes one pass, for a status line or a panel:

| Field | Meaning |
| --- | --- |
| `signedIn`, `handle` | Who the pass found signed in. |
| `loginRequired` | The settings ask for the account's own videos, and the profile is signed out. Public creators were read anyway. |
| `securityCheck` | TikTok showed its captcha and the pass stopped. Someone has to solve it in the profile. |
| `rateLimited` | TikTok is limiting the profile and the pass stopped early. |
| `blocked` | Why the pass stopped reading, e.g. "tiktok.com could not be reached (Failed to fetch)." The next pass should back off. |
| `requests`, `pageLoads` | Fetches made from the tab, and creator pages opened. |
| `sourcesRead`, `baselines` | Sources read, and how many of them were read for the first time (announcing nothing). |
| `itemsRead`, `matches` | Items the sources held, and those that matched inside the age window. |
| `newItems`, `urgent` | New matches, and how many of them are *high*. |
| `videoReads`, `partialVideos` | Video pages fetched, and those that served no data, whose counts came from the grid. |
| `commentReads`, `commentReadsDeferred` | Comment lists read, and lists that grew but wait for the next pass (`maxCommentReads`). |
| `commentPages` | Comment pages asked for. A busy video's list takes more than one; `maxCommentReads` counts these. |
| `commentReadsUnfinished` | Busy videos whose new comments were not all found in the pages this pass could spend; the next pass goes on from there. |
| `commentsRefused` | TikTok would not answer a comment list without its signature, or two videos' lists came back empty; comments were skipped for the rest of the pass. |
| `followerChecks`, `followerChanges` | Follower counts read, and those that changed. |
| `engagementChanges` | `engagement_changed` events emitted. |
| `stopped` | `shouldStop` ended the pass early. |
| `failed` | Set only when the pass ended on something unexpected (a browser or CDP error, a bug): the error, as written. The notes say so too. |
| `notes` | Up to five sentences a person can read. |

## The state document

```jsonc
{
  "version": 1,
  "settings": { /* see below */ },
  "account": { "handle": "acme", "uid": "6800000000000000001", "signedIn": true, "checkedAt": 1791163860000 },
  "sources": {
    "comments:own":              { "since": 1791162000000, "filter": "", "lastReadAt": 1791163860000, "lastNewAt": 1791163860000 },
    "creator:rivalwear:videos":   { "since": 1791162000000, "filter": "all", "lastReadAt": 1791163860000, "lastNewAt": 1791163860000 },
    "creator:rivalwear:comments": { "since": 1791162000000, "filter": "#acmewear|acme", "lastReadAt": 1791163860000 }
  },
  "seen": ["video:7557890123456789012", "comment:7558100000000000001"],   // last 5,000 item keys, all sources
  "videos": {
    "7557890123456789012": {
      "handle": "rivalwear", "createdAt": 1791158400000,
      "views": 31800, "likes": 2210, "comments": 96, "shares": 40, "saves": 120,
      "commentsRead": 96, "checkedAt": 1791163860000,
      "history": [{ "at": 1791162000000, "value": 2140 }, { "at": 1791163860000, "value": 31800 }]
    }
  },
  "followers": {
    "acme": {
      "handle": "acme", "followers": 12517, "following": 210, "hearts": 340000, "videos": 88,
      "checkedAt": 1791165720000, "changedAt": 1791165720000,
      "history": [{ "at": 1791162000000, "value": 12480 }, { "at": 1791165720000, "value": 12517 }]
    }
  },
  "lastPass": { "at": 1791165720000, "finishedAt": 1791165801000, "newItems": 0, "urgent": 0, "followerChanges": 1, "engagementChanges": 0, "notes": [] }
}
```

- `sources[*].since` is the source's starting line: nothing created before it is announced. `filter` is what the source was read with; a different keyword set starts a new line.
- `videos` holds the watched videos, keyed by id, up to 300. `commentsRead` is the comment watermark: a count above it means the list is read again. `commentsReadAt` is when it was taken: comments written after it are what the count grew by. `approximate` marks views taken from the grid. `history` keeps the last 48 view readings that changed. Three fields appear only while a video's comments are behind:
  - `commentsBacklog` (`cursor`, `target`, `found`, `at`, `passes`): a busy video's list ran out of pages before it accounted for the growth; the next pass goes on from `cursor`, and the watermark moves to `target` once it is done.
  - `commentsEmpty`: passes in a row its list came back empty while the count grew. At 3 the watermark moves on.
  - `commentsDueAt`: when its new comments first had to wait for a later pass. The longest-waiting are read first.
- `seen` is ordered oldest first, and an item seen again moves to the end, so an item still on show is not the first one cut.
- `followers[*].history` records every change, capped at the latest 200. It is enough to draw a chart without a separate store.

Pass anything read from storage through `normalizeState`. It accepts older versions, hand edits, and missing fields, and fills in defaults.

## Settings

Settings live in `state.settings`. `normalizeState` and `withSettings` clamp them to safe ranges.

| Setting | Default | Range and meaning |
| --- | --- | --- |
| `creators` | `[]` | Up to 10 handles, without `@`. A pasted `@name`, profile URL or video URL is accepted; a `vm.tiktok.com` short link is not, since it names no one until it is followed. |
| `keywords` | `[]` | Up to 20 words, phrases or hashtags, 2–60 characters each. |
| `excludeKeywords` | `[]` | Up to 20 words that drop an item even when a keyword matched, unless it is addressed to the account. |
| `urgentTerms` | a built-in list | Up to 50 terms that make an item urgent. `[]` turns the rule off. |
| `watchOwnVideos` | `true` | Read the signed-in account's own newest videos and the comments on them. |
| `watchComments` | `true` | Read comment lists at all: under your videos, and under the creators' for keywords and mentions of you. |
| `ownVideos` | `6` | 0–12 of your newest videos watched. |
| `videosPerCreator` | `3` | 0–10 of each creator's newest videos opened for counts and comments. |
| `maxCommentReads` | `10` | 0–30 comment pages one pass may ask for, across every video. A list's first page is one; a busy video's later pages (up to 3 a pass) count too. |
| `trackEngagement` | `true` | Emit `engagement_changed`. |
| `engagement.viewsRatio`, `engagement.viewsMin` | `0.5`, `1000` | A views jump: at least this share of the last reading (0.1–10) and this many (at least 100). |
| `engagement.likesRatio`, `engagement.likesMin` | `0.5`, `500` | A likes jump: the same, at least 10. |
| `engagement.commentsMin` | `20` | A comments jump: at least this many more (at least 1). |
| `maxItemAgeMs` | 72 h | Older items are not announced. `0` turns the limit off. |
| `trackFollowers` | `true` | Track follower counts. Costs no request. |
| `parkTab` | `true` | Leave the tab on `about:blank` after a pass. |

For the time between passes, `scheduleDelay(intervalMs)` returns the interval with a ±20% random spread. It defaults to 30 minutes, never returns less than ten, and with `backOff` (after a captcha, a rate limit or a refusal) it triples the wait.
