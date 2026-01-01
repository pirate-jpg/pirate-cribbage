# Pirate Cribbage — Project Status (Jan 2026)

## Live
- Hosted on Railway, Express + Socket.IO server serving `/public`.

## Game Flow
1. Join table (2 players) with name entry (overlay “Set Sail”).
2. Deal 6 each.
3. Each discards 2 to crib (crib has 4).
4. Cut card revealed.
5. Pegging phase:
   - Turn-taking
   - GO handling
   - Auto sequence reset at 31 and when both cannot play
   - Special case: if opponent is out of cards and remaining player is blocked, sequence ends + resets (no stall)
6. Show scoring:
   - Hand + crib scored with breakdown list (15s/pairs/runs/flush/nobs)
7. Next hand (dealer alternates)

## Scoring Implemented
### Pegging
- 15 for 2
- 31 for 2
- Pairs / trips / quads
- Runs (3+ from most recent cards, no duplicates)
- Last card for 1
- Fix: no-stall when opponent has 0 cards

### Show
- 15s (combinations) with count
- Pairs with multiplicity
- Runs with multiplicity
- Flush (crib requires 5-card)
- Nobs
- Show panel displays “Crib (DealerName)”

## End Conditions
- Game ends at 121+ (no more dealing hands after win)
- Match wins tracked (first to 3 wins by default)
- “Next Game” starts new game (scores reset, dealer alternates)
- “New Match” resets match wins and game

## UI
- Stable max-width layout to reduce screen-to-screen differences
- Large, colored cards with amber highlight on selection (no blue/white)
- Prominent GO button
- Pegging count large and central
- Match wins shown as pips
- Cribbage board (Option B style) with peg positions 0–121

## Files
- `server.js` — game state, Socket.IO, scoring, match/game end logic
- `public/index.html` — layout + join overlay
- `public/js/app.js` — client UI rendering + actions
- `public/css/styles.css` — theme + layout + cards
