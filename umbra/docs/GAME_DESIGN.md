# UMBRA: Shadow Caravan, Final Game Design

> **Status: proposal, not yet approved.** Generated on 11 Oct 2026 by a research and design run (10 researchers, 12 claim checks, 6 competing concepts, 3 judges, a critic and a revision). Only 1 of 12 critical market claims was confirmed, 5 were partly or fully refuted and 6 could not be verified, so treat market facts as weak and the doc's own labels (A assumption, E estimate, U unproven) as binding. **The 12-15 hours a week used for every date in section 13 was an assumption supplied to the design agents, not a figure the owner gave.** Change it and the dates move. Decisions are listed in section 16.

*Lead-designer brief, 11 Oct 2026, revised after review. Tags: (A) assumption, (E) estimate, (U) unproven or unverified. 1 dev-day = 6 h. Capacity is 12-15 focused hours a week in total. I assume about 3 h of that goes to non-dev work (A): playtests, reviewers, the demand poll, trademark and lawyer checks, and marketing clips. That leaves 9-12 h, or 1.5-2.0 dev-days a week. Dates use the midpoint of 1.75 dev-days a week, so 1 dev-day is about 4 calendar days, or about 5 with a 25% contingency (E). Every score below is a judge's opinion from written designs. Nothing has been playtested or run on a real projector.*

## 1. Decision summary

- **The game.** *Shadow Caravan* is the working title. Two room-assigned teams race two lanterns down mirrored lanes on the wall, and the road is made of real hand and prop shadows. It is built on Lantern Run's chassis. The best parts of Echo Dunes, Shadow Academy, Fanoos Gates and Shadow Sahra are grafted on, and Lantern Keepers is cut.
- **Why this winner.** The raw judge average ranks Shadow Academy first (7.37), Echo Dunes second (7.23) and Lantern Run third (6.93). Each of the top three was ranked first by exactly one judge. Reweighting solo feasibility x2 and fairness x1.5 gives 7.11 / 7.11 / 7.05, which is a tie. So I decide by gates, not averages. Only Echo Dunes and Lantern Run clear "solo feasibility of at least 5". Lantern Run has the best fairness score (9.0) and the smallest first slice. Its only prototype evidence is a synthetic determinism check: mirrored lanes ran in identical time. That shows the physics is deterministic, not that two physical lanes are fair. Echo Dunes becomes the expansion.
- **Bright-field art (engine rule).** The engine reads anything dark on the wall as shadow. Every skin, silhouette, border and piece of text is therefore drawn as bright, saturated art on a white or bright ground. The night feel comes from motifs, never from darkness (section 2).
- **Teams.** Players scan, get a preset nickname and icon, and make one optional tap: little, kid, teen or adult. Before the draw the host can link families with one tap (skippable). A short Light Check rates players: about 50 s for 7 players in the first build. The host device runs `assign()` and draws two balanced teams, followed by a 20 s reveal. Nobody picks a team. The re-draft after leg 1 exists but is off in the first build.
- **Fairness.** I assume the bigger team loses per head to the game's own mechanics (Reading A). Both teams get equal scoring seats, and spare players become Coaches with zero score effect and no richer information than the wall shows. Legs use one team clock. Means are used only where individual results are pooled (Pit Stop card slots, Charades). One disclosed catch-up of at most 10% and a signed size correction capped at plus or minus 2% (off by default) exist but are hidden in the first build. This is modelled, not proven. The simulation is a head-count symmetry check, not evidence about the race.
- **Skill.** Players get better at shadow craft: forming time, steadiness, scale control and anticipation. The camera measures it. Each player sees their own numbers on their own phone, and the wall shows only team-level gains. The before/after screen ships only after the measurement noise is known. The claim is "faster and steadier at this game's shadow tasks", nothing wider.
- **Knowledge.** Picture-first tiered "Pit Stop" cards fill a continuous Oil gauge. Each full flame either cancels a fall or opens a Bypass door, so knowledge visibly changes the race. The procedural "Predict and Test" finale turns a prediction into a live shadow act and is in the first paid build. Every leg is clearable with zero knowledge. Knowledge counts as a pillar only if playtests show Oil changes who wins a leg.
- **Replay, said plainly.** Version 1 is about 2-3 Nights of fresh play (E), not an endless loop. It has 3-6 modules, 2-4 courses and 120 trivia items. Replay grows with Charades, the composer and content updates.
- **Sales.** The host buys once, guests join free, there are no ads, and delivery is web-first. Proposed Founder price is KWD 3.5 / SAR 39 / AED 39 (not market-tested). Dates below are at 1.75 dev-days a week, from the base estimate to +25% contingency (E):
  - A paper-and-laptop family session (P1-lite) in early Nov.
  - The two-lane playtest build (P1) on 25 Dec to 12 Jan.
  - **Option A, Kuwait-only Express Founder** (34.0 dev-days, manual-code pilot sales): 25 Feb to 31 Mar 2027.
  - **Option B, full Founder** for all markets (49.0 dev-days): 26 Apr to 14 Jun 2027.
  - So 2026-27 is a validation season, and the full product targets 2027-28. Section 13 has the table, the levers and the contingency.
- **Unproven.** Five things are unproven: shadow detection and latency on real hardware, whether the fair-team rules balance real rooms, whether mixed-family seating works in Gulf households, willingness to pay, and projector access at camps. Day 1 of the build is a real-projector, latency and noise test.

## 2. The game

**Name options (none cleared).** Candidates are *UMBRA* (the project name) and *Shadow Caravan / قافلة الظل*. I dropped *Fanoos Run*: the fanous leans seasonal toward Ramadan, so "Fanoos Nights" is only a possible title for the Ramadan skin. I searched no trademark register in Kuwait, KSA, the UAE or elsewhere. "Umbra", "Lantern Run", "Echo Dunes" and "Fanoos" are common words that other products likely use. Run a clearance search in classes 9, 28 and 41 before printing a name. Also avoid the format names Jackbox, Huruf, Millionaire, Mkhmkh and Seen Jeem.

**One-liner.** Two caravans, one wall. The room splits everyone into two teams, each team's lantern rolls down its own mirrored lane to the Oasis, and the only road is the shadows your hands and props throw.

The lantern is a plain round camp lamp in the default skin. The ornate fanous shape and crescents appear only in the Ramadan skin.

**Pillars**
1. **The shadow is the road.** Replace shadows with "drag a bar on a phone" and the game turns into an ordinary draw-physics game.
2. **The room decides.** There is no team picker anywhere.
3. **Fair by structure, not bonuses.** Equal seats and one clock do the work.
4. **Knowledge becomes a shadow act and never gates play.** Provisional: it earns pillar status only if Oil measurably changes leg outcomes in playtests.
5. **Skill that shows within a session, measured honestly.** Nothing is promised until the measurement noise is known.
6. **A defined end and an honest "one more?"** No dark patterns.

**Bright-field rule (engine constraint).** The engine paints the background white (`#ffffff`). The detector marks a cell as shadow when it is below 0.3 of the calibrated white, so dark ink becomes a solid wall for the lantern. A test enforces that every drawn colour keeps one channel near full. For this design that means:
1. Every skin is bright-field art: a white or bright ground and saturated colour. Stars, lamps and dune outlines are drawn in saturated colour.
2. There is no black, grey, dark blue or dark green anywhere on the wall, including borders, silhouettes and text. The "pale unlit lanterns" in the lobby are cream or pale tints with a saturated outline.
3. All text, HUD, code and score zones sit in a reserved band registered as a detector ignore rect (`setIgnore`), where dark text is allowed. Anything outside that band is drawn bright.
4. Pit Stop and reveal silhouettes are drawn as saturated colour fills, or vision is paused while they show.
5. Team colours, emblems and borders are added to the palette brightness test before use.
6. Okabe-Ito Bluish Green #009E73 (peaks at about 0.34 in linear light) and Blue #0072B2 (about 0.45) are not used for projected team colours. They sit near the threshold and flicker under vignetting.

**What the player has to learn: rule layers.** Rule load was too high, so rules arrive one layer at a time. Each layer is timed with families (P1-lite or P1) before it ships.
- **Layer 0 (first build, the Express Night):** the room makes the teams, the seat rule (Caster, Pilot, Coach), Oil flames, and a host-decided run-it-back.
- **Layer 1:** Safe/Bold routes, the two-ring Light Check and the team-level Curtain Call, and cosmetic awards.
- **Layer 2:** the visible Moonrise boost, the re-draft after leg 1, and the act break (tent swap, keep or shuffle).
- **Layer 3:** Charades, opt-in assists, and Buddy Pose for linked households.

**The three-sentence rule script (to be timed in P1-lite and P1; target 60 s or less read aloud (A)).**
1. "The room splits you into two teams, and each team has one lantern on its own lane."
2. "Your shadows are the road: two people make shadows, one steers with two arrows, and anyone left over is the Coach who calls out what is coming; everyone takes turns."
3. "Answer the picture card first, and your lantern gets flames that save it from a fall."

