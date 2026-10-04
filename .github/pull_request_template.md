## Summary

<!-- What changed, why, and the impact on users of Nextbrowser or the CLI. -->

-

## Related issues

Closes #

## Change type

- [ ] Bug fix
- [ ] Change to what is read from tiktok.com (page scripts)
- [ ] Change to keyword matching, urgency triage or engagement thresholds
- [ ] Feature or enhancement
- [ ] Documentation or translation
- [ ] Maintenance or tooling

## Validation

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Checked live against tiktok.com (describe the profile, signed in or not, and the result below)

```text
Commands and results:

```

## Page script changes

<!-- For changes to src/scripts.ts: the page or endpoint, the data key or selector, the shape observed and the date, and the fixture added. Write "Not applicable" otherwise. -->

## Checklist

- [ ] The engine stays read-only, forges no signatures, and keeps its pacing limits.
- [ ] Nothing outside `src/node/` imports Node.
- [ ] README translations are synchronized, if the README changed.
- [ ] No credentials, cookies, personal data, or generated `dist/` output are committed.
