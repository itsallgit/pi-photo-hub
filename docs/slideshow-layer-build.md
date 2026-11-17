# Slideshow layer: delivery plan and build progress (B32)

**This page is the source of truth for building the slideshow layer.** It holds the plan, the build mandate the owner gave, the order of work, how each part is tested, and the live progress checklist. A build session reads this page first and continues from the first unticked task. The requirements and the reasoning behind them are in [slideshow-layer.md](slideshow-layer.md); read that too.

Plan agreed with the owner: 2026-11-18 ("all the ideas are wants; build all of it; tell me when the version is built; it must be resumable").

## What "done" means

**Slideshow layer v1** is built, deployed on the Pi on the branch `feat/slideshow-layer`, tested against every requirement below, documented, and reported to the owner with a short checklist of the things only the owner can check (their phone, the button board, how it looks from the sofa). The owner then tries it and says "go"; only then is the branch merged to `main` (`git-workflow` skill). Until "go", the Pi runs the branch, and returning it to `main` is one `update.sh` run.

## Build mandate (given by the owner by starting the build prompt)

The owner does not want to approve each step. Starting the build prompt (bottom of this page) **is the owner's agreement** for the following, for the duration of the build, in place of the per-change agreement in `CLAUDE.md` "Working with the owner":

**Allowed without asking**
- Commit and push to the branch `feat/slideshow-layer` (never to `main` until the owner says "go"; docs-only bookkeeping on `main` is not needed, keep everything on the branch).
- Deploy that branch to the Pi with `scripts/update.sh --branch feat/slideshow-layer` (the `apply-changes` skill, skipping its agreement gate), as often as needed. This restarts `photo-api` and relaunches the slideshow; the screen may show test content during the build.
- Install packages listed in `config/packages.txt` through `update.sh` (install only, as it does today).
- Repo-managed changes that `update.sh` applies: new systemd units for this project, the `pi` user's group membership for input devices (through a script in the repo), files under `/var/lib/photo-api/`, `/var/cache/photo-api/`, `/var/log/pi-photo-hub/`.
- Run the read-only metadata scan by hand (`scripts/refresh-vocabulary.sh`, about 40 minutes, the same job cron runs nightly), and anything else in the `pi-access` skill.
- Call the photo API (play, pause, next, change settings, screen on/off) to test.
- On the Pi, create a temporary virtual input device to test the button service, and remove it afterwards.
- Download the offline place list (see M1) onto the Pi through a repo script, and fetch npm packages for the API.
- If the Pi is left broken and cannot be fixed within the session: roll back with `update.sh` to `main` (the `apply-changes` skill), and record it in the build log.

**Never (unchanged hard rules, not covered by the mandate)**
- Anything that writes to the photo HDD (hard rule 1), including through Picapport's web UI. "Mark this photo" only writes a review list on the SD card.
- Merge to `main`, force-push, rebase, `reset --hard`, delete branches.
- `cleanup.sh`, `bootstrap.sh`, `picapport-db.sh` (except read-only `status`), restarting or reconfiguring Picapport.
- Reboot or shut down the Pi. The design must not need a reboot. If something does, stop that part, record it and ask the owner at the end (the `pi-power` skill).
- Fix the Pi's checkout by hand, or change anything on the Pi outside `update.sh`.
- Send photo data, file names or the private word list to any outside service. (The phone fetches map tiles from OpenStreetMap; that sends only map positions, which is accepted for the map, M7.)

**End of every session**, finished or not: the shelf screen is playing the owner's saved slideshow (the one saved before the build started, recorded in the build log), the screen is on, the build log is updated and pushed.

## Requirements (agreed 2026-11-18; all are wants)

IDs are used in the checklist. "Data later" means the feature is built now and fills with data as the ingestion pipeline (L7, Phase 3) adds it.

