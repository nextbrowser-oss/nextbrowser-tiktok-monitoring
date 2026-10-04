# Walkthrough

This page follows one first session, from a fresh profile to an approved reply. The brand is **@acme**, a clothing shop; **@rivalwear** is a competitor whose comment section acme's customers hang out in. The names, videos and numbers are sample data, but every line of output below was printed by the CLI's own formatters (`describeEvent` and `describePass` in [`src/node/cli.ts`](../src/node/cli.ts)), exactly as `tiktok-monitor` prints it.

The engine has not been run against tiktok.com live yet (see [project status](../README.md#project-status)); this walkthrough shows how a session is meant to go.

## 1. Set up a profile

1. In Nextbrowser, create a profile for the brand. Give it a residential proxy in a country where TikTok is available: TikTok refuses some countries outright, and datacenter addresses meet its captcha far more often.
2. Open tiktok.com in the profile and sign in as @acme. This is optional — the creators you watch are read signed out too — but without it the monitor cannot read the comments on your own videos or notice mentions of your account.
3. In the TikTok skill's **Monitoring** panel, *Open tiktok.com* runs `checkAccount` and names the signed-in account before anything is scheduled.

To run the engine from a terminal instead, build the CLI once:

```bash
git clone https://github.com/nextbrowser-oss/nextbrowser-tiktok-monitoring.git
cd nextbrowser-tiktok-monitoring
npm ci
npm run build
```

The CLI drives the profiles the app manages through the app's own `nextctl` (or `nbc` from your `PATH`), so the profile name is the one you see in Nextbrowser. Here it is `acme-tiktok`.

## 2. Configure what to watch

```bash
node dist/node/bin.js run --profile acme-tiktok \
  --creators rivalwear \
  --keywords "acme,#acmewear" \
  --exclude giveaway
```

| Setting | Here | Why |
| --- | --- | --- |
| `--creators` | `rivalwear` | Their new videos are reported, and the comments under their newest three videos are read for your keywords and your @handle. Up to 10 creators. |
| `--keywords` | `acme`, `#acmewear` | Matched as whole words in descriptions and comments. "acme" is found in "#acme" and "@acme", not in "#acmeshop". |
| `--exclude` | `giveaway` | Drops the "acme giveaway, click the link" spam even though it names a keyword. |
| your own videos | on (`--own`) | Your newest six videos, and every new comment on them. |
| `--interval` | 30 min | The default. Ten minutes is the minimum: TikTok answers a browser that reads faster with a captcha. |

The flags are saved in the state file, `~/.nextbrowser/tiktok-monitoring/acme-tiktok.json`, so the next run needs only `--profile`. In Nextbrowser the same values are the Monitoring panel's settings. Every setting and its range is in [events and state](events-and-state.md#settings).

## 3. The first pass draws the starting line

```text
09:00  signed in as @acme
09:00  pass @acme: starting line: 3 sources, 7 matches; 9 videos read; followers: 2 read, 0 changed
```

The pass read three sources — the comments on your videos, @rivalwear's videos, and the comments under them — along with the exact counts of nine videos (your six newest and @rivalwear's three) and two follower counts. It announced **nothing**. Everything it found is the starting line: what was already there when you started watching is not news. The app's dashboard still lists the seven matches it found, most urgent first, so it is not empty after Start.

From here on, the state file remembers each video's counts and comment watermark, and every item it has seen.

## 4. Something happens

Over the next half hour:

- @mila.makes comments on your restock video: her order never arrived;
- @rivalwear posts a new video;
- under @rivalwear's hoodie video, @jules.k says acme's hoodies hold up better, and @tom_rides tells someone to ask @acme.

The second pass:

```text
09:31  HIGH    @mila.makes replied to you: @acme my order never arrived, can you check?
        [Replies to you · Says "never arrived" · Asks a question]  https://www.tiktok.com/@acme/video/7557812345678901234
09:31  low     @rivalwear posted a video: Fall drop is live, 30% off this week #fallfits
        https://www.tiktok.com/@rivalwear/video/7558012345678901234
09:31  low     @jules.k commented under @rivalwear's video: honestly acme hoodies hold up way better, is the restock this week?
        [Asks a question]  https://www.tiktok.com/@rivalwear/video/7557890123456789012
09:31  HIGH    @tom_rides mentioned you under @rivalwear's video: ask @acme, they ship to Canada
        [Mentions you]  https://www.tiktok.com/@rivalwear/video/7557890123456789012
09:31  pass @acme: 3 sources: 4 new (2 urgent) of 11 matches; 9 videos, 2 comment lists read; followers: 2 read, 0 changed
```

How it got there:

- Your video's comment count had grown past its watermark, so its comment list was read (one of the "2 comment lists read"). Mila's comment opens with @acme, which is how a reply to you reads on TikTok: **+4** "Replies to you". It says one of the urgent terms: **+3**. It asks a question: **+1**. Eight points: *high*.
- @rivalwear's new video is reported because you watch @rivalwear; keywords only add to its ranking. Nothing about it concerns you yet: *low*.
- @rivalwear's older video gained comments, so its list was read too. Jules's comment names the keyword "acme" and asks a question, but it is not addressed to you: *low*, worth a look. Tom's comment names your @handle: **+4** "Mentions you", *high*.
- A comment there that named neither a keyword nor you was read but not reported.

The [how it works](how-it-works.md#7-urgency-triage) page lists every rule.

## 5. From HIGH to an approved reply

The engine stops here: it ranked the comments, and it never answers anything. Answering is the TikTok reply agent's job, and only with your approval.

1. In Nextbrowser's TikTok **Monitoring** list, Tom's comment is near the top, marked *high* with "Mentions you".
2. Choose **Draft reply** on it. The match — the video's link, the comment's author and text, where it was found — goes to the TikTok reply agent.
3. The agent opens the video in the profile, finds Tom's comment and reads the conversation around it, and writes a reply to that comment in the chat. For example:

   > Yes, we ship to Canada! Usually 5–7 days, and the size guide is in our bio 🙌

4. Nothing has been posted yet. Read the draft: approve it, edit it, or discard it.
5. Only after you approve does the agent post the reply under Tom's comment, as @acme.

Mila's complaint goes the same way, and deserves the first look: it is the higher score.

On the next pass, your reply is the account's own comment, so it is never reported; Tom's comment has been seen, so it is not announced again.

## 6. A video picks up

Half an hour later, @rivalwear's new video has taken off:

```text
10:02  views @rivalwear: 1,840 → 26,400 (+24,560)
        https://www.tiktok.com/@rivalwear/video/7558012345678901234
10:02  pass @acme: 3 sources: 0 new of 11 matches; 9 videos read; followers: 2 read, 0 changed; 1 jump
```

A jump is at least +50% and at least 1,000 views since the last look (likes: +50% and 500; comments: +20). On the dashboard the video now carries "Picking up fast: +25K views since the last look". Raise the floor with `--views-jump 5000` if a creator with a big audience jumps on every pass. The same check runs on your own videos, so a video of yours that takes off is reported too.

## 7. When something gets in the way

TikTok is quick to defend itself, and the monitor is built to say so plainly and keep going where it can. Three things you may see:

**TikTok will not answer the comment list.**

```text
10:33  pass @acme: 3 sources: 0 new of 11 matches; 9 videos, 1 comment list read; comments refused; followers: 2 read, 0 changed
        TikTok did not answer the comment list without its own signature; comments were skipped this pass (see troubleshooting).
```

TikTok's web app signs its comment calls and the monitor does not. When TikTok answers with nothing, comments are skipped for the pass, every watermark stays where it was, and a later pass that gets an answer reads what was missed. New videos, counts and followers are still read.

**A captcha.**

```text
11:04  captcha for @acme: open tiktok.com in the profile and solve it
11:04  pass @acme: captcha
        TikTok put a captcha in front of this profile. Open tiktok.com in the profile and solve it; monitoring picks up on the next pass, which waits longer.
```

The pass stops at once and the next one waits three intervals. Open tiktok.com in the profile and solve the puzzle by hand; the monitor never does.

**The profile was signed out.**

```text
12:00  signed out (was @acme): creators are still read; sign in to tiktok.com for your own videos
12:00  pass: not signed in; 2 sources: 0 new of 6 matches; 3 videos read; followers: 1 read, 0 changed
        The profile is not signed in to tiktok.com: comments on your videos and mentions of your account wait for a sign-in; public creators are read as usual.
```

@rivalwear is still read. Your own videos wait, and pick up where they left off once the profile is signed in again.

Every note has an entry in [troubleshooting](troubleshooting.md).

## 8. Following along from another program

Piped into another program, the CLI prints JSON lines instead, one event per line:

```bash
node dist/node/bin.js run --profile acme-tiktok | jq -c 'select(.type == "new_item" and .triage.urgency == "high")'
```

```json
{"type":"new_item","at":1791163860000,"account":"acme","source":{"kind":"creator_comments","name":"@rivalwear"},"keywords":["acme"],"item":{"key":"comment:7558100000000000003","id":"7558100000000000003","kind":"comment","author":"tom_rides","text":"ask @acme, they ship to Canada","url":"https://www.tiktok.com/@rivalwear/video/7557890123456789012","video":{"id":"7557890123456789012","author":"rivalwear","desc":"Our hoodie vs the rest","url":"https://www.tiktok.com/@rivalwear/video/7557890123456789012"},"createdAt":1791163320000,"likes":1,"replies":0,"addressed":"mention"},"triage":{"urgency":"high","score":4,"reasons":["Mentions you"]}}
```

Every field is described in [events and state](events-and-state.md).

## 9. Stopping and starting again

<kbd>Ctrl</kbd>+<kbd>C</kbd> stops the run; a pass in progress finishes first. Everything the monitor knows is in the state file:

```bash
node dist/node/bin.js state --profile acme-tiktok
```

The next `run` picks up from it: no new starting line, nothing announced twice. Remove a creator with `--creators` and the monitor forgets it; add it back and it starts over with a fresh starting line.
