# Charter Road — STATUS

**Stage:** Implement
**Current item:** Contracts v2 — compass arrow to destination (mobile-first)

## Definition of Done (DoD)
- [ ] Game boots on iPhone (no black screen; devlog not stuck on Loading…)
- [ ] Active contract shows a compass arrow pointing toward destination city
- [ ] Arrow is unobtrusive on mobile HUD and doesn’t overlap buttons
- [ ] Bump version + cache-bust (index loader `main.js?v=...`)
- [ ] GitHub Pages serves new version and renders

## Last shipped
- Version: v0.0.53
- Commit: b1628fe
- URL: https://llucky248-eng.github.io/charter-road/

## Notes
- If Pages serves stale HTML/JS, use `?v=<n>` and bump loader query.
- Never ship silent failures: boot/fatal overlay must stay.
