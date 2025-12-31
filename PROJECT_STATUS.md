# Pirate Cribbage PWA — Project Status

## Hosting / Stack
- Hosted on Railway
- Node + Express static server
- Socket.IO real-time multiplayer
- Client: vanilla JS + CSS

## Current Gameplay Flow
1. Join table (2 players)
2. Deal 6 cards each
3. Discard 2 to crib (crib builds to 4)
4. Cut card
5. Pegging phase:
   - Turn-taking
   - GO logic
   - Auto-solo behavior when opponent has no cards
   - Pegging scoring: 15, 31, pairs, runs, last card
6. Show phase:
   - Non-dealer scores hand (with breakdown)
   - Dealer scores hand (with breakdown)
   - Dealer scores crib (with breakdown)
7. Next Hand
8. Game ends at 121:
   - Server enforces GAME OVER stage
   - Displays winner + final scores
   - Buttons: Next Game (match continues) / New Match (reset)

## Scoring / UI
- “Show” includes detailed breakdown items (fifteens, pairs, runs, flush, nobs)
- Pegging HUD shows:
  - Count (prominent)
  - Last scoring event (prominent)
  - Pile of pegging cards displayed graphically
- Cribbage board:
  - SVG “Option B” board with major/minor tick marks and labeled 0..121
  - Pegs move based on current game score
- Match score:
  - Visual “pips/medallions” for games won per player (e.g., 3–2)

## Pirate Theme / Visuals
- Rope accents around panels
- Anchor mark in header
- Brass/gold styling

## Key Technical Notes
- `hands` preserved for show scoring
- `pegHands` consumed during pegging
- Server prevents pegging stalls when one player has no cards remaining
- Server prevents dealing after GAME OVER until “new_game” or “new_match”

## Next Improvements (Planned)
- Add “cribbage board track” polish (more nautical textures, rope corners, optional skull markers)
- Improve mobile spacing further (bigger touch targets on smaller screens)
- Add optional sound cues (peg score ding, GO call)
- Add “New Game confirmation” and match length settings (best-of-N)
