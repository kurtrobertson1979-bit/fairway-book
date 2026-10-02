# Fairway Book

A golf app for our group: scorecard, WHS handicap tracker, GPS rangefinder, stats and the long-running record of every round we play. It is a web app you install on your phone's home screen. It works offline and needs no app store, no accounts and no subscription.

## What it does

**Scoring (one phone scores the whole group)**
- Stroke play, Stableford, better-ball Stableford, singles match play, four-ball match play, skins
- WHS playing-handicap allowances built in (95% / 85% / 90% / 100% difference), editable
- Strokes received shown as dots on each hole; live points, net score and match status
- Picked up (P/U) scores net double bogey, which is 0 Stableford points
- Optional stats per hole: putts, fairway (left / hit / right), bunker, penalties
- Scorecard with circles for under par and boxes for over par, Out / In / Total
- Moves to the next hole once everyone has a score
- Side bets: nearest the pin, longest drive, notes

**Handicaps (World Handicap System, as used by England Golf and Scottish Golf)**
- Score differential = (113 ÷ Slope) × (Adjusted Gross − Course Rating − PCC)
- Net double bogey hole cap; unplayed holes count as net par; 14 holes needed for an 18-hole score
- Best 8 of the last 20, plus the table for players with fewer than 20 scores
- Soft cap and hard cap against the 365-day low index; exceptional score reduction
- 9-hole scores using the 2024 expected-score method
- "To bring it down": the adjusted gross you need on each saved course to lower your index
- Course-handicap calculator for every format
- Add past scores from the England Golf app to start with a real history

**GPS rangefinder**
- Front, centre and back of the green, live, in yards or metres
- Satellite map: tap anywhere for distance to that spot and from there to the green
- Bunker and water reach / carry distances (where OpenStreetMap has them)
- Wind strength and direction relative to the hole (into, helping, left-to-right)
- Shot tracking: pick a club, mark your ball, and your average for every club builds up
- Caddie mode: a full-screen black-and-white yardage for bright sun
- Keeps the screen awake during a round

**Courses**
- All 2,116 named golf courses in England are built in (from OpenStreetMap); search by name or "near me"
- Hole layouts (tees, greens, bunkers, water) load from OpenStreetMap where volunteers have mapped them
- Clubs with several courses (e.g. Woburn) let you pick the right layout
- No map for your course? On the course page, tap each green on the satellite photo. Ten minutes at home is enough
- Save the map for offline use before you go

**Stats and the journey**
- Average Stableford and gross, best round, fairways, greens in regulation, putts, scrambling, sand saves, penalties
- Scoring mix (birdies, pars, bogeys…), average by par 3/4/5 and by stroke index band
- "Where the shots go": plain-English pointers from your numbers
- Holes that bite and favourite holes at courses you play often
- Head-to-head records between the lads
- Trips (a weekend away, a season) with a running Stableford leaderboard
- Achievements: first birdie, broke 90, 36 points, sandy, back-to-back birdies and more

## Sharing with the lads

Everything is stored on the phone, with no server and no logins. To keep everyone's history in step:
- **Send round to the lads** on the round summary creates a share code. Paste it in the WhatsApp group.
- Each of them taps **More → Paste a share code**. Rounds merge by ID, so nothing is duplicated.
- **Save backup file** / **Open backup file** copies the whole lot between phones.

## Before the weekend

1. Open the app link on each phone and install it (Android: menu → *Install app*; iPhone: Share → *Add to Home Screen*).
2. On the scorer's phone, add the lads with their current Handicap Index from the England Golf app.
3. Find the course under **More → Courses**, save it, then:
   - enter the **Course Rating and Slope** for each tee and the **par and stroke index** for each hole (from the scorecard or the club website)
   - tap **Load hole maps**; if OpenStreetMap has none, use **Map it yourself**
   - tap **Save map offline**
4. Optional: add each player's recent scores under **Handicap → Past score**.

## Hosting

GPS only works when the page is served over HTTPS. Any static host works: GitHub Pages, Netlify Drop (drag this folder onto https://app.netlify.com/drop) or Cloudflare Pages. There is no build step; upload the folder as it is.

To try it on a PC: `node dev-server.mjs`, then open http://localhost:8080.

## Samsung Galaxy Watch

Galaxy Watch 4 and newer run Wear OS, which can't install web apps. A watch version would be a small separate native app (Kotlin). It would show front/centre/back from the watch's own GPS using the course maps from this app. It's a good phase-two project. Until then, use caddie mode on a phone in a trolley or cart holder.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css` | App shell and styling |
| `js/whs.js` | World Handicap System maths (pure functions) |
| `js/golf.js` | Scoring formats, differentials, stats, achievements |
| `js/geo.js` | GPS, distance maths, OpenStreetMap import, weather |
| `js/play.js` | Round setup, live scoring, GPS screen, leaderboard, summary |
| `js/courses.js` | Course search, scorecard editor, mapping, offline tiles |
| `js/insights.js` | Handicap and stats screens |
| `js/store.js` | On-phone storage, share codes, backup merge |
| `data/england-courses.json` | 2,116 English courses (name, location, OSM id) |
| `sw.js`, `manifest.webmanifest` | Offline support and install |

Course data © OpenStreetMap contributors (ODbL). Satellite imagery © Esri. Weather from Open-Meteo. The handicap index here is an unofficial guide; only scores submitted through your club count for your official England Golf index.
