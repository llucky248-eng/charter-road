# Charter Road — BACKLOG (small, shippable items)

Ordering principle: smallest, safest, highest player value first.

## Contracts
1. **Contracts v2: compass arrow to destination**
   - Acceptance: when a contract is active, an arrow points toward destination city; updates as you move.
2. **Contracts v2: pinned HUD line (Active contract)**
   - Acceptance: HUD shows qty/item/destination/reward; hidden when none active.
3. **Contracts: minimap destination marker (city icon)**
   - Acceptance: destination city highlighted on minimap; no clutter.
4. **Contracts: reward scaling**
   - Acceptance: rewards depend on qty + rarity; feels better than flat rewards.

## Rep / Permits depth
5. **Road checkpoints / patrol encounter**
   - Acceptance: only triggers on road; uses rep/permit to modify outcomes.
6. **Rep effects tuning**
   - Acceptance: clear feedback when rep changes; avoid excessive punishment.

## UX / Mobile
7. **Market: explicit on-screen Close + Confirm buttons**
   - Acceptance: no keyboard needed for core market actions.
8. **Event sheet: improve tap targets + choice feedback**
   - Acceptance: clear selection highlight; no accidental taps.
9. **HUD layout polish**
   - Acceptance: no overlap with minimap/buttons; readable on small screens.

## Content
10. **Add 2–3 more roadside POIs**
    - Acceptance: minimap shows POIs; E interact works.
11. **Biome patches pass (forest/swamp density)**
    - Acceptance: more varied travel; no performance hit.

## Tech / Reliability
12. **Boot self-test (canvas writable + devlog fill)**
    - Acceptance: if fail, show fatal overlay with actionable guidance.
13. **Pages checker automation**
    - Acceptance: script detects version mismatch or devlog Loading…