| ID | Requirement | Ideas # / backlog |
|---|---|---|
| R1 | **One slideshow on the Pi, every browser a viewer, in lockstep.** The Pi holds the now-playing state (photo list, position, playing/paused, settings, when the photo started); viewers follow a live event stream; any change from any client reaches all viewers within about a second. | Core model |
| R2 | **Resume, no reshuffle:** a restart of the API, an update or a reboot continues the same order at the same position. | 1, B26 |
| R3 | **Controls:** play, pause, next, back (one or several), jump to a position; through the API only. | buttons, phone |
| R4 | **Settings and presets.** Settings: what plays (query), order, autoplay on/off, interval, upright handling, motion, transition, overlay fields, overlay style, burst thinning, clock, night look. Presets are named starting points: **Ambient** (autoplay, gentle), **Present** (no autoplay, date overlay, title cards), **Guests** (livelier), **Night** (dimmer, slower). Applying a preset then changing a setting keeps the change. Defaults in the repo; current values in `/var/lib/photo-api/`. | rounds 3 to 5 |
| R5 | **Orders:** random (default), chapters (a short run from one event, then another; event name shown as it starts), date ascending/descending. Burst thinning (one photo per burst of shots seconds apart in one folder) as a setting, on by default. Recently shown photos play last (across slideshows). | 2, 3, 4 |
| R6 | **On this day:** a source "this week in past years". | 5 |
| R7 | **Highlights:** photos with a rating play more often and stay longer (setting). Data later (58 rated today). | 6 |
| R8 | **Upright photos:** blurred, enlarged copy of the same photo behind it (default); "skip upright" setting. Orientation from the photo's rotate tag. | 7, B31 |
| R9 | **Motion and transitions:** subtle pan and zoom (direction and speed varied; off/subtle/lively); cross-fade (default), slide, zoom, dip to black. Smooth on the Pi at 1080p. | 8, 9 |
| R10 | **Information overlay:** date (absolute or relative, "3 years ago"; hidden if the photo has no date), place, event (folder) name, people (data later); style presets (position, backing none/shadow/strip, light or dark text) cycled from the phone or a button. Legible from across the room when on. | 10, L11 |
| R11 | **Place names offline:** GPS turned into city and country on the Pi (no internet lookup per photo), in the nightly build; used by the overlay, the tag tree and search. | 11 |
| R12 | **Title cards** for an event (name, dates) in Present and chapter order. | 12 |
| R13 | **Clock** (option, off by default) and **night look** (dimmer, slower preset). | 13, 14 |
| R14 | **Phone page** (same page as the shelf, with a controls layer): now playing (photo, date, place, event), swipe back/next, pause, presets and settings, search (type a word, pick it, choose AND/OR, add the next), tag tree (people, keywords, country then city, years), folder browser, year strip, "mark this photo". **Full screen without the address bar** (tap to enter; hard requirement). Looks right mirrored to the TV in landscape. Installable manifest included; HTTPS only if full screen proves impossible without it (later). | 15, rounds 3 to 5 |
| R15 | **Map** (stretch): photos as points on a map; pick an area to play it. | 16 |
| R16 | **"What's playing?" in Paseo** with date, place, event and a preview link; the `slideshow-control` skill covers every new control, setting and preset. | 17 |
| R17 | **Button board:** a service on the Pi reads the board directly (its keys never reach Chromium), maps each input (KEY1 to KEY3, knob left/press/right, long presses) to API calls through a config file in the repo; first map: KEY1 back, KEY2 pause/play, KEY3 next, knob slower/faster, knob press cycles the overlay style, long KEY2 screen off/on. A "learn" helper records what the board sends. | 18, L1 |
| R18 | **Screen schedule:** daily off/on times (owner's example: off 00:00, on 06:00), **off by default**, set through the API and Paseo. | 19, L9 |
| R19 | **History and suggestions:** slideshows played and photos shown, kept on the SD card with a size cap; "not seen in a while" as a source; readable by Paseo. | 20, L10 |
| R20 | **Mark this photo:** star or "bad photo" from the phone or a button goes into a review list on the SD card (`/var/lib/photo-api/marks.json`), readable through the API, for the owner's pipeline to apply to the photo files later. Nothing writes to a photo. | 21 |
| R21 | **Fallback:** a setting switches the shelf back to Picapport's own slideshow page, so the old behaviour is one call away. Existing API calls keep working (the `slideshow-control` skill must not break mid-build). | safety |

**Not in v1 (later):** HTTPS and an installed PWA (only if R14's full screen needs it); the phone voice trigger; driving the TV itself or its browser and remote; pan towards faces (needs face regions, L7); video (L8); people and highlight data themselves (L7).

## Architecture decisions for the build

- **Where it lives:** inside the existing photo API (`api/`, Node 18 on the Pi, Express). New modules under `api/lib/` (player, catalogue, events, settings, history, marks, schedule); the page under `api/public/` served at `/show`. Plain HTML, CSS and JavaScript, no build step on the Pi; small libraries vendored into the repo (for example Leaflet for the map) rather than loaded from the internet, except map tiles.
- **Picapport stays behind the adapter** (`api/lib/picapport.js`): queries (`RunQuery`), per-photo metadata (`GetMetaData`) and images (`lp?vid=&index=&cx=&cy=`, about 2.3 s for 1080p). Viewers only ever call the photo API (`/api/photo/...`), never Picapport.
- **Image cache:** resized images cached on the SD card under `/var/cache/photo-api/` with a size cap (cache, disposable), so back/next and lockstep viewers are fast. The next one or two photos are fetched ahead.
- **Catalogue (derived, disposable, rebuilt nightly from the photos, principle 11):** the scan gains the rotate tag, pixel size and GPS longitude (it records latitude only today); `build-vocabulary.py` also writes a catalogue keyed by file path (date, orientation, size, GPS, place, rating, people, keywords) and adds places (country, city) to the vocabulary. Offline place lookup from a public city list (GeoNames, CC BY 4.0; credit it in the README) downloaded by a repo script with a pinned checksum. Memory: the Pi has about 1.8 GB available; keep the catalogue's in-memory form small.
- **Playlist:** the Pi builds the order itself (a saved seed), so it can resume (R2), skip upright photos, thin bursts, push recent photos back, weight highlights and make chapters. To try first in M0: run the query with a fixed sort and map each index to a file path (`GetMetaData`); if that is too slow for large results, resolve lazily around the position. Exact method decided in M0 and written into `docs/architecture.md`.
- **Live updates:** Server-Sent Events (`GET /api/events`), with reconnect; each event carries the full now-playing state so a viewer that missed one catches up.
- **Buttons:** a separate small service (`photo-buttons.service`) using `python3-evdev`; finds the board by its USB ids, takes it exclusively (so Chromium never sees its keys), and calls the photo API. Mapping in `config/buttons.json`. `SupplementaryGroups=input` (no reboot needed).
- **Kiosk:** Chromium opens `http://localhost:3000/show?kiosk=1` instead of Picapport's slideshow URL; R21's fallback switches back.
- **State and config:** defaults and presets in the repo (`config/`); current values in `/var/lib/photo-api/` (principle 5), which the weekly backup already copies (B25).

## How each part is tested

1. **On the PC, every task:** `node api/test/smoke.js` extended with tests for the new modules against the existing fake Picapport (lockstep, resume after a restart, controls, settings and presets, orders, skip upright, burst thinning, history, marks, schedule, search query building); Python tests for the catalogue and place lookup with a fixture TSV; `bash scripts/check.sh --base origin/main`.
2. **The page, on the PC:** a headless browser test (Puppeteer or Playwright driving the PC's installed Edge or Chrome, dev-only, outside `api/`'s runtime dependencies) against the API running with the fake Picapport: the page loads, follows events, two pages stay in lockstep, controls work, phone layout in mobile emulation, full screen on tap, no console errors; screenshots reviewed.
3. **On the Pi, at the end of each milestone:** deploy the branch (`update.sh --branch feat/slideshow-layer`), the standard state check and `verify.sh`, the API from the PC (`curl http://pi.local:3000/...`), screenshots of the shelf screen (`pi-access`), Chromium's CPU, memory and temperature while the motion runs, and a second viewer (headless browser on the PC pointed at the Pi) in lockstep with the shelf.
4. **Release check (M8):** every requirement R1 to R21 ticked with its evidence in the checklist; a soak of at least 2 hours on the Pi (health log, no errors, no memory growth); restart the API mid-show and confirm it resumes (R2); the fallback (R21) and back.

## Milestones and progress checklist

Status per task: `[ ]` todo, `[~]` in progress (with a note), `[x]` done (date, commit). Tick in the same commit as the work. Each milestone ends deployed and checked on the Pi.

### M0: Spikes and branch (answers the unknowns before building)
- [x] M0.1 Create and push `feat/slideshow-layer`; record in the build log the saved slideshow to restore at the end of every session (`GET /api/status`). (2026-11-18) **Saved slideshow to restore** (from `/var/lib/photo-api/slideshow.json` at 00:10 on 2026-11-18; it differs from the plan's entry, which said Cinque Terre, smart random, 20 s): label "Honeymoon", query `dirall:"/mnt/photos/PHOTOS/2026.09 - 2026.10 - Honeymoon"`, sort `random`, interval 5 s. Restore with `POST /api/slideshow` and that body.
- [x] M0.2 (2026-11-18; `docs/architecture.md` "Slideshow layer": lp applies rotation, sessions and vids last, 3 ms per photo listed, playlist method decided) Picapport: does `lp` apply the rotate tag? How long does a `vid` stay valid, and across how many queries? How fast is mapping index to file path (`GetMetaData`) for 2,000 and 12,000 results? Record in `docs/architecture.md`; decide the playlist method.
- [x] M0.3 (2026-11-18; Wayland Chromium about 58 fps with motion and fill, CPU 15 to 20%, under 50 °C; decisions in `docs/architecture.md`; page kept as a dev tool) Motion test on the Pi: a throwaway test page (served by the branch's API) with pan and zoom, cross-fade and blurred fill at 1080p; measure smoothness (frame timing from the page), CPU and temperature. Decide the motion technique and its limits. Remove the test page or keep it as a dev tool.
- [x] M0.4 (2026-11-18; documentation: not secure-context restricted, needs a tap; emulation check in M4.5) Full screen from a plain `http://` page on Android Chrome: confirm from documentation and the PC's mobile emulation; note that the owner's phone check is in the owner's checklist.

### M1: Catalogue and places (R8 data, R11)
- [x] M1.1 (2026-11-18; fixture test `scripts/test/test_vocabulary.py`, run by `check.sh`) Scan: add the rotate tag, pixel size and GPS longitude to `metadata-survey.sh` (read-only, hard rule 1 comment kept); tests with a fixture.
- [x] M1.2 (2026-11-18; `scripts/fetch-places.sh`, `scripts/places.py`, catalogue in `build-vocabulary.py --catalogue`; 6 Python tests. Decision: GeoNames changes the file daily, so instead of a pinned checksum the download is checked for its shape and its sha256 recorded, see the script) Place list: repo script to fetch the pinned GeoNames file onto the Pi; offline nearest-city lookup in `build-vocabulary.py`; catalogue file and places in the vocabulary; Python tests.
- [ ] M1.3 Deploy; run the full scan on the Pi; check counts (upright, with place) and the vocabulary's places. Docs: architecture "Vocabulary refresh", README, `image-metadata.md`.

### M2: Player engine (R1 to R8, R12 data, R19, R21 compatibility)
- [x] M2.1 (2026-11-18; `api/lib/player.js`, `events.js`; smoke: lockstep, resume after a restart, controls) Now-playing state, seeded order, persistence, resume (R2); controls (R3); the event stream (R1).
- [x] M2.2 (2026-11-18; `settings.js`, `config/slideshow-presets.json`; smoke: the older endpoints unchanged for callers) Settings and presets (R4); existing endpoints (`POST`/`PATCH`/`GET /api/slideshow`, `/api/status`) mapped onto the player, unchanged for their callers (R21).
- [x] M2.3 (2026-11-18; `order.js`, `catalogue.js`, `history.js`; unit and smoke tests) Orders and filters: random, chapters, date; burst thinning; recent history pushed back; on this day; highlights; skip upright (R5 to R8, R19 history).
- [x] M2.4 (2026-11-18; `library.js`: listing cache, folder lookup, image cache with a 2 GB cap, look-ahead of 2) Photo route and image cache (`/api/photo/...`), look-ahead.
- [x] M2.5 (2026-11-18; `node api/test/pi-check.js` against the Pi: lockstep of two viewers within 71 ms, resume at the same photo after the update's restart, honeymoon listed in 38 s (11,807 photos), uncached photo 2.9 s and thumbnail 1.3 s after giving viewers priority over the look-ahead (21 s before), node 83 MB; the shelf shows Picapport's page (viewer `picapport`, R21) until M3.3) Deploy; API tests from the PC against the Pi.

### M3: Shelf viewer (R8 display, R9, R10, R12, R13, R21)
- [x] M3.1 (2026-11-18; `api/public/show.html`, `show.js`, `show.css`; browser test `tools/browser-test/run.js`: lockstep of shelf and phone, late joiner in step, fill only for photos that leave bars, each transition, no console errors) `/show`: lockstep with events, preloading, blurred fill, transitions, motion.
- [x] M3.2 (2026-11-18; five overlay styles in `config/slideshow-presets.json`, the last hides it; relative dates "8 weeks ago", "3 years ago"; screenshots reviewed) Overlay with fields and style presets; relative dates; title and chapter cards; clock; night look.
- [x] M3.3 (2026-11-18; the kiosk opens `/show?kiosk=1`; `viewer: picapport` opens Picapport's own page and `layer` comes back, smoke-tested and used on the Pi during M2) Kiosk opens `/show`; the fallback setting back to Picapport's page (R21).
- [ ] M3.4 Deploy; screenshots across presets and orders; performance; a 30-minute run.

### M4: Phone page (R14, R20 UI)
- [x] M4.1 (2026-11-18; tap: controls and full screen; swipe; manifest and icons) Controls layer: now playing, swipe, pause, back/next, full screen on tap, manifest.
- [x] M4.2 (2026-11-18) Presets and settings panel; overlay style cycling.
- [x] M4.3 (2026-11-18; search with and/or picks over private words, keywords, people, places, folders, years; browse tree) Search with AND/OR word chips (from the vocabulary and the private word list); tag tree (people, keywords, country then city, years); folder browser; year strip.
- [x] M4.4 (2026-11-18; star and bad photo on the bottom bar, `/api/marks`) Mark this photo (star, bad photo) and the review list API (R20).
- [ ] M4.5 Headless tests in mobile emulation and landscape; deploy; test against the Pi with the shelf in lockstep.

### M5: Buttons (R17)
- [x] M5.1 (2026-11-18; `scripts/photo-buttons.py`, `config/buttons.json`, `systemd/photo-buttons.service` installed by `update.sh` when missing; 7 unit tests with recorded presses in `scripts/test/test_buttons.py`) `photo-buttons` service, `config/buttons.json`, long-press handling, learn helper; package `python3-evdev`; unit tests with recorded events.
- [ ] M5.2 Deploy; test on the Pi with a temporary virtual input device; confirm Chromium receives nothing. New skill or a section in `slideshow-control` for the buttons (B18: `button-board`), README runbook including how the owner programs the board.

### M6: Schedule, history, Paseo (R16, R18, R19)
- [ ] M6.1 Screen schedule (off by default), API, survives restarts, works with one-off timers (B28).
- [ ] M6.2 History and suggestions API ("not seen in a while").
- [ ] M6.3 `slideshow-control` skill: what's playing with preview, controls, presets, overlays, orders, search sources, marks, schedule, history; `docs/slideshow-experience.md` updated.

### M7: Map (R15, stretch)
- [x] M7.1 (2026-11-18; `api/public/map.js`, vendored Leaflet 1.9.4, browser test with the tiles stubbed; on the Pi with M4.5) Map panel on the phone page (vendored Leaflet, OpenStreetMap tiles fetched by the phone), points from the catalogue, pick an area to play (`within:`).

### M8: Release check and report
- [ ] M8.1 Every requirement R1 to R21 checked on the Pi with evidence (in the table below); soak of at least 2 hours; resume after an API restart; fallback and back.
- [ ] M8.2 Docs complete (architecture, README runbooks manual and automated, skills, `slideshow-experience.md`, `slideshow-layer.md`, backlog: B32, B31, B26, L1, L9, L10, L11 updated).
- [ ] M8.3 Report to the owner: what was built, what to try, the owner's checklist (below), known limits; shelf left on the saved slideshow (or the owner's choice).

## Owner's checklist (things only the owner can check; filled in at M8)
- Phone: open the page, full screen, swipe, search, mark; mirror to the TV in landscape.
- Program the button board (Windows tool) as the README says, plug it into the Pi, press each input.
- Look at the shelf from the sofa: overlay legible? motion subtle enough? presets right?
- Decide: screen schedule on? default preset? burst thinning on?
- Then say "go" to merge to `main`.

## Requirement evidence (filled in at M8)
| ID | Evidence |
|---|---|
| R1 to R21 | _to fill_ |

## Build log (newest last; one entry per session, written before the session ends)

| When | Session summary | Pi state | Next |
|---|---|---|---|
| 2026-11-18 | Plan written and agreed. Nothing built. | `main` at the plan's commit; saved slideshow "Cinque Terre" (honeymoon folder), smart random, 20 s | M0.1 |

## How to resume

1. Read `CLAUDE.md`, then this page, then [slideshow-layer.md](slideshow-layer.md).
2. `git fetch`, `git switch feat/slideshow-layer` (create it from `main` if M0.1 is not ticked), `git status`, `git log --oneline -10`.
3. If the working tree has uncommitted changes from an interrupted session: read them, finish that task and commit it. Do not discard work with `reset`, `checkout` or `stash`.
4. Read the last build-log entry and the first unticked task; check the Pi's state (`pi-access` skill: which branch is it on, is the slideshow playing).
5. Continue. After every task: tests, `scripts/check.sh --base origin/main`, commit (code, docs and the ticked checklist together), push the branch. Before the session ends, or when the context is running low: add a build-log entry (what was done, Pi state, next task), commit and push, and leave the shelf playing.

## Build prompt (paste into a new Paseo session to start or resume the build)

```
Build the slideshow layer (backlog B32), Phase 2.

Read CLAUDE.md, then docs/slideshow-layer-build.md (the delivery plan, build
mandate and progress checklist) and docs/slideshow-layer.md (the requirements
and reasoning). Follow "How to resume" in the plan: it tells you whether to
start or carry on, and from which task.

By starting this prompt I give the build mandate in the plan: work on the
branch feat/slideshow-layer, commit and push it, deploy it to the Pi with
update.sh as often as needed, and run the tests described, without asking me
for each step. Everything the plan lists under "Never" still needs me, and the
hard rules in CLAUDE.md always apply (never touch the photo HDD; never merge to
main until I say go; no reboots).

Work through the milestones in order, testing each as the plan says, ticking
the checklist and pushing after every task, so another session can pick up if
this one ends. Before you stop for any reason, write the build-log entry and
leave the shelf screen playing my saved slideshow.

Do not stop to ask me about choices the plan leaves to you; decide, record the
decision in the docs, and carry on. Stop and ask only for something under
"Never" or a hard rule. When milestone M8 is complete, tell me the slideshow
layer v1 is built (send a push notification if you can), with the short report
and my checklist from the plan.
```
