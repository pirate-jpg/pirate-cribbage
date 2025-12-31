# Pirate Cribbage – Project Status

## Goal
A 2-player pirate-themed Cribbage web app (PWA-style) playable on iPhone with a remote opponent (Peggy), hosted on Railway.

## Stack / Hosting
- Node.js
- Express (serves static files)
- Socket.IO (real-time multiplayer)
- GitHub repo
- Railway deployment

## Current Flow (Working)
1. **Lobby / Join**
   - Two players join the same table code.
2. **Deal**
   - Server deals 6 cards to each player.
3. **Discard to Crib**
   - Each player selects 2 cards to discard.
   - Crib totals 4 cards.
4. **Pegging**
   - Turn-taking with a shared running count up to 31.
   - GO supported.
   - Pegging scoring supported:
     - 15 for 2
     - 31 for 2
     - pairs / trips / quads
     - last card
     - **runs during pegging** (longest valid run in the most recent sequence, min length 3)
5. **Show**
   - Scores both hands and the crib.
   - Displays full scoring breakdown:
     - fifteens
     - pairs
     - runs
     - flush
     - nobs
6. **Next Hand**
   - Dealer alternates and new hand begins.

## Key Implementation Detail (Do Not Break)
- `hands` are preserved for Show scoring.
- `pegHands` are consumed during pegging play.
- This prevents Show from scoring empty hands after pegging.

## UI/UX Features Implemented
- **Graphical card UI** (card-like tiles with suit, corner ranks, red/black coloring).
- **Show scoring panel** with itemized breakdown (e.g., “3 fifteens = 6”).
- **Pegging display improvements**
  - Graphical cards displayed as they are played (pile display).
  - Clear running count display.
  - “Last scoring event” callout (e.g., “run of 3 for 3, 15 for 2”).
  - Improved visibility of turn state.
- **Cribbage board (basic)**
  - Visual track to 121 with two pegs driven by scores.

## Files
- `server.js`
- `public/index.html`
- `public/js/app.js`
- `public/css/styles.css`
- `package.json`

## Known Gaps / Next Planned Work
1. **Make the board nicer / pirate-themed**
   - wood/rope/brass styling, markers, labels, “skunk line”
   - better spacing/track detail
2. **Game end at 121**
   - declare winner, prevent further play, “New Game” / reset option
3. **Pegging UX polish**
   - better GO handling for edge cases
   - animations for played cards
   - clearer prompts when you must say GO
4. **Art / Theme polish**
   - pirate UI elements (rope borders, parchment panels, themed buttons/icons)

## Notes
- Railway + GitHub are the source of truth; this file exists so a new chat can resume instantly.