**One full session, a 4v3 room.** Dad, Mum, Grandpa, Uncle Jassim, Sara (12), Faisal (9) and Noor (4, a second profile on a parent's phone). Layer 2 items are marked and are absent from the Express Night.

| Time | What happens |
|---|---|
| 0:00 | The host opens the game on the projector, and the black/white calibration flash runs before play. The wall shows the QR and a 4-letter code inside the ignore band. The host device is not a player. |
| 0:30 | Six phones scan. Each gets a preset nickname and icon and one tap: little, kid, teen or adult. Noor is added as a second profile on a parent's phone with the "little" tap. The lobby shows pale unlit lanterns and no teams. |
| 2:00 | The host taps Start. A one-tap step asks "Who is family? Link them" (skippable). Linked players are drawn onto the same team. |
| 2:30 | **Light Check:** two players at a time, one per half-wall, called by nickname and icon, and the phone flashes the player's icon. Each fits a filled shape to a small ring and then a big ring (10 s each). Noor gets the Moon ring, where any hand works. The full two-ring check takes about 100 s at 7 players (E). The first build uses one ring, about 50 s. |
| 4:10 | The draw runs. A 20 s reveal shows **Oryx** (amber, 4) against **Gazelles** (sky blue, 3). Phones turn team colour. The wall shows the three-sentence script as pictograms: "2 Casters + 1 Pilot per team; Oryx's 4th is Coach this leg". |
| 4:30 | **Pit Stop 1** (about 40 s). The topic is "Desert animals". Each profile gets a card at its own tier, and each team has 8 answer slots. The Oil gauge fills, and a one-sentence fact follows. |
| 5:10 | **Leg 1, "Two Dunes"** (60-80 s). Both lanterns drop at once. Casters hold forearms and props in the beam to make a bridge and then a ramp. The Pilot nudges with two big arrows and has the team ping. The Coach reads the next module aloud and can use the same ping. A fall costs a 6 s restart, cancelled by a flame, or a flame can open a Bypass door. The first lantern to light the Oasis gets the photo-finish banner. |
| 6:40 | *(Layer 2)* **Re-draft check**: at most ceil(7/4) = 2 players move, and only if balance improves. Pit Stop 2, then **Leg 2, "Oasis Road"** (a laser to shield, a plate to cover). Seats rotate by least-active first. |
| 9:30 | *(Layer 2)* **Act break, "Swap tents!"** This is a 45 s Camp Break: a recap, the tent swap, and each team casting its emblem animal for fun with no points. Silhouette Charades replaces the animal moment once it ships, with everyone performing a hand-shadow and the other team guessing. Then phones vote keep or shuffle, and the host confirms. |
| 15:00 | **Act 2:** Pit Stop 3, which includes a shadow-science card, then **Leg 3, "Narrow Pass"**. **Leg 4, "Star Road"** is the finale. Each team picks Safe (wide) or Bold (narrow, about 5 s faster (E), with stars). Pit Stop 4 is **Predict and Test**. |
| ~22:00 | *(Layer 1)* **Curtain Call:** the Light Check again, with new targets of equivalent size and shape, in counterbalanced order. The wall shows a team-level line only when it improved ("Gazelles: 20% quicker than at the start"). Each player sees their own before and after on their own phone ("Sara: 7.2 s to 3.4 s"). Regressions are never shown. |
| ~23:00 | The higher total wins. Awards are computed from game state and are cosmetic, with zero points (Early Bird, Steady Hands, Sharp Eyes, Most Improved). A spoiler-free recap card is drawn from game state, not camera pixels. The host decides "Run it back?", which reshuffles teams, and "Stop" is as prominent as "Again". The phone vote is advisory. There is no auto-queue. |

**Express Night (the first paid build, no act break).** It runs: minimal Light Check, Pit Stop 1, Leg 1, Pit Stop 2, Leg 2, Predict and Test, and Leg 3 as the finale (the lane sides swap before the finale for physical symmetry). Then comes the recap and the host-decided "Run it back / Stop". It takes about 12-15 minutes (E). The full Night runs about 23-27 minutes with Charades (E). All timings are estimates.

## 3. Teams: automatic assignment on scan

All of this runs on the **host device**, which is authoritative and already holds the Light Check results. The relay only forwards messages and stays stateless. This moves `assign()` off the relay, which the earlier spec used, so no server state is added. The RNG is seeded (roomId + act number). The host saves a room snapshot (players, ratings, teams, act) to localStorage inside try/catch, so a host reload reproduces the same teams. If the snapshot is lost, the room restarts at the next boundary with a fresh draw. The logic sits behind one `assign()` seam, so host-picked or family teams can replace it later.

**Algorithm**
1. **Join.** Scan the QR and get a preset nickname and icon from a fixed table with Arabic and Latin forms. No typing is needed. Make one optional tap: little (reads little, about 6 or under (A)), kid (up to 12), teen (13-17) or adult. No birthdate and no gender are collected. A parent can add a child as a second profile on the same phone (up to 2 profiles per phone (A)), and each profile has its own nickname, icon and tap. A returning phone supplies its device-local rating.
2. **Family step and Start.** The host taps Start. A one-tap "Who is family? Link them" step follows, on by default and skippable. Linked players are an atomic unit in the draw. There is no auto-start. The Start button pulses after 20 s with no new joiner once N is at least 4.
3. **Rating.** est = (2 x prior + sum of measurements) / (2 + count). Priors are little 0.45, kid 0.60, teen 0.85, adult 1.00 and unknown 0.85 (placeholders, A). The Light Check is the measurement. The rating is never shown to anyone, and no one sees another player's times. A player sees only their own times on their own phone.
4. **Draw.** Team sizes differ by at most 1. The code enumerates every split, which is under 1,000 for N up to 12. It minimises J, which is 1.0 x the mean-skill gap, plus 0.03 per unit of age imbalance beyond 1 (little counts in the kid band), plus 0.25 per team with no teen or adult when avoidable, plus 0.08 x the share of last act's teammates. It picks randomly among splits within 0.02 of the best. Join order never decides.
5. **Reveal.** 20 s. Each team gets a name, colour, emblem and a hand-shadow animal to cast as its celebration pose. The emblem is drawn as a saturated colour fill.
6. **Re-draft after leg 1 (Layer 2, off in the first build).** The new ratings come from real play. Adopt the new target only if at most ceil(N/4) players move and J improves by at least 0.03. Otherwise apply up to floor(maxMoves/2) of the best swaps. It is off at launch because "being moved twice looks like a bug to kids". The cost is disclosed in section 4: lopsided rooms stay common in the model.
7. **Lock the act.** At every leg boundary admit late joiners, restore returners and set seats. Seats are S = min(3, smaller team). The S least-active members of each team play, and the rest are Coaches. Among the seated players, two Casters come from the same host-set side where sides are set (always possible at S=3 by pigeonhole), and the remaining player is the Pilot.
8. **Act break (Layer 2).** Phones vote keep or shuffle and the host confirms. Neither option is highlighted, and a tie shuffles (A). A shuffle re-runs step 4 with the repeat-teammate penalty. A shuffle is forced if one team led the act by 25% or more (A). A Night has a single act break, so the rule can fire there, and "Run it back" reshuffles anyway.

| Situation | Rule |
|---|---|
| Late joiner | Shown "you're in, joining next round". At the next boundary they go onto a smallest team, placed where J is lowest, and their rotation counter starts at that team's median. After the finale starts, new joiners are audience only. |
| Disconnect | The seat is held 60 s. The score is the mean over present seats, and nothing is recomputed or penalised. After 120 s away, the player stops counting toward balance. |
| Reconnect | A token (URL fragment plus localStorage) restores the same player, team and seat. If the token is lost, the host merges the new phone with the away ghost. |
| Gap of 2 or more at a boundary | Move one player at a time from the biggest to the smallest team, choosing the mover with the lowest J plus a move penalty. Never move at a gap of 1, and never mid-leg. |
| Team down to 1 while the other has 3 or more | Reshuffle as a new act. Below 4 players, play co-op against the Ghost. |
| 1 to 3 players | N=1 is solo practice against the Ghost. N=2-3 is one co-op team against the Ghost, and the host may force a 1v1 at N=2. The Ghost is a scripted lantern at 0.95 x par, adjusted 3% per result, clamped 0.8-1.2 and disclosed on screen. |
| Host and switching | The host device is never a player. No self-service switching exists. Only the host can swap two players, and every swap is logged. |
| Household link | A one-tap step before the draw, on by default and skippable. Linked players are placed together as one atomic unit. This is not simulated. It is a P1-lite and P1 gate with 3-5 Gulf families (U). |
| Sides (physical seating) | Optional. The host tags names with side 1 or side 2 for physical seating, for example separate men's and women's areas. No gender is collected. It affects only who stands together as Casters, never team choice. Casters are asked to stand on the outer half of their own lane. Untested (U). |
| Shared phone | Up to two profiles. Pit Stop cards arrive profile by profile, little first, and the parent may answer jointly. For teams, Light Check and seats, each profile is its own player. |

**Two versus 3-4 teams.** Launch is two teams (`maxTeams = 2`). Four to ten players is the sweet spot. Eleven or twelve gives 6v6, which is weaker because only 3 of 6 are active. Above 12 the rest are audience, who rotate in at act breaks, least-recently-played first. Three or four teams need three lanes and narrower chambers, which are not designed. The third and fourth team colours would have to pass the palette test (see the bright-field rule). A 4/4/3 split was simulated (see section 4).

**Names and colours (author judgment, to be reviewed by 2-3 Gulf parents).** Do not use "Team A/B". Use Amber #E69F00 and Sky Blue #56B4E9, each keeping one channel above 0.9 of full. Re-run both through the palette test with the emblem and border art before use (U). Each team also gets a distinct emblem and a simple Al Sadu-style border, drawn in saturated bright colour and never in black or dark tones, so colour is never the only cue. Avoid black, white, red with green, and flag or club pairings. Names come from a fixed table with Arabic and Latin forms. The default herd set is Oryx / المها against Gazelles / الغزلان. The concept docs' "Falcons v Oryx" pairing is replaced. The balance spec's naming rule says a falcon only pairs with another bird, a raptor or a sky name, never a prey animal. The other sets are sea heritage and camp night. No dogs, pigs, snakes, scorpions, jinn or crescent logos, and no personal names. Player nicknames come from the same kind of fixed table, with an icon.

**Reshuffle policy.** Teams are locked inside an act. Fixed teams were preferred by 74% in one student study, and arbitrary teams bond quickly. An act is 2 legs plus a break round, and `actRounds` is a config value. The Express Night is a single act with no shuffle. In the full Night, offer shuffle or keep at the act break. A shuffle includes the repeat penalty. Without the penalty, 52-60% of teammate pairs repeat. With it, 39-43% repeat, about the level of a random shuffle (43-45%).

## 4. Fairness with uneven teams

**How I read the owner.** Reading A is mechanical: more heads mean less output per head. The causes are social loafing, turn dilution on one finite beam, and crowding. I assume Reading A. The evidence is general (Ringelmann, Ingham, Karau & Williams) and none of it tests a shared-beam phone game. "Bigger is disadvantaged" cannot be a global rule. In pooled-answer knowledge rounds the bigger team is ahead: the chance of at least one knower is 0.657 / 0.760 / 0.832 for teams of 3 / 4 / 5 at q = 0.3.

Reading B is "just compensate the bigger team". A flat 8% bonus gives the bigger team 76% at 4v3 in the simulation, so I do not ship one. Reading C is that the owner misspoke, and the signed knob flips the sign. The owner's phrase probably means one of two things: the bigger team loses more, or its members get less airtime per person. That question is in section 16.

**Rule set (shipped)**
1. **Equal seats.** S = min(3, smaller team). Seats are 2 Casters + 1 Pilot, or 1 + 1 at S=2. Extras are Coaches, chosen least-active-first with random tie-break.
2. **The Coach has no scoring power and no richer information.**
   - The Coach's phone shows exactly what the wall shows.
   - The team ping (one arrow per 8 s per team on a shared cooldown (A)) is a button on the Pilot's phone as well as the Coach's. A 3-person team has it too, and pressing it from two phones still gives one ping.
   - Every team has a caller each leg, the Coach where there is one and otherwise the Pilot. The caller reads the next module aloud off the wall, which both teams see equally.
   - `spotterScoreEffect = 0` is a config value, not something the room can enforce, because a Coach can still talk and point. So it is measured, not trusted (section 15).
   - Coaches also answer Pit Stop cards, and the role is framed as a promotion.
3. **One team clock.** Nothing is summed across players. A sum of times charges 4v3 a 33% penalty.
4. **Mean scoring where individual results are pooled.** Knowledge cards use fixed slots: 8 per team per Pit Stop, dealt round-robin among all present members, Coaches included. Oil is a continuous gauge. Charades uses the mean of guesser results. Legs do not use means.
5. **Physical symmetry.** Lanes are mirrors, a shadow-area cap of about 25% per lane (A) applies, and the 60 px next to the centre is non-solid (A). Teams swap tents at the act break. The Express Night swaps lane sides before the finale instead.
6. **No all-or-nothing gates.** Where "everyone must hold" appears, use k-of-n with k = ceil(0.75n).
7. **One catch-up (Layer 2).** The Moonrise boost applies to the trailing team only, is disclosed on the wall, and is off in the first build.
8. **One signed size correction F.** It is clamped to plus or minus 2%, off by default, and flippable after telemetry. It is never switched on automatically from room win counts.

**Scoring** (every constant is a tunable default, A):

`P = 100 x Q x F x C`, with F = 1.00 and C = 1 + min(0.10, 0.25 x g) from round 2 (Layer 2; C = 1 in the first build). Here g is the gap between the leader's total and the trailer's, divided by the leader's total. C applies to the trailer only and is shown on the wall.
- Leg: Q = min(1.5, par time / team time). A team not home at the 100 s cap scores 0.5 x its share of the course completed (A).
- Pit Stop: not scored directly. It sets Oil.
- Charades: Q is the mean over the team's guessers of their individual results.
- Awards: cosmetic, zero points. If a vote ever returns, it counts one vote per team (not per head), and nobody votes for their own team.

Example: Dunes lead Oryx 212 to 190 after round 2. Then g = 22/212 = 0.104, and Oryx gets C = 1.026 on round 3.

**What the simulation is, and is not.** The model is an assumption: per-head effort of 1 - 0.07 x (n - 1), a 3-caster beam and assumed skill spread. It is not data. The table is a **head-count symmetry check, not evidence for the Leg**. The result follows from the model's structure: capping both teams at S active seats makes the active head-count identical, so the model cannot show anything else. The race format was not simulated, only point-per-round formats. With teams balanced on true skill, the bigger team's win rate is as follows.

| Rule | 4v3 | 5v4 | 6v5 | 7v5 |
|---|---|---|---|---|
| Naive sums | 58.4 | 49.6 | 43.8 | 33.8 |
| Loafing-based size factor | 78.1 | 77.4 | 75.3 | 61.7 |
| **Equal seats + mean + Coach (symmetry check)** | **50.2** | **50.0** | **50.3** | **49.9** |

Under realistic assignment (age prior plus one noisy warm-up) the equal-seats rule gave 50.6 / 51.1 / 50.8 / 51.3, against a 4v4 control of 51.3. A Coach worth +2% pushes the bigger team to 55-57%, so every +1% is worth about +3 points.

**What it does not fix**
- **The race format was not simulated.** That the seat rule carries over is unproven (U). The real test is to log the normalised team-time ratio per leg, bigger against smaller team, with 4v4 control rooms (section 15).
- **The Coach is physically in the tent.** A Coach can talk, point and use the ping, and only the bigger team has a spare person. The ping button for the smaller team's Pilot and the "no richer view" rule reduce this but cannot remove it. Coach talk is counted on the P1 observation sheet.
- **Lopsided rooms.** Skill-estimate noise, not headcount, dominates: the per-room win chance has a standard deviation of about 28 points, and about two thirds of rooms are blowouts, even in 4v4. A re-draft after leg 1 would cut the deviation to 19.7 points and blowouts to 51%, but it is off in the first build for rule-load reasons. The first build therefore keeps the two-thirds blowout rate (modelled).
- **Total-size loafing.** Equal seats only removes the penalty from acting players. If loafing depends on total team size, 4v3 falls to 42% (half the effect) or 34% (all of it).
- **Airtime per person.** Active share is 4v3: 75% vs 100%. At 5v4 it is 60% vs 75%. At 6v6 it is 50% each. For the benched person, the owner's complaint stays true by design. The Coach job (calling modules aloud), Pit Stop airtime for everyone and an optional "rotate coaches faster" host setting (seats rotate at each checkpoint camp instead of each leg, off by default (U)) answer it. P1 counts how often a benched child asks to swap or complains.
- **Small playtests.** Six to ten rooms detect only gross bias.

## 5. The rounds

**Light Check and Curtain Call (bookends)**
- How it plays: fit your shadow to a glowing filled shape in a bright outline (small ring, then big ring) for up to 10 s (A), one player per half-wall at a time. A hit is IoU of at least 0.6 on a coarse grid (about 20 x 12 cells (A)), held for 1 s (A). The first build uses one ring. A try not finished in the window is recorded as censored, and results are shown in three bands (done under 4 s, done, not done), not as averages of clipped times.
- Time budget (E): each pair takes about 13 s per ring including hand-off. For one ring this is about 50 s at 7 players and about 80 s at 12. For two rings it is about 100 s and about 150 s. The Curtain Call costs the same again.
- Shadow's role: the player's own shadow is what is measured. Distance to the lamp sets its size.
- Phone's role: shows your own time and personal best. The wall never shows individual times.
- Win condition: none in the opening. Most Improved is cosmetic.
- Ages: the Moon ring works with any hand and any prop, so a 4-year-old starts there.
- The Curtain Call uses new targets of equivalent size and shape, not repeats, with the order counterbalanced across players.

**Pit Stop (silhouette riddle)**
- How it plays: before each leg (about 40 s), a topic banner and a big bright silhouette appear. The silhouette is a saturated colour fill, or vision is paused for the 40 s. Each profile gets a card at its tier (table in section 7). Each team has 8 slots. Oil = 3 x correct / 8, and it drains into the next leg as flames.
- Flames: a full flame is spent once, and the team picks one use. It can **cancel one 6 s restart**, or **open a Bypass door** that skips one obstacle module, worth about 8-10 s (A). At about 70% correct a team earns about 2 flames, worth roughly 12-20 s on a 60-100 s leg if used (E).
- Shadow's role: indirect. Oil lets a team recover from shadow mistakes or skip a hard module.
- Phone's role: answer privately, with no buzzers or names.
- Win condition: none. It sets Oil.
- Ages: Tier 1 is two pictures with Arabic and English labels, Tier 2 has 3-4 options with stems of 12 words or fewer, and Tier 3 has near-miss distractors or an estimate.

**The Leg (the core)**
- How it plays: 60-100 s. Both lanterns drop into the same course in mirrored lanes. The first build has 3 modules (Bridge gap, Ramp, Plate cover) and hand-tuned courses. The full game adds Catcher cup, Laser shield and Bold-route stars, and a seeded composer. Falls restart from the last camp in about 6 s. Gaps must be at least 180 px (about 37% of an 80-cell lane (E)), because the engine jumps gaps under about 120-140 px. Camps appear about every 20 s of holding (A), so no Caster holds a pose longer than that without a pause.
- Shadow's role: shadows are the bridges, ramps, catcher cups and laser shields, and a shadow on a plate opens its gate. Casters pre-form the next shape while the lantern rolls. A board or pre-cut shape counts as a prop, which is intended. The guarantee is that no leg is clearable with no shadow at all, and the composer verifier checks it.
- Area cap: above the cap (about 25% of a lane (A)), the lane flashes a visible "too much cover" warning and the newest cover stops being solid until the total drops. Nothing is dropped silently. The cap is tested with a child standing in the beam (P0, P1).
- Phone's role: the Pilot has two big arrows and the ping. The Coach has a lane view identical to the wall, the ping and the call-out job.
- Win condition: P as defined above. First home gets the banner and breaks ties.
- Ages: a child can cast on an adult's lap. The Pilot pad needs no reading. Teens and adults take the Bold route.
- Timing caveat: the detector polls at most at 20 Hz with a 2-frame debounce, so a shadow takes at least 100 ms to become solid. Camera, projector and cast delay add to this, plausibly 250-500 ms in total (U). Casters can also occlude the beam (U). Both are P0 tests (section 15). Lanterns roll slowly enough, and checkpoints are close enough, to absorb that delay if the pass thresholds are met.

**Predict and Test (finale Pit Stop, in the first paid build)**
- How it plays: the wall sets a target ring, and phones predict whether "tilt or move toward the lamp" will grow or shrink the shadow. A Caster does it live, and the camera measures the area change.
- Shadow's role: the real shadow is the answer key. No question writing is needed, and it does not consume the question bank.
- Phone's role: lock in a prediction with a picture arrow.
- Win condition: correct predictions pour extra Oil.
- Ages: non-readers use a pictured arrow, and readers get a short sentence.

**Silhouette Charades (Full Founder, human-judged first)**
- How it plays: the performer sees a picture card for 5 s and then makes the animal or shape from memory. The other team guesses from a per-phone picture grid, and accuracy beats speed. Both teams play at once in their own lanes. The number of heats equals the larger team size, capped at 5. The smaller team's repeat goes to its least-exposed member.
- Shadow's role: the real shadow is the only clue. It works even if the camera fails, because people can see it. This makes it the safest fallback.
- Phone's role: guess grids, with icon-chip clues.
- Win condition: mean guesser result.
- Ages: tier-0 body shapes (Tree, Tent, Star) for the youngest. Buddy Pose lets a linked parent and child build one silhouette.

**Ghost Caravan (1-3 players, and the free demo)**
- How it plays: the same leg against a scripted ghost lantern at the Ghost's par.
- Shadow's role and phone's role: same as the Leg.
- Win condition: reach the Oasis before the ghost.

**Later:** Echo Leg and Riddle Fork (see section 13).

## 6. Skill

**What players visibly get better at.** Four measurable parts, computed from the camera's shadow grid:
1. **Forming time.** Seconds to match a filled target (coarse IoU above 0.6, held 1 s).
2. **Steadiness.** Jitter of the shape's smoothed centroid while holding. I do not compute it on the mask edge: the detector's hysteresis, debounce, despeckle and 20 Hz poll make mask jitter mostly detector noise (U).
3. **Scale control.** Moving the same prop nearer or farther from the lamp (Giant vs Tiny targets). Giant can be done with a prop on a stick, so nobody has to approach the lens.
4. **Anticipation.** The camera logs how many seconds before the lantern arrives a path existed (Early Bird).

**Progression**
- **Within minutes.** The opening Light Check and the closing Curtain Call use equivalent but different targets, in counterbalanced order. The wall shows team-level gains only, and only when they are positive. Each player sees their own before and after, and their score against their own baseline during legs, on their own phone. Nobody's regression is ever shown.
- **Across sessions (Full Founder).** Each phone keeps a Shadow Rank (Spark, Lantern, Falcon, Star) and cumulative badges (Long Bridge, Steady Hands, Giant & Tiny, Ready Early, Two-Hand Build). Data lives in localStorage inside try/catch, so it can vanish. No accounts. A restore code is optional later.
- **Not in v1.** The host Camp Log, "Tonight's Course" and cosmetic skins are cut. Tonight's Course is a play-by-appointment pattern from Zagal's list. Cosmetic skins can come later as cumulative, non-expiring unlocks.

**Honest limits.** Gains over 20 minutes may be practice, task familiarity or recovery from nerves, not skill. The guards help only partly: equivalent targets with counterbalanced order, the better of two opening tries as baseline, and a 2x cap on improvement ratios (A). No test-retest reliability has been measured. P0 includes a 10-repeat test of the same target. The before/after screen ships only if the standard deviation of forming time over those repeats is small against the gain it would show (A: 1 s or less). Otherwise the Light Check stays a rating only. Spatial-skill training works in general (Uttal 2013, g about 0.47), but there is no evidence this game transfers. The wording is "faster and steadier at this game's shadow tasks", not a school claim.

## 7. General knowledge

**How it helps without excluding children.**
- Oil changes the race: a full flame cancels a restart of about 6 s or opens a Bypass door worth about 8-10 s (A). At about 70% correct a team earns about 2 flames (E).
- Every leg is clearable at zero Oil.
- Every phone gets the same topic at its own tier. The tier comes from the join tap, not the rating, so credit tracks what a player actually knows. Drift is off at launch.
- A player can tap an opt-in **harder** or **easier** on the card screen. It is the player's choice, never applied silently, and not shown on the wall. Tier by age is not tier by knowledge, so this covers an adult weak on wildlife and a 10-year-old who loves it.
- Accuracy only, never speed, because speed penalises young and slow readers. Kahoot added an Accuracy mode in May 2025 after user requests. The slow-reader reason is my inference.
- Predict and Test makes knowledge physical.

| Join tap | Cards | Rating prior |
|---|---|---|
| Little | Tier 1, big-picture cards, set by the parent on the shared phone | 0.45 (A) |
| Kid | Tier 2 | 0.60 (A) |
| Teen | Tier 3 | 0.85 (A) |
| Adult | Tier 3 | 1.00 (A) |
| No tap | Tier 2 | 0.85 (A) |

**Question flow.** Topic banner and silhouette, then a tiered card, then the player's guess (with an optional confidence tap), then the reveal. The reveal shows the right answer plus one sentence of "Did you know?". A missed item returns later in the session. Right-answer feedback beats right/wrong-only feedback, and longer elaboration added nothing in trivia experiments. The claim is "may pick up facts", because the evidence is lab and classroom data.

**Categories.**
- Desert and stars.
- Gulf wildlife.
- Camp and heritage objects (dallah, finjan, Al Sadu), framed as Gulf/Arab rather than one state's.
- Light and shadow science.
- Numbers and estimation.
- Sea and pearl heritage as a later pack.

Avoid religious doctrine, politics and borders, the Iraq-Kuwait war, ruling families and living figures, alcohol and gambling imagery, dogs and pigs, and tribal ranking. This avoid-list is my judgment, not a published rule.

**Arabic and English.** All items are bilingual. Use MSA for functional UI and light Khaleeji tone only in microcopy. A native Kuwaiti or Saudi reviewer is needed. Arabic text-to-speech quality is unverified, so use short recorded clips.

**Sourcing and licensing.**
- Author Gulf items natively in Arabic.
- Draft science items with an LLM and then verify them: two independent sources, a native read, and a check that only one answer is correct.
- LLM drafts of Gulf facts are unreliable. The benchmarks are on smaller models and are low confidence.
- Verification is about 5 minutes per item (A), so 120 items is about 10 h, or about 1.7 dev-days if the owner does it alone.
- Do not copy Open Trivia DB or Wikipedia wording into the paid pack. Both are CC BY-SA, and how ShareAlike applies to a hosted service is unresolved, so ask a lawyer.
- Wikidata (CC0) is safe for cross-checking facts.

## 8. Mixed ages and accessibility

- **Roles, not difficulty sliders.** Nobody's score is multiplied by age. Everyone always has a job: Caster, Pilot, Coach (caller) or card-answerer.
- **Non-readers.** Play entirely by pictures: the Moon ring, big arrows, Tier-1 cards and pictured predictions. Join uses a preset nickname and icon with no typing, which suits kids and the regulator posture. The nickname table has Arabic and Latin forms, so mixed-script input is not needed. The layout is still RTL-ready, with names isolated for bidirectional text.
- **Assists are opt-in and chosen by the player (Layer 3).** Examples are a wider ring tolerance, larger buttons and a slower lantern. They are never assigned by age or applied silently. Evidence on disclosed handicaps is mixed (Bateman 2011 found disclosed assists accepted, but Gerling 2014 found explicit balancing lowered self-esteem). So the rule pictogram says assists exist, but no per-child label shows on the wall.
- **Team-level help is disclosed.** When Moonrise ships, it is shown on the projector.
- **Buddy Pose (Layer 3).** A linked parent and child make one silhouette together. It is limited to linked households.
- **Grandparents** can teach hand-shadow animals from memory (A, untested).
- **Physical access and safety.** Low targets for short reach, props on sticks and stands, and seated roles (Pilot, Coach, guesser). A floor mark about 1 m from the lens (A) keeps people from walking into the projector, which is a heat, trip and recalibration risk. Giant can be done by prop. Continuous holding is capped by the camp spacing (about 20 s (A)). Fatigue is a P1 observation item. No chat and no free text. Colour is never the only cue.

## 9. The addictive loop with ethical guardrails

I read "addictive" as maximally replayable through honest design. Nothing is compulsive.

**What pulls players back**
1. Short, tense legs with a visible rival lane. A photo finish is felt by the whole room.
2. Honest near-miss readouts. They are coarse, for example "your bridge was about one hand-width low". They appear only when the miss is larger than the measured detector jitter, because "20 px short" is only about 3 cells. Retries are instant and there are no lives.
3. A mastery loop with team-level gains, ranks and badges.
4. Mirror-and-swap fairness: "swap tents and prove it".
5. Variety from seeded courses once the composer ships.
6. A defined end, cosmetic awards and a host-decided "Run it back?" that reshuffles teams. "Stop" is as prominent as "Again", and nothing is pre-highlighted.

**Guardrails.** Never ship:
- loot boxes or any paid randomness
- countdown offers or "last chance" banners
- streaks or guilt copy
- push notifications
- ads
- chat
- third-party analytics (a design choice, A)
- forced daily return

Cosmetic unlocks, when they come, are earned by cumulative counters and never expire. There is no auto-queue. After the third Night the game suggests a tea break, and the host can end any time. Sound is short and optional. Where the rules come from:
- Apple Kids and Google Families rules bind store-listed apps, so they apply only if the game is later wrapped as a native app.
- The UAE Child Digital Safety Law bans targeted ads and tracking beyond the authorised purpose. It does not ban every analytics call, so "no third-party analytics" is my choice, not a legal requirement.
- Zagal's dark-pattern list is the academic checklist.
- The host-buys-once model needs none of those hooks.

## 10. Content plan

| Asset | Express Founder | Full Founder | Notes |
|---|---|---|---|
| Course modules and courses | 3 modules, 4 hand-tuned courses | 6 modules, 4 composer recipes | Each course has a scripted solution and a proof it cannot be cleared without its mechanic. The composer needs an automatic solvability and shadow-necessity verifier. Tune on the real wall, not the simulator. |
| Drill targets | 1 ring plus Moon | 5 (Moon, Bridge bar, Ramp, Catcher cup, Giant vs Tiny), with equivalent pairs for the Curtain Call | Plus 2-3 clearly distinct hand-shadow animals as optional targets. |
| Silhouettes | About 60 SVGs | Same | Drawn as saturated colour fills. Bilingual names, tier and sensitivity flag. Check CC licences. |
| Trivia | 120 items in 3 tiers, bilingual | Same, plus free updates | One-sentence fact and two sources each. About 10 h of verification. |
| Charades | None | 6-8 shapes and animals | Avoid look-alike pairs such as Rabbit and Gazelle. |
| UI strings | About 120 in Arabic and English | Same | |
| Extras | Printable prop sheet PDF | Same | Cosmetic skins and the Camp Log are cut from v1. |

**The real repeat point.** A session uses about 48 phone cards (the concept's estimate), so 120 items last about 2-3 sessions without repeats. Research recommends about 300 verified items for launch, and I am not there. Courses are the other replay source: 4 hand-tuned courses give about 2-3 Nights of fresh play. That is the v1 expectation, and it is why content updates and Charades matter.

**Cheap ways to multiply content**
- Silhouettes recur at different tiers with new distractors.
- Predict and Test is procedural.
- The seeded composer (Full Founder) varies the courses.
- Free post-launch updates of about 100 items (Jackbox shipped a free 164-prompt update).
- A local "seen" list avoids repeats.
- **Echo Leg**, where the rival team's recorded shadows become your obstacles (see section 13), removes the course-authoring burden.

## 11. Themes for every age band

All skins are bright-field art (section 2). The night feel comes from motifs, not from darkness.

| Band | World and skin | Cards | Shadow tasks |
|---|---|---|---|
| Little (about 4-6) | Desert Friends: big friendly animals, bright colours | Two pictures, no reading | Moon ring, Tree/Tent/Star, Pilot with a parent |
| Kids (7-12) | Caravan Quest: the default lamp-and-oasis world | 3-4 options, stems of 12 words or fewer, light science | Bridges and ramps, hand-shadow animals |
| Teens (13-17) | Star Caravan: bright stars and wildlife facts | Tier 3 near-miss distractors and estimates | Bold route, Early Bird, Coach strategy |
| Adults and grandparents | Majlis Evening: coffee, falconry, Al Sadu in saturated colours (Gulf/Arab framing) | Heritage and estimation | Coach, Pilot, hand-shadow animals from memory |

A **room-level skin** is chosen by the host: Desert Dusk is the default, with a white ground, saturated sunset colours and star and dune motifs. Ramadan Lanterns is a calm, seated, evening skin where the ornate fanous appears. Its start is from about 8 Feb 2027 and depends on moon sighting, so do not lock the date. It is a later item, because the Express Founder date (25 Feb to 31 Mar) lands inside or after Ramadan. Sea & Pearls is a later pack. The Gergean children's tradition is a theme hook only, because sources conflict on its dates.

## 12. The concept shoot-out

Rank is by judge: J1 / J2 / J3, each judge listing from first (1) to last (6).

| Concept | Avg | Rank | Verdict | Decisive reasons, kept and cut |
|---|---|---|---|---|
| **Lantern Run** | 6.93 | 3 / 1 / 2 | **Winner (chassis)** | Fairness 9.0, solo 7.3. The only prototype evidence is a synthetic determinism check: mirrored lanes cleared in identical time (3.18 s). That shows the physics is deterministic, not that two physical lanes are fair. Weak spots are knowledge (4.0) and replay (5.3), which the grafts below only partly fix and not before the first paid build. Cut: the sizeAllowanceSec of plus or minus 6 s (about 8% of a leg) and Underdog Oil (replaced by the single Moonrise boost). |
| **Shadow Academy** | 7.37 | 2 / 3 / 1 | Merged (parts) | Best skill, mixed-age and share clip, but solo feasibility is 4.0 and it has the highest vision risk. A synthetic test put look-alike shapes only 0.05-0.15 below the right one. Kept: human-judged Charades, ring targets, Buddy Pose, Pocket Zoo take-home, hand-shadow team emblems. Cut: the matcher, Open Studio, a 20-animal launch, per-animal pars before real captures. |
| **Echo Dunes** | 7.23 | 1 / 2 / 3 | Deferred expansion | Best shadow necessity (9.7) and replay (9.0), but fairness is 6.7. The captain's 1.5 vote and a sizeComp of about 12% are hidden size powers. Fun is unproven and the rule load is heavy. Kept: Wave Hello tutorial, Echo Leg after the spike, "black is now, colour is then" (to be re-expressed in bright-field colour), silhouette-only replay. Cut: the 1.5 vote, sizeComp, Blind Dunes, 3-4 team judging, Prove-or-void in v1. |
| **Fanoos Gates** | 6.43 | 4 / 4 / 5 | Quarry | Knowledge 8.3, but solo feasibility 2.7 (27 days), fun 5.3, school feel. Kept: Predict and Test, the never-stuck principle (nobody is left waiting more than about 20 s). Cut: the sand-lock chain, 270 items, tier drift, sizeAdj. |
| **Shadow Sahra** | 6.37 | 6 / 5 / 4 | Quarry | Best framing (8.0) but solo feasibility 1.7 (33 days). Kept: Light Check and Curtain Call, optional Fanoos host (Ramadan skin only), Express length. Cut: the five-round show and a big quiz bank that competes with Mkhmkh. |
| **Lantern Keepers** | 5.97 | 5 / 6 / 6 | Cut | Half the room plays a no-shadow phone game, 90 s pose-holding tires children, and live saves are latency-luck. It needs a new physics mode. Kept: only honest near-miss wording. |

The solo x2 and fairness x1.5 weighting gives Academy 7.11, Echo 7.11 and Lantern Run 7.05. The scores cannot separate the top three, so the decision rests on build risk. That is a judgment call on judged, not measured, scores.

## 13. What to build first

The backlog is sized in focused dev-days. It reuses the current engine: calibration, homography, detector, sim camera, World, relay, controller and tests. One caution: the reference team code (`assign.js`, about 270 lines with 946 passing checks) is saved in this repo at `umbra/docs/design-work/teams-fairness/` (run `node selftest.js` there), together with the simulation outputs and the lane and matcher prototypes that the numbers in this document came from. The teams spec itself estimated 6.5 days, or about 5.5 with the reference code, and I use 5.5. Dropping the re-draft from the first build might save about 0.5 more, which I do not count on.

**Scope codes.** P0 is the gate. P1 is the playtest build. X is the Kuwait-only Express Founder. F is the full Founder.

| # | Item | Days | Scope | Cum. |
|---|---|---|---|---|
| 1 | Real-projector gate: vision, latency, 10-repeat noise test, people in the beam, lantern and wind, connectivity | 1.5 | P0 | 1.5 |
| 2 | P1-lite harness: `assign.js` command line, printed seat cards, the existing single lane as a stopwatch time trial | 0.5 | P1 | 2.0 |
| 3 | Teams module: host-side `assign()` port, join with preset nickname, icon and four-way tap, shared-phone profiles, reveal, seats, late join, leave, reconnect, snapshot, telemetry endpoint, 4v3 and 5v4 tests | 5.5 | P1 | 7.5 |
| 4 | Household-link step, host swap with log, host-set sides | 1.5 | P1 | 9.0 |
| 5 | World per-instance dimensions plus `lanes.js` (split, mirror, cap with warning, margin) | 2.0 | P1 | 11.0 |
| 6 | Checkpoints, Oil hook with flame choice (restart cancel or Bypass door), 3 modules, 2 hand-tuned courses with a scripted solution and a necessity proof each | 3.0 | P1 | 14.0 |
| 7 | Two-lane scenes in bright-field art (team colours, emblems and borders in the palette test; HUD in ignore rects), relay cap 12 plus audience, size-neutral ping, Coach UI | 3.5 | P1 | 17.5 |
| 8 | Relay hosting, domain, HTTPS | 1.0 | P1 | **18.5** |
| 9 | Minimal Light Check (one ring, one measurement, feeds `assign()`) | 1.0 | X | 19.5 |
| 10 | Courses 3-4, hand-tuned, with scripted solutions | 1.0 | X | 20.5 |
| 11 | Pit Stop engine: tiers, little switch, opt-in harder/easier, shared-phone cards, Oil gauge; 60 bright silhouettes; 120 verified items; reviewer | 4.5 | X | 25.0 |
| 12 | Predict and Test (procedural) plus science cards | 1.0 | X | 26.0 |
| 13 | Arabic RTL, bundled fonts, about 120 strings | 3.5 | X | 29.5 |
| 14 | Manual-code unlock (host code entry, codes issued by hand) | 0.5 | X | 30.0 |
| 15 | Ghost Caravan, solo and duo (the free demo) | 1.0 | X | 31.0 |
| 16 | Run-it-back (host decides, Stop as prominent as Again), game-state cosmetic awards, recap card | 1.0 | X | 32.0 |
| 17 | Express Night mode, three-sentence rule screen, printable prop PDF | 1.0 | X | 33.0 |
| 18 | Privacy notice (Arabic and English), rooms auto-delete, on-device camera check | 1.0 | X | **34.0** |
| 19 | Silhouette Charades, human-judged (it works even when the camera fails, so it comes before the polish items below) | 3.0 | F | 37.0 |
| 20 | Full Light Check (two rings, equivalent target sets), Curtain Call (team-level wall, own-phone detail), ranks and cumulative badges; the before/after screen ships only if the noise test passes | 2.0 | F | 39.0 |
| 21 | Modules 4-6, seeded composer, composer verifier (solvability and shadow necessity), 4 recipes | 3.5 | F | 42.5 |
| 22 | Hosted checkout and webhook, per-currency prices | 2.0 | F | 44.5 |
| 23 | Safe/Bold, visible Moonrise, act break (tent swap, keep or shuffle), re-draft, each gated by P2 evidence | 2.0 | F | 46.5 |
| 24 | UAE and KSA counsel check, KSA classification paperwork | 1.5 | F | 48.0 |
| 25 | Opt-in assists, Buddy Pose for linked households | 1.0 | F | **49.0** |

**Not counted (later or cut from v1).**
- Echo spike (1-2 days, only if #1 is clean) and Echo Leg (1.5+).
- Riddle Fork (about 2 days, untested, Phase 3).
- Ramadan Lanterns skin (about 1 day (E)).
- Camp Log, Tonight's Course and cosmetic skins (cut).
- Offline and local-relay mode (about 5 dev-days (E)), built if the connectivity test fails.
- PWA, and a separate Display/Camera/Controller split.

The owner decided earlier in the project that internet is assumed. That decision is provisional until the P0 connectivity test.

**Dated options (E, from 12 Oct 2026, at 1.75 dev-days a week).**

| Milestone | Dev-days | Base (4 calendar days per dev-day) | With 25% contingency |
|---|---|---|---|
| P0 gate done | 1.5 | 18 Oct | 20 Oct |
| P1-lite session (family availability decides) | 2.0 | early Nov | early Nov |
| **P1 playtest build** (items 1-8) | 18.5 | 25 Dec | 12 Jan |
| **Option A, Kuwait-only Express Founder** (items 1-18; KWD only; manual-code pilot sales) | 34.0 | 25 Feb | 31 Mar |
| **Option B, full Founder, all markets** (items 1-25) | 49.0 | 26 Apr | 14 Jun |

**Reading the options.**
- **Option A** lands during or after Ramadan and Eid (8 Feb to 8 Mar, then Eid on 9 or 10 Mar). It also lands after Kuwait's assumed 15 Mar season end. It can serve only a few late weeks of the 2026-27 season.
- **Option B** is a 2027-28 product.
- Either way, 2026-27 is a **validation season**: free playtest builds, the demand poll and the fairness data. The paid launch targets 2027-28, with Kuwait's season assumed to start about mid-Nov 2027 (A).

**Levers.**
- If all 12-15 h went to building (2.25 dev-days a week, with no playtests or reviews budgeted), Option A would land 26 Jan to 21 Feb.
- Cutting below Express means dropping Pit Stop and Predict and Test (the knowledge request) or Arabic. I do not recommend either.
- The 25% contingency also has to absorb the owner's non-dev hours. These total about 110 h (E): P1-lite, P1 and P2 sessions, reviewers, the demand poll, trademark and lawyer checks, and marketing clips. That is about 3.5 h a week over 30 weeks, slightly above my 3 h assumption.

The earlier plan under-counted. It left out the composer verifier, the household link, hosting, the privacy notice and Express mode, and it counted too few days for the teams module. Payments, Arabic and paperwork were not counted in any concept's day totals either.

**If behind, cut in this order:** awards and recap polish, Curtain Call, Safe/Bold, Tier-3 cards, then the printable PDF. Never cut the seat rule, Pit Stop, Predict and Test, Arabic, the privacy notice, Ghost Caravan or the Stop button.

## 14. Business, launch and technical implications in brief

**Pricing (my proposal, not market-tested).**
- **Free tier.** Ghost Caravan, 2 courses, a time-limited 2v2 room (4 controllers, 10 minutes per room (A)) so the headline feature "the room decides your team" can be seen before purchase, and a printable props PDF. No ads.
- **Founder host pass.** KWD 3.500 / SAR 39 / AED 39, with guests free. The Express Founder sells in KWD only. The regular price later is about KWD 4.900 / SAR 59 / AED 59.
- **Anchors.**
  - Jackbox Party Pack 11 lists at USD 29.99. A Dec 2025 SteamDB snapshot (read via search summaries) showed KWD 4.95, SAR 61.49 and AED 79 for five games.
  - SAR 39 is about 63% of that Saudi price for one mode and about 120 trivia items, which is a high ask at this stage.
  - The local competitor Mkhmkh offers one free game and then KWD 3 per extra game (App Store listing, may have changed). A KWD 3.5 Founder pass is roughly one extra Mkhmkh game.
  - Test price with a short pre-sale across 20-30 camp groups before fixing it.
- **Content pack.** KWD 1.500 / SAR 19 / AED 19.
- **Camp-operator licence.** About KWD 19 per season, as a pilot only. The physical props kit waits until the digital game works.

**Calendar.**
- Qatar's season is confirmed for 25 Oct 2026 to 20 Apr 2027, which is not reachable.
- Kuwait's official name is the "spring camping season". Its 2026-27 dates are unannounced. Last season ran 15 Nov to 15 Mar, so assume similar (A).
- Ramadan is expected from 8 Feb 2027, with sighting deciding the exact days. Eid al-Fitr is 9 or 10 Mar, and 10 Mar is likelier if sighted (my own astronomy, U).
- The UAE school winter break (14 Dec to 3 Jan) and pre-Ramadan February fall before the earliest paid build. Option A can reach only the tail of the season, Ramadan evenings if early, and Eid. The UAE spring break (5-11 Apr) needs Option B.
- Kuwait's 25-26 Feb and KSA's 22 Feb national days fall inside Ramadan.

**Channels.** Short clips of a hand making a bridge for Snapchat, Instagram and TikTok (Snapchat reaches about 25 million monthly users in KSA). The WhatsApp room link is the viral loop. Rental-camp operators are a **hypothesis to poll**, not a channel. They rest on two or three listings, and the IndexBox figures are annual flow with an unconfirmed category, not ownership. Projector ownership at camps is unmeasured.

**Regulatory posture.** The posture is no chat, no accounts, no ads, a camera processed on-device and nothing recorded.
- Whether KSA GAMR classification binds a web game is unclear, since law-firm analysis says offshore and store distribution is not clearly exempt.
- The UAE Child Digital Safety Law is fully enforceable from Jan 2027, and its reach to a paid party game is unknown.
- Get a short local-counsel opinion before taking KSA or UAE money. Kuwait-only Express Founder sales avoid this until the counsel check (item 24).
- Kuwait's child-data duties are likely small but unconfirmed, so get a one-hour Kuwaiti lawyer check before Option A.

**Deferred technical decisions.**
- **Native versus web host.** Web-first avoids a 30% store cut. Native would also pull in Apple Kids and Google Families rules.
- **Hosting.** The relay needs internet or LAN reachability. Connectivity at camps is untested (P0 and P2).
- **HTTPS.** Phone cameras need HTTPS on a LAN. Localhost is exempt, so the host's camera and display device is the practical answer for now.
- **Store listings.**
- **Payments.** Express Founder uses manual codes, issued by hand after a bank transfer or KNET link. Even this may need a licence, so ask MOCI or a lawyer first (U). A merchant-of-record checkout is plausible but unconfirmed. The claims that it is the only path, and that Kuwaiti KNET cards can pay a foreign checkout, were unverifiable. Run a real test purchase with KNET-only cards and Apple Pay before relying on it. Lemon Squeezy and Paddle are digital-goods platforms (inference), so the printed kit is not sold online this season. Payments depend on the owner's nationality and licence.

## 15. Risks, kill criteria and the real-hardware playtest plan

**Risks.**
- **Vision, latency and occlusion on real hardware** are untested. Two lanes halve the usable wall (80 cells each), and fire, lanterns, headlights and wind can swamp a lane. Total delay may reach 250-500 ms.
- **Fairness** is designed, not proven. The simulation does not cover the race format.
- **Family seating** (men, women, teens and children in one lane pair) is the most likely GCC-specific failure and is untested.
- **Rule load.** A child must learn too much unless layers are held back.
- **Schedule.** The sellable date is Feb-Mar at best, and slipping.
- **Content errors and thin replay.**
- **Crowds.** At 6 or more per team, half the team idles.
- **Course tuning.** Gaps under about 120-140 px get jumped.
- **Demand.** No source shows projectors at private camps.
- **Connectivity** at camp areas is unmeasured.
- **Legal.** Classification and child-data duties are unresolved.

**Kill criteria (all thresholds are assumptions):**

| Test | Kill or pivot trigger |
|---|---|
| Day 1 vision | If no projector gives a clean enough mask for an adult to fit the ring within 10 s in 8 of 10 tries, even after recalibration, fall back to a single lane against the Ghost Caravan. If that also fails, pivot to human-judged Charades with the camera off, or stop. |
| Latency | If median hand-move to lantern-collision latency is above 300 ms, or p95 above 450 ms, on the wired path, switch to slow-rolling lanterns (0.7x speed (A)) and more checkpoints. If the median is still above 500 ms, run a single lane against the Ghost Caravan, then follow the vision row. |
| Mask quality | If phantom blobs exceed 1 per lane per minute with a lit lantern or two people in the beam, add the keep-out onboarding line and the 5 s recalibration path. If it still fails, follow the vision row. |
| Measurement noise | If the 10-repeat standard deviation of forming time is above 1 s, do not ship the before/after screen. The Light Check stays a rating only. |
| Connectivity | If more than 25% of P0 or P2 windows show an input stall over 500 ms with 8 phones on a camp hotspot, build the LAN and offline mode (about 5 dev-days (E)) before any paid build. |
| Rules comprehension (P1-lite, P1) | If fewer than 4 of 5 families start leg 1 correctly within 90 s of hearing the three-sentence script, or the benched child asks to swap or complains in more than half of legs, fix the script and the Coach job before adding any rule layer. |
| Family seating | If fewer than 3 of 5 Gulf families accept the household step and sides option without objection, rework it before P2. |
| Race fun | If fewer than 3 of 6 groups want another leg when the host asks, with Stop and Again equally prominent, pause the learning layer and rework the leg. |
| Replay | If the median group plays fewer than 2 Nights in 3 weeks, the content loop is too thin. Move Charades and the composer ahead of everything else. |
| Fairness (gross-failure rule only) | Use a continuous measure: the log of the bigger team's leg time over the smaller team's, averaged over all legs in a room, with 4v4 rooms as controls. After at least 12 uneven rooms and 4 control rooms, call it a gross failure if the bigger team wins or loses more than 75% of the uneven rooms (10 of 12 or more, about a 4% false-alarm rate for a fair game), or the 95% CI of the mean log ratio sits entirely beyond plus or minus 10%. Then rethink the seat rule. Never auto-enable the size correction from room win counts. The old 40-60% band over 6-10 rooms would fail a perfectly fair game about 69% of the time at 6 rooms and 73% at 8. Before 12 uneven rooms the data is descriptive only. |
| Demand | If fewer than 3 of 10 camp groups can set up a projector and a sheet in under 10 minutes, the camp-first channel is wrong. Pivot to rental-camp operators and majlis or home use. |
| Schedule | If the P1 build is not playable by 15 Jan, or the Express Founder is not sellable by 31 Mar, treat 2026-27 as a validation season. Run free playtest builds and the demand poll, and aim the paid launch at 2027-28. |

**Playtest plan**
- **P0 (Day 1 to 2, owner alone, then with family).**
  - A cheap mini projector and a roughly 400-lumen unit, on a bedsheet and a tent wall. Place the camera at least 30 degrees off-axis and low.
  - Test hands and props with a lantern or fire in view, plus wind and cold. Log phantom-blob rate and ring-fit scores.
  - Measure latency from high-speed phone video (120 fps or better (A)), wired against cast.
  - Run two or more people in the beam, and a child standing in the beam to test the area cap.
  - Bump the projector and time the 5 s recalibration.
  - Repeat the same filled target 10 times to measure noise.
  - Log round-trip time to the planned relay region and input stalls from a camp hotspot with 8 phones.
- **P1-lite (early Nov, 3-5 Gulf families, no build).** The laptop runs `assign.js` and the existing single lane as a stopwatch time trial, with printed seat cards. Test the three-sentence script, the household and sides step with real Gulf families, the Coach job and bench reactions, and mixed-age comprehension with a 4-year-old and a grandparent.
- **P1 (the build, about 25 Dec to 12 Jan).**
  - Run 4v3 and 5v4 rooms with a 4-year-old and a grandparent. Time the rule explanation and log seat times.
  - Add Coach-talk to the observation sheet.
  - Count how often the benched child asks to swap or complains.
  - Note fatigue.
  - P1 tests seats, rules and comprehension only. It has no Light Check or Pit Stop, so it cannot test the skill or knowledge pillars.
- **P2 (12 uneven rooms plus 4 control rooms, 5-10 camp groups, as the season allows).** Include one adults-only room, one youth room and real cold, wind and hotspot conditions. Log:
  - the normalised team-time ratio per leg, by team size
  - blowout rate
  - run-it-back, nights per group, and Light Check before/after
  - input stalls and round-trip time

  Have 2-3 Gulf parents review names, colours, imagery and Arabic.

## 16. Decisions the owner must make now

1. **Confirm the trunk.** I recommend the Lantern Run chassis, with Echo Dunes as the expansion after the spike. The alternative is Echo as the trunk, which is higher reward and higher risk.
2. **Which reading of "disadvantaged"?** Does the bigger team lose more, or does each member get less airtime? The design covers both, but the answer decides how much effort goes into the Coach role.
3. **Which country first, and what is your nationality and licence?** This decides the payment route.
4. **Choose a dated plan.** Option A is the Kuwait-only Express Founder (34.0 days, 25 Feb to 31 Mar 2027). Option B is the full Founder (49.0 days, 26 Apr to 14 Jun 2027, aimed at 2027-28). You can also tell me how many more hours a week you can give. Either way, 2026-27 becomes a validation season, and the paid launch cannot reach the 15 Nov start.
5. **Preset nicknames and icons only, no free text?** I recommend yes.
6. **Hand-shadow matcher?** I recommend no. Ship human-judged Charades and revisit after real captures.
7. **Working title.** Pick one and commission a trademark search.
8. **Founder price and tiers.** Approve the proposed numbers or set your own, and approve a short pre-sale test.
9. **Reviewers.** Budget a native Arabic reviewer and 2-3 Gulf-parent reviewers.
10. **Demand check.** Poll 20-30 camp groups on projector access before building beyond the P1 build.
11. **Family seating.** Approve the household step on by default and the host "sides" option. They are a cultural judgment that needs a yes or a no, and then a test with Gulf families.
12. **First-build rule diet.** Approve hiding Moonrise, the re-draft and the size correction until playtests justify them. The cost is that lopsided rooms stay common.

## 17. Evidence table

"Verified?" records the claim-check result where one exists. Otherwise it reads "search summary only". WebFetch and most direct page access failed during research.

| Fact | Source | Confidence | Verified? |
|---|---|---|---|
| Qatar season is 25 Oct 2026 to 20 Apr 2027 | https://marhaba.qa/qatar-announces-dates-for-2026-2027-winter-camping-season/ | High | Confirmed |
| Kuwait's 2025-26 "spring camping season" ran 15 Nov to 15 Mar, 11 sites; 2026-27 dates not found | https://moderncampground.com/asia/kuwait/kuwait-approves-11-designated-sites-for-2025-2026-spring-camping-season | Medium | Partly (absence of evidence) |
| Dubai permits are for UAE citizens with a Dubai passport, family use | https://uaeinform.com/expat-guide/camping-in-the-uae | Medium | Partly |
| Camp amenities; the 16-person example is all-male, and the same report describes separate men's and women's tents; no projector use found | https://kuwaittimes.com/kuwaitis-seek-roots-upmarket-tents-stars-special-report/ | Medium | Partly |
| GCC projector consumption about 364K units (2024), KSA about 72K; this is annual flow with an unconfirmed category, so ownership is unmeasured | https://www.indexbox.io/blog/video-projector-gcc-market-overview-2024-4/ | Medium | Partly |
| Nebula Mars 3 Air is 400 ANSI lumens; AED 1,999 was a promo (AED 2,399-2,699 elsewhere) | https://tbreak.com/nebula-mars-3-air-400-deal-uae-26-off/ | Medium | Partly |
| Starlink launched in Kuwait in Mar 2026; prices shaky | https://www.samax.com/news/sama-x-part-of-alghanim-industries-brings-the-worlds-most-advanced-satellite-internet-to-kuwait-through-starlink/ | Medium | Partly |
| Camp-area mobile coverage: no operator data; vendor guides call desert coverage patchy and often absent in deep desert | https://cellesim.com/en/faq/will-i-have-internet-coverage-in-the-desert-wahiba-sands-or-mountains-jebel-akhdar | Low | Partly |
| Ramadan 2027 expected from 8 Feb; Eid 9 or 10 Mar (10 Mar likelier if sighted, my own astronomy) | https://gulfnews.com/uae/ramadan/when-does-ramadan-2027-begin-everything-you-need-to-know-1.500630523 | High | Partly (sighting-dependent) |
| KSA GAMR rating tiers 3-21+ | https://www.videogameschronicle.com/news/12-years-later-grand-theft-auto-v-has-been-cleared-for-release-in-saudi-arabia/ | High | Search summary only |
| Web games and GAMR scope in KSA | https://www.twobirds.com/en/insights/2026/saudi-arabia/launching-online-video-games-in-saudi-arabia-from-offshore | Medium | Unverifiable |
| UAE Child Digital Safety Law, enforceable Jan 2027; bans targeted ads and tracking beyond the authorised purpose | https://www.bakermckenzie.com/en/insight/publications/2026/01/uae-issues-new-child-digital-safety-law | Medium | Search summary only |
| Kuwait lifted Roblox ban once chat was disabled | https://www.gdnonline.com/Details/1367153/Kuwait-lifts-ban-on-Roblox-with-new-rules-in-place | Medium | Search summary only |
| Kuwait payments need a commercial licence (UPayments) | https://help.upayments.com/en/support/solutions/articles/150000200236-completing-verification-upayments-verification-center | Medium | Unverifiable |
| Lemon Squeezy payout countries include Kuwait | https://docs.lemonsqueezy.com/help/getting-started/supported-countries | Medium | Unverifiable |
| Jackbox Party Pack 11 is USD 29.99 | https://pressreleases.triplepointpr.com/?p=27672 | High | Search summary only |
| Steam regional price of Pack 11 in KWD/AED/SAR (snapshot Dec 2025) | https://steamdb.info/app/3364070/ | Medium | Search summary only |
| Mkhmkh: one free game, then KWD 3 per extra game; 5,000+ questions | https://apps.apple.com/app/id6449299244 | Medium | Search summary only |
| 41% of GCC gamers favour Arabic localization (merges "only" and "more likely") | https://gamedevreports.substack.com/p/niko-partners-and-saudi-esports-federation?open=false | Medium | Unverifiable |
| Kahoot averages team scores | https://support.kahoot.com/hc/en-us/articles/4408679135891-Kahoot-game-play-in-team-mode | High | Search summary only |
| Kahoot added an Accuracy mode in May 2025 after user requests | https://kahoot.com/blog/2025/05/06/teacher-takeover-accuracy-mode/ | Medium | Search summary only |
| Social loafing grows with group size | https://en.wikipedia.org/wiki/Social_loafing | Medium | Search summary only |
| Spatial training effect g about 0.47 | https://pubmed.ncbi.nlm.nih.gov/22663761/ | Medium | Search summary only |
| Intrinsic integration beats bolt-on quizzes | https://shura.shu.ac.uk/3556/ | High | Search summary only |
| Open Trivia DB is CC BY-SA 4.0 | https://opentdb.com/api_config.php | High | Search summary only |
| Mirrored lanes ran in 3.18 s (determinism only, not fairness); fairness simulation (internal scratch work) | scratchpad `lane-proto.mjs`, `assign.js`, `sim.js` | Low-medium | Synthetic and modelled, not data |

**Still unknown**
- Kuwait's 2026-27 camping dates, and whether a Kuwait Times headline about a national game-rating system means a binding rule.
- Whether KSA GAMR binds a web game, and whether the UAE law reaches a paid party game.
- The owner's nationality and licence, which decide the payment route, and whether manual-code pilot sales need a licence.
- Projector ownership and surfaces at camps, and mobile coverage at Kuwait and Saudi camp areas.
- Real shadow detection on a projector, end-to-end latency, and test-retest noise of the skill measures.
- Whether mixed-family seating, the household step and the sides option work in Gulf households.
- Willingness to pay for a one-off host purchase.
- Whether fair-team rules hold in real rooms and in a race format.
- Whether the benched role feels like a promotion to a 9-year-old.
- Arabic text-to-speech quality, and Gulf-dialect versus MSA preference.