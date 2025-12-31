# Pirate Cribbage – Project Status

## Goal
2-player pirate-themed Cribbage game playable on iPhone via browser (PWA-style), hosted on Railway.

## Stack
- Node.js
- Express
- Socket.IO
- GitHub repository
- Railway hosting

## Current State (Working)
- Players join a table by code
- Server deals 6 cards each
- Each player discards 2 cards to the crib
- Pegging phase:
  - Turn-taking
  - GO logic
  - Pegging scoring: 15, 31, pairs, last card
- Show phase:
  - Scores both hands and crib
  - Full scoring breakdown displayed:
    - Fifteens
    - Pairs
    - Runs
    - Flush
    - Nobs
- Graphical card UI (card-shaped tiles with suits and ranks)

## Important Implementation Detail
- `hands` are preserved for show scoring
- `pegHands` are consumed during pegging

## Files
- `server.js`
- `public/index.html`
- `public/js/app.js`
- `public/css/styles.css`
- `package.json`

## Next Planned Work
1. Add **pegging run scoring**
2. Improve pirate visuals (rope/wood/gold styling)
3. Add cribbage board track to 121
4. Add game end at 121 and “New Game” option
