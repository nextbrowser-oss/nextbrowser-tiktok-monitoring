# Contributing to Nextbrowser TikTok Monitoring

Thank you for helping improve the TikTok monitoring engine behind Nextbrowser. Contributions of all sizes are welcome: bug reports, fixes to how tiktok.com is read, better triage rules, tests, documentation, and new features.

Please keep contributions focused, factual, and easy to review. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a small fix, a documentation correction, or a test improvement, open a pull request directly.
- For a new kind of event, a new source, a new triage rule, or a new dependency, open an issue first so the approach can be discussed.
- Do not report security vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).

## Development setup

You need Git and Node.js 22 or later. A live check additionally needs [Nextbrowser](https://github.com/nextbrowser-oss/nextbrowser-app) and a profile; sign it in to tiktok.com to check your own videos and mentions.

```bash
git clone https://github.com/YOUR-USERNAME/nextbrowser-tiktok-monitoring.git
cd nextbrowser-tiktok-monitoring
git remote add upstream https://github.com/nextbrowser-oss/nextbrowser-tiktok-monitoring.git
npm ci
npm test
```

## Repository structure

| Path | What lives there |
| --- | --- |
| `src/engine.ts` | The pass: landing, account, creator pages, videos, comment lists, engagement, parking the tab. |
| `src/scripts.ts` | The page scripts evaluated on tiktok.com and the paths they read. Each one is a single JSON-returning expression. |
| `src/keywords.ts`, `src/triage.ts`, `src/items.ts`, `src/counts.ts`, `src/ids.ts` | Pure rules: what matches, how urgent it is, how a video or a comment becomes an item, how a printed count is read, what a video id says. |
| `src/state.ts`, `src/events.ts` | The state document, settings, and events: the public contract. |
| `src/node/` | The Node adapter: nbc browser, state file, CLI. The only code allowed to import Node. |
| `src/testing/` | The fake tiktok.com used by engine tests. |
| `scripts/` | Maintenance helpers, such as the README terminal renderer. |
| `docs/` | Documentation and the README translation. |

## Ground rules for this engine

- **Read-only.** The engine must never like, comment, reply, follow, share, save, send a message, or change a setting on tiktok.com, and it never clicks, types or scrolls. Every request is a `GET`. `src/core.test.ts` checks the scripts for the obvious ways to break this.
- **No forged signatures.** The engine does not compute TikTok's `msToken`, `X-Bogus` or similar values, and does not solve captchas. When TikTok wants either, the engine reports it and stops or skips; a person decides what to do.
- **Triage stays explainable.** Every rule adds points and a reason a person can read. A rule that cannot say why it fired does not belong here, and neither does a call to a model or any other service.
- **The core stays browser-safe.** Nothing under `src/` outside `src/node/` may import a Node module or use `process`. `src/core.test.ts` fails if it does, because the app runs the core in its renderer.
- **Passes stay pure.** `runPass` never mutates the state it is given, and it never sleeps longer than the pause between two pages or the bounded wait for a creator page to draw. Timers and storage belong to the host.
- **Pacing limits stay.** Do not lower the minimum pass interval, the pauses between pages and fetches, the back-off after a captcha or a rate limit, or the caps on creators, keywords, videos and comment lists.
- **Explain site knowledge.** A data key, a selector, a status code, or a quirk of tiktok.com gets a comment saying what tiktok.com does and why the code handles it that way.

## Changing what is read from tiktok.com

A change to a page script or a path needs:

1. a stand-in page or answer in `src/scripts.test.ts` reproducing what tiktok.com served, trimmed from a real one, with personal data removed;
2. a test that fails without the change;
3. the page or endpoint and the date it was observed, in the pull request.

Where possible, run the changed read once against a live profile and describe the result in the pull request, for example with `node dist/node/bin.js once --profile <name> --verbose`. The engine has not been verified live yet, so a pull request that does this for any read is especially welcome.

## Changing the triage

A new rule, or a new weight, needs a case in `src/rules.test.ts` for an item it should rank differently and one it should leave alone, and an update to the table in [how it works](docs/how-it-works.md#7-urgency-triage).

## Required checks

```bash
npm run typecheck
npm test
npm run build
```

If a check cannot be run on your platform, say so in the pull request. Do not claim a check passed if it was skipped.

The terminal image in the README is generated from the CLI's own formatters. After changing CLI output, regenerate it:

```bash
npm run build && npm run render:terminal
```

The sample output in [the walkthrough](docs/walkthrough.md) and the [CLI reference](docs/cli-reference.md) comes from the same formatters; update it when they change.

## Documentation and translations

`README.md` is the canonical English README. A semantic change to it must also update [`docs/i18n/ru/README.md`](docs/i18n/ru/README.md). Keep commands, paths, and product names identical, and check relative links from each file's location.

Do not add unverified features, platform support, metrics, or screenshots.

## Commits and pull requests

Use Conventional Commit prefixes in the imperative mood:

```text
fix: read the view count from the grid's new label
feat: rank a comment that names the brand's shop
docs: explain why comment lists are read only when the count grew
```

A pull request should include the problem and the chosen solution, links to related issues, the checks you ran and their results, and any risks or follow-up work. Keep it free of generated `dist/` output, credentials, cookies, and personal data from tiktok.com.

Thank you for making Nextbrowser better.
