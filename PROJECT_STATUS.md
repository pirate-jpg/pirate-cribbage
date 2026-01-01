# Pirate Cribbage PWA — Project Status (2026-01-01)

## Working
- 2-player Socket.IO join + table
- Deal 6, discard 2 to crib
- Pegging phase with:
  - turn-taking
  - 15 / 31 / pairs / last card
  - run scoring (server-side)
  - graphical pile display
- Show scoring with breakdown (15s / pairs / runs / flush / nobs)
- Pirate-themed UI baseline
- Captain’s Log removed from UI (per request)

## Fixed in this update
- Frontend was broken because `join_table` was never emitted.
- Discard selection UI was removed in error.
- GO button visibility/behavior restored to “only when GO is valid”.

## Next Up
- Confirm GO edge-case stall is fully solved in server logic (if still reproducible).
- Game-end at 121 + match wins UI (if not already stable in current server.js).
- Improve board/rope realism (Option B visuals) without breaking layout.
