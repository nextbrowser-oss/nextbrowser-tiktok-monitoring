# Integration guide

The package has two entry points:

| Entry | Contents | Runs in |
| --- | --- | --- |
| `@nextbrowser-oss/tiktok-monitoring` | `runPass`, `checkAccount`, state and settings, events, keyword matching, `triage`, `scheduleDelay` | Anywhere. It has no Node imports; [`src/core.test.ts`](../src/core.test.ts) enforces this. |
| `@nextbrowser-oss/tiktok-monitoring/node` | `nbcBrowser` (a browser over the `nbc`/`nextctl` CLI), `loadState`/`saveState`, the CLI | Node.js 22 or later |

## Installing

The package is consumed from Git. `prepare` builds `dist/` on install:

```bash
npm install github:nextbrowser-oss/nextbrowser-tiktok-monitoring#<commit-or-tag>
```

Pin a commit or a tag rather than a branch, so a rebuild of the app never picks up an unreviewed change.

## The contract with Nextbrowser

The app owns everything that has a lifetime:

- the browser, prepared for the selected profile;
- the timer;
- the storage.

The engine owns only the logic of one pass.

```ts
import {
  normalizeState,
  runPass,
  scheduleDelay,
  withSettings,
  type MonitorEvent,
} from "@nextbrowser-oss/tiktok-monitoring";
import { cliBrowser } from "./lib/xreply/browser";

async function monitorPass(profileArgs: string[]) {
  const saved = normalizeState(await readAppData("tiktok-monitor-state.json"));
  const { state, events, summary, matches } = await runPass({
    browser: cliBrowser(profileArgs),
    state: saved,
    log: (entry) => appendAppData("tiktok-monitor-log.jsonl", entry),
    onStep: (step) => setStatus(step),
    onEvent: (event: MonitorEvent) => showNotification(event),
    shouldStop: () => stopRequested,
  });
  await writeAppData("tiktok-monitor-state.json", state);
  showMatches(matches);
  return scheduleDelay(30 * 60_000, { backOff: !!summary.blocked || summary.rateLimited || summary.securityCheck });
}

// Settings changed in the UI: patch them, normalized. A threshold can be
// changed alone; the others keep their values.
const next = withSettings(saved, { creators: ["rivalwear"], keywords: ["acme", "#acmewear"], engagement: { viewsMin: 5000 } });
```

### What to show

`result.matches` holds every item the pass found that matched, new or not, inside the `maxItemAgeMs` window, most urgent first. A first pass announces nothing, but it still returns what it found, so a dashboard is never empty after Start. `result.events` holds what is new; a dashboard marks those.

Each match carries its `triage.reasons`. Show them: they are what makes a *high* believable.

`summary` says how the pass went. Show its `notes` (at most five sentences a person can read), and give the degraded states a visible place:

| Summary | Show |
| --- | --- |
| `securityCheck` | "Solve the captcha": open tiktok.com in the profile for the user. |
| `rateLimited` | "TikTok is limiting this profile; the next pass waits longer." |
| `commentsRefused` | "Comments were skipped this pass." New videos and counts are still current. |
| `loginRequired` | "Sign in to tiktok.com to watch your own videos." The creators are still read. |
| `partialVideos` | Nothing urgent: some counts are rounded until a later pass. |

### From a match to a reply

The engine never answers. In Nextbrowser, a match is handed to the TikTok reply agent through **Draft reply**. The agent drafts a reply to that specific comment and shows it to the user in the chat; only an approved reply is posted. Pass the match's `item.url` (the video), `item.key`, `item.author`, `item.text` and `source` to that flow. TikTok has no link to a single comment, so the agent finds the comment under the video by its author and text.

### Showing the account before anything runs

`checkAccount` opens tiktok.com in the profile, reads who is signed in, and stops there. It reads no creator, and it leaves the page open for a person who is about to sign in. Nextbrowser calls it from its *Open tiktok.com* button, so the panel names the account before the first scheduled pass.

```ts
import { checkAccount } from "@nextbrowser-oss/tiktok-monitoring";

const { signedIn, handle, securityCheck, blocked } = await checkAccount({ browser: cliBrowser(profileArgs) });
```

### The browser

`MonitorBrowser` is a subset of the app's `XBrowser` (`src/lib/xreply/browser.ts`), so the app can pass its existing `cliBrowser(profileArgs)` as it is:

```ts
interface MonitorBrowser {
  open(url: string): Promise<void>;
  evaluate<T>(script: string, label?: string): Promise<T>;   // the script may return a promise
  waitForLoad(timeoutSeconds?: number): Promise<void>;
}
```

A creator is read with `open` and `waitForLoad`, then a few `evaluate`s that ask whether the grid has drawn and read it. Everything else is an `evaluate` of an async script that fetches one page or one comment list from the tab's origin. nbc evaluates with `awaitPromise`, so the script's promise is resolved before the value comes back.

### Sharing the profile

The monitor, the TikTok reply agent, and the user's own agent runs may all drive the same profile. They must take turns: a pass navigates the tab from creator to creator, and the reply agent needs the tab on the video it is answering. Run the monitor pass in the queue the app already uses for its other engine passes. Do not run it beside them.

### State

The state is one JSON document. Store it as it is, and pass whatever comes back from storage through `normalizeState`. That function accepts older files, hand edits, and nothing at all. The layout is described in [events and state](events-and-state.md).

### Logging

`log` receives one JSON object per step: every page opened with how long it took to draw and what it showed, every request with its status and what came back instead of data (`refused`, `captcha`, `throttled`), every source with how many items it held and how many were new, and every event. The pass summary keeps at most five notes. When a read fails on a user's machine, the log is the full record, so append it to a rotated file.

## Outside the app: the Node adapter

```ts
import { runPass, withSettings } from "@nextbrowser-oss/tiktok-monitoring";
import { loadState, nbcBrowser, saveState } from "@nextbrowser-oss/tiktok-monitoring/node";

const browser = nbcBrowser({ profile: "my-tiktok-profile" });
await browser.start();
const path = "state.json";
const state = withSettings(await loadState(path), { creators: ["rivalwear"], keywords: ["acme"] });
const result = await runPass({ browser, state });
await saveState(path, result.state);
```

`nbcBrowser` runs `nbc --profile <name> <command> … --format json` and reads nbc's `{ok, data, error}` envelope. By default it uses the app's own setup:

| Setting | Default |
| --- | --- |
| Runtime root | `~/.nextbrowser/runtime` on macOS, `<userData>/runtime` elsewhere |
| Environment | the same `CLAWBROWSER_*`, `NBC_PROFILE_ROOT` and `NEXTBROWSER_CONFIG_DIR` values the app passes |
| Binary | the app's managed `nextctl`, otherwise `nbc` from `PATH` |

With these defaults it can drive the profiles the app manages. Override the runtime root with `runtimeRoot`, the binary with `binary`, and add browser switches with `browserArgs`. Note that nbc refuses browser switches on proxied profiles.
