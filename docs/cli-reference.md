# CLI reference

`tiktok-monitor` runs the engine against one Nextbrowser profile from a terminal. It exists for developing the engine and for running it without the app.

```bash
npm ci && npm run build
node dist/node/bin.js <command> --profile <name> [options]
```

After `npm link`, or when the package is installed with its bin, the same command is available as `tiktok-monitor`.

## Commands

| Command | What it does |
| --- | --- |
| `run` | Runs passes until stopped. Waits `--interval` between them, with a random spread. |
| `once` | Runs one pass and exits. |
| `state` | Prints the saved state as JSON. |

## What is watched

| Flag | Default | Meaning |
| --- | --- | --- |
| `--creators a,b` | none | Creators to watch, with or without `@`; profile and video URLs are accepted. Up to 10. Replaces the saved list. |
| `--keywords "a,b c"` | none | Words, phrases and hashtags to find, separated by commas. Phrases keep their spaces. |
| `--exclude "a,b"` | none | Words that drop an item even when a keyword matched. |
| `--urgent-terms "a,b"` | a built-in list | Terms that make an item urgent. |
| `--no-own` / `--own` | on | Whether to read your own newest videos and the comments on them. Needs a signed-in profile. |
| `--no-comments` / `--comments` | on | Whether to read comment lists at all. |
| `--no-engagement` / `--engagement` | on | Whether to report jumps in a video's views, likes and comments. |
| `--no-followers` / `--followers` | on | Whether to track follower counts. |

## How much

| Flag | Default | Meaning |
| --- | --- | --- |
| `--interval 30m` | 30 min | Time between passes. Minimum 10 min, spread ±20%. |
| `--own-videos 6` | 6 | Your newest videos watched, 0–12. |
| `--videos-per-creator 3` | 3 | Each creator's newest videos opened for counts and comments, 0–10. |
| `--max-comment-reads 10` | 10 | Comment lists one pass may read, 0–30. |
| `--views-jump 1000` | 1,000 | Views a video must gain, and +50%, to count as a jump. |
| `--likes-jump 500` | 500 | Likes a video must gain, and +50%, to count as a jump. |
| `--comments-jump 20` | 20 | Comments a video must gain to count as a jump. |
| `--max-age 72h` | 72 h | Older items are not announced. |

Durations accept `ms`, `s`, `m`, `h`, and `d`, and a plain number means seconds. The ratios behind the jumps (50%) are settings in the state file, `engagement.viewsRatio` and `engagement.likesRatio`; see [events and state](events-and-state.md#settings).

## Browser

| Flag | Default | Meaning |
| --- | --- | --- |
| `--nbc PATH` | app's `nextctl`, then `nbc` | The CLI that drives the profile. `NBC_BIN` and `NEXTCTL_BIN` are also honored. |
| `--runtime-root DIR` | the app's | Where the app keeps profiles and sessions. `NEXTBROWSER_RUNTIME_ROOT` also works. |
| `--runtime NAME` | profile's own | Passed to nbc as `--runtime`. |
| `--no-start` | starts | Do not start the profile. Fail if it is not running. |
| `--keep-tab` | parks | Leave the last page open instead of `about:blank`. |

## Output

| Flag | Default | Meaning |
| --- | --- | --- |
| `--state FILE` | `~/.nextbrowser/tiktok-monitoring/<profile>.json` | Where the state is kept between runs. |
| `--format text\|json` | text on a terminal, JSON otherwise | The format of stdout. |
| `--verbose` | off | Write the engine's log and every nbc call to stderr as JSON lines. |

Settings given as flags are saved in the state file and apply to later runs too.

In `text` format, a match takes two lines: the time, the urgency, who did what and what it says; then, indented, the reasons and the link.

```text
09:31  HIGH    @tom_rides mentioned you under @rivalwear's video: ask @acme, they ship to Canada
        [Mentions you]  https://www.tiktok.com/@rivalwear/video/7557890123456789012
```

An engagement jump also takes two lines, the figures and the video:

```text
10:02  views @rivalwear: 1,840 → 26,400 (+24,560)
        https://www.tiktok.com/@rivalwear/video/7558012345678901234
```

Each pass ends with a summary line, and the pass's notes under it:

```text
10:33  pass @acme: 3 sources: 0 new of 11 matches; 9 videos, 1 comment list read; comments refused; followers: 2 read, 0 changed
        TikTok did not answer the comment list without its own signature; comments were skipped this pass (see troubleshooting).
```

In `json` format, stdout carries one object per line:

- every [event](events-and-state.md#events);
- `{"type":"pass","at":…,"summary":{…}}` after each pass;
- `{"type":"error","at":…,"error":"…"}` when the profile would not start. `run` then tries again at the next interval.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Finished, or stopped with <kbd>Ctrl</kbd>+<kbd>C</kbd>. |
| `1` | An error, such as a profile that would not start under `once`, or a bad flag. |
| `2` | No command, or an unknown one. Usage is printed. |
| `3` | `once` found the profile signed out while `--own` is on. The creators were still read. |
| `4` | `once` was rate-limited, refused, or could not reach tiktok.com. |
| `5` | `once` stopped at TikTok's captcha. |
| `130` | A second <kbd>Ctrl</kbd>+<kbd>C</kbd> while a pass was still finishing. |
