# Charter Road — STATUS

**Stage:** Verify / Ship
**Current item:** Contracts v2 — compass arrow to destination (mobile-first)

## Definition of Done (DoD)
- [ ] Game boots on iPhone (no black screen; devlog not stuck on Loading…)
- [x] Active contract shows a compass arrow pointing toward destination city
- [x] Arrow is unobtrusive on mobile HUD and doesn’t overlap buttons
- [x] Bump version + cache-bust (index loader `main.js?v=...`) — v0.4.50
- [ ] GitHub Pages serves new version and renders

## Last shipped
- Version: v0.5.8
- URL: https://llucky248-eng.github.io/charter-road/

## Notes
- If Pages serves stale HTML/JS, use `?v=<n>` and bump loader query.
- Never ship silent failures: boot/fatal overlay must stay.
- CI now runs unit+parity tests on every push (.github/workflows/test.yml).
