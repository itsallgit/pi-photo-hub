# Slideshow layer: requirements and design (B32, Phase 2)

**Status: done. Release 1 (tag `v1.0`), merged to `main` and running on the Pi since 2026-11-18. Owner: "you've allowed me to rediscover my photos"; this is the baseline and Picapport's presentation is not coming back.** Technical facts and decisions: [architecture.md](architecture.md), "Slideshow layer". This page records what the owner said, the agreed goal and core model, findings and the ideas. **The requirements (R1 to R21), the delivery plan, the build mandate and the progress checklist are in [slideshow-layer-build.md](slideshow-layer-build.md).** A later session builds from these two pages, not from chat history.

Related: [slideshow-experience.md](slideshow-experience.md) (how asking for photos feels, agreed 2026-11-16), [architecture.md](architecture.md) ("Photo API", "Picapport slideshow behaviour"), [principles.md](principles.md) (11: metadata lives in the photos; 12: the photo API is the only control route), backlog B32, B31, B26, L1, L9, L10, L11.

## What the owner said (interview, 2026-11-17)

### The room and the screen
- The 22" HP monitor sits on the **top shelf in the living room**. Everyone can see it from the sofa, the kitchen and the dining table, but **text on it can only be read by walking up to it**.
- The Pi is on the shelf below, hidden behind an accordion panel that tidies the cables.

### Who watches, and when
- Anyone in the house. **Always on by default**; it is ambient.
- A nightly off period (for example midnight to 6:00) would be welcome but is not done today (L9).
- The screen is turned off by hand when watching something with the lights down, using the `slideshow-control` skill in Paseo. That works well.
- **Guests:** when friends visit, the owner plays photos of times together with them, as a conversation starter. That depends on people being tagged, and few photos are tagged yet (the ingestion pipeline, L7).

### What could be better today
- **Upright photos** are hard to see. Ideas from the owner: fill the empty sides with a **blurred, enlarged copy of the same photo** instead of black bars; or show **several upright photos side by side**.
- **More life on screen:** a subtle **pan and zoom** (the "Ken Burns" effect), transitions, and generally something closer to the animated slideshow videos some websites make from uploaded photos.
- **Bad photos** (blurry, duplicates) come up. The owner plans to deal with them in the ingestion pipeline (L7): AI scene tagging (for example "pesto" finding basil or a pestle and mortar), people tagging, deleting blurry and duplicate photos, **starring highlights** (which could stay on screen longer or feature more), and place metadata to show on screen.

### Control
- **Button board (L1):** a USB-C board from AliExpress with **three keys and a rotary knob that also clicks**. It acts like a keyboard; vendor software binds the keys to keyboard input (model and default key codes not yet known). It would sit in front of the accordion panel, so it looks tidy. The owner's ideas: pause/play, back, next, cycle through options, and the knob to choose settings (for example speed), "something fun".
- **Without touching the phone:** Paseo with natural language works well, but it has to be opened. A voice trigger on the phone, like the default assistants, is a **future** wish and **not part of this phase**.

### The big TV
- The owner has a **77" LG GX (Gallery Series)** in the same home. They would like to show photos on it to visitors (for example a trip), leaning back on the sofa and pressing "next" like a normal presentation. The Pi will **not** be moved to the TV (no space), so this would be some form of streaming or casting, the way a phone or tablet shares its screen today. The owner considers this a significant point: the slideshow should be able to show on the TV as well as the shelf monitor.

### Round 2 (2026-11-17)

**A guest evening.** The shelf screen is always playing. Before friends arrive the owner opens Paseo and asks for photos of those friends, perhaps slower and **with the date shown**. For friends the place is irrelevant (usually the same city), but the date sparks "look how long ago that was". **A relative date** ("3 years ago", "8 months ago") would be fun, as a setting. For a trip, the plain date. When someone points and asks "where was that?", the owner wants to find out on the spot: walk up and press a button that pops up the details, **or, better, open the slideshow on the phone** and see it there, step back or forward, and change settings, without asking Paseo (Paseo is for "a moment in time" requests, the phone page for live control).

**The TV.** Presenting on the TV **replaces the shelf screen for that evening** in practice; the shelf screen may keep playing on its own, nobody is looking at it. On the TV: the standard slideshow, swiped or clicked through one by one while the owner tells the story, the date on screen (top or bottom). **A map** to explore where photos were taken and click into them is a **stretch goal**. Driving the TV itself (a "hacked" TV controlled over ADB, as a friend has done) is **not wanted**; a button that sends the pictures to the TV would be lovely if it were possible without that.

**The buttons are for controlling what is playing,** not for choosing what to play: back one or a few photos when it moved on too soon, pause to talk about one, next, toggle overlays, change settings (for example speed). A convenience when walking past, instead of the phone. Guests may use them but rarely; they will not be labelled.

**Two moods:** a **passive (ambient)** mode in the background, and an **active** mode for showing photos to people (stepping through, the map), which can also be **livelier and more eye-catching**.

### Round 3 (2026-11-17): one slideshow, many viewers

**The core model (owner's words, important):** a web server on the Pi serves **the slideshow**. Any browser on the home network opens it and **views** it: the shelf screen, the owner's phone, and (by mirroring the phone) the TV. The phone does not "control a screen"; it **views the slideshow and can edit it**, just as Paseo edits it through the API: change settings, or change what is playing (browse folders, pick from tags, or a search bar). Whatever the phone sets is what the shelf screen shows too, and what the TV shows when the phone is mirrored to it.

- **The TV:** in practice the owner **mirrors the phone to the TV** (screen share, as today), rather than using the TV's browser, which is sluggish and awkward to type into. So the phone's view must look good full-screen, in landscape, on a big screen.
- **Phone page:** no "proper app" needed. Ideally a **progressive web app** installed from Chrome on the phone.
- **Info on demand:** the phone replaces walking up to the screen for "where was that?". A button for it is still welcome as an option.
- **Relative dates:** almost all photos come from the owner's phone camera, so they carry a date. **If a photo has no date, show none.**
- **No password** on the phone page is fine, on the home network only (as for the API, L5).
- **Settings, not modes:** "ambient" and "present" are **presets** (starting points) over the same settings, all editable. For example: autoplay on or off, and if on, the interval. Present starts with autoplay off; ambient starts with it on.
- **Upright photos:** **blurred fill** preferred over side by side (two unrelated photos look odd). **Skip upright photos** as a per-slideshow setting.
- **TV remote:** native control from the TV remote would be great, but with mirroring the TV only shows the phone, so the remote cannot step through photos. Only relevant if the TV's browser is ever used. Not pursued.

### Round 4 (2026-11-17)

- **Lockstep: yes.** Every viewer shows the same photo at the same moment. Pause, back or next on the phone, the buttons or Paseo changes it everywhere. **No private browsing** on the phone.
- **Full screen is a hard requirement** on the phone: no address bar while going through photos.
- **Mirroring:** the owner's Samsung phone has a setting to fit its mirror to the TV's aspect ratio, so the black bars land on the phone, not the TV. Not a concern.
- **HTTPS for an installable PWA is acceptable:** the owner has done it before (own certificate, a domain pointing at the home address, the certificate added to the phone).
- **Search on the phone: no AI service, no free sentences.** Paseo already does natural language. The phone needs "subtle intelligence": take the words typed, drop words that mean nothing ("in", "of"), and combine the rest sensibly ("us in Barcelona" means us AND Barcelona; "France Italy Spain" means any of the three). Plus browsing: a **tag list grouped nicely (for example country, then city)**, built from the vocabulary, and a **folder browser** to pick what plays.
- **Overlay styles are configurable** through a few presets that can be cycled: position of the information, a subtle backing (none, shadow, strip) for readability, text colour (white with a dark shadow, or dark). Not fully custom.
- Nothing disliked in other slideshows.

### The button board (from its manual, 2026-11-17)

A generic "3 key + 1 knob" USB-C keypad (the manual's title is "Custom keypad operation manual"; settings tool `MINI KeyBoard.exe`, Windows only, from the QR code or `szxiaozi.com`). It is a **USB keyboard**: each of **KEY1 to KEY3 and the knob's left turn, press and right turn** (6 inputs) can be set to a key combination (for example Ctrl+V) or a multimedia key (play/pause, previous, next, mute, volume up/down). The setting is downloaded into the board, so it keeps it on any computer. LEDs have selectable effect modes, and mode 0 switches the light off. Its default keys are not stated in the manual (found 2026-11-18: all six inputs sent the letter C until programmed; see `docs/hardware.md`).

### Round 5 (2026-11-17)

- **The "window onto the Pi" model is confirmed** (see "Core model" below).
- **Full screen without HTTPS first:** try the browser's full-screen mode on a tap; HTTPS and the installable PWA only if needed.
- **Search: keep it simple.** Type a word, pick it, choose AND or OR, add the next word. The agent may land on a simple version; expand later. No grammar rules.
- **Goal statement accepted** (below).

## Goal (agreed 2026-11-17)

A living photo wall that quietly plays our life in the background, and turns into a show-and-tell when people are over. Always on, good-looking from across the room, upright photos and dates handled nicely. **One slideshow on the Pi; every screen is a window onto it**, and anyone can steer it from where they are (phone, buttons, Paseo). Simple settings with presets, nothing fiddly. None of it ties us to Picapport or stores anything that belongs in the photos.

## Core model (agreed 2026-11-17)

- **The Pi holds the "now playing" state:** the ordered photo list of the current slideshow, the position in it, playing or paused, the settings, and when the current photo started. Because the Pi holds the list and the position, a restart resumes instead of reshuffling (B26).
- **Every browser is a viewer** (shelf screen, phone, the TV through the mirrored phone). It keeps a live connection to the Pi, is told "now showing photo N", downloads only that photo and the next one, sized for its screen, and runs transitions and motion itself.
- **Every change goes through the photo API** (principle 12): the phone page, the buttons and Paseo make the same calls; the Pi moves on and tells every viewer. Viewers never talk to Picapport, so it stays replaceable (L3).

## Findings (read-only, 2026-11-17)

- **Picapport serves resized photos:** `GET /lp?vid=<vid>&index=<n>&cx=<w>&cy=<h>` (same session as `RunQuery`) returns a JPEG fitted to the size asked for; `cx=0&cy=0` the original. Thumbnails: `lp?vid=..&index=..&cy=160`. Measured on the Pi: a 1920x1080 version in about 2.3 s (about 640 KB), a 3840x2160 version in about 2.5 s (1.9 MB). So the photo API can fetch images through Picapport's adapter today; a viewer needs to load the next photo ahead of time. Not yet known: whether `lp` applies the EXIF rotate tag, and how long a `vid` stays valid.
- `GetMetaData` gives per photo: file path, creation date, raw width and height (rotate tag not applied), rating, GPS, camera, and the indexed words. No image URL.
- **What the photos carry** (nightly scan, 63,307 JPEGs): a capture date on 61,921 (97.8%), GPS on 43,139 (68%). The scan does not record the rotate tag or pixel size today, so "is this photo upright?" needs one more field in the scan (or a quick read of the file's header when it is played).

## Art of the possible (agent's ideas, 2026-11-17; for the owner to rate)

Each: what it is, what it takes, what it depends on.

**Choosing and ordering**
1. **Resume, no reshuffle** (B26). The Pi saves the shuffle (a seed) and the position; a restart, update or reboot carries on. Takes: our own playlist (core). Depends on nothing else.
2. **Fewer repeats across slideshows.** Remember which photos were shown recently (on the SD card, presentation history, not photo knowledge) and play those last. Takes: a small history file. Depends on 1.
3. **Burst thinning without AI.** Photos taken a few seconds apart in the same folder are mostly near-duplicates: show one per burst. Takes: capture times (97.8% have them). Depends on our own playlist. An interim for the bad photos until the pipeline (L7) removes them.
4. **Chapters.** In random order, play a short run from one event (folder), then jump to another; on entering an event, show its name and date for a moment (folders are named events). Takes: folder names and dates, which we have. A richer version of Smart Random.
5. **On this day.** "This week in past years" as a slideshow source, and a good default for ambient. Takes: dates only.
6. **Highlights.** Starred photos (rating in the photo) appear more often and stay longer. Takes: the rating, which our scan already reads (58 rated photos today). Depends on starring in the pipeline (L7).
7. **Upright photos:** blurred fill by default, "skip upright" as a setting (B31). Takes: the rotate tag and size (one scan field, or read at play time).

**On screen**
8. **Subtle pan and zoom** ("Ken Burns"), with direction and speed varied per photo; livelier in the guest preset. Takes: browser animation; the Pi 4's Chromium must keep it smooth at 1080p (to test early). Later, pan towards faces (needs people regions, L7).
9. **Transitions:** cross-fade by default; slide, zoom-through, dip to black as options.
10. **Information overlay** (L11): date (absolute or relative, "3 years ago"), place, event (folder) name, people when tagged; style presets (position, backing, colour) cycled from the phone or a button. Takes: our page. Place needs 11.
11. **Place names without the internet.** Turn GPS into city and country with an offline place list on the Pi during the nightly scan. Feeds the overlay, a country-then-city tag tree on the phone, and searches by place. Derived from the photos' own GPS, so rebuildable (principle 11); the pipeline may later write place names into the photos.
12. **Title cards in present mode:** the event's name and dates before its photos, like the start of a chapter.
13. **A small clock** in the ambient preset (option; off by default).
14. **Night look:** a dimmed, slower ambient preset in the evening, as well as or instead of the screen schedule (L9).

**Control**
15. **Phone page:** now playing (photo, date, place, event); back, pause, next, swipe; presets and settings; search with AND/OR word chips; tag tree; folder browser; maybe a year strip to jump through time.
16. **Map (stretch):** photos as dots on a map; tap an area to play it (Picapport already supports area queries, `within:`). Needs map tiles from the internet (OpenStreetMap) or an offline map.
17. **"What's playing?" in Paseo** with the current photo's date, place and event, and a small preview image.
18. **Buttons, a first map** (all through the API): KEY1 back, KEY2 pause/play, KEY3 next; knob turn: slower/faster (or step through photos); knob press: cycle the overlay style. The Pi sees press and release, so a **long press** can do more (for example long KEY2 = screen off/on). Program the board with keys nothing else uses.
19. **Screen schedule** (L9): off at night, on in the morning, with defaults in the repo and changes through the API.
20. **History and suggestions** (L10): what was played and when; "something we haven't seen in a while"; Paseo can suggest from it.
21. **Mark this photo** (phone or button): "star" or "bad photo" goes into a review list, which the owner's pipeline (L7) later applies to the photo files. The list is temporary; the lasting result lives in the photo (principle 11, hard rule 1).

## Early observations (agent, unverified; to discuss)

- Because nobody can read text from the sofa, on-screen information (date, place, L11) needs to be either large and minimal, or shown on demand (for example a button press shows an information card for a few seconds).
- If our slideshow is an ordinary web page served by the Pi, any screen with a browser might open it, possibly including the LG TV's own browser. Not verified for the LG GX (webOS); open question.
- A keyboard-like board plugged into the Pi sends its keys to whatever has focus, which is Chromium in kiosk mode. Until the board's keys are known, plugging it in could trigger browser shortcuts. Find out what it sends first (on the PC, or read-only on the Pi). Likely design (to agree): program the board with keys nothing else uses (for example F13 to F18), and have a small service on the Pi read the board directly and call the photo API, so the keys never reach Chromium and the API stays the only control route (principle 12). An open-source Linux tool for programming boards of this kind is believed to exist (unverified), which would let the setting live in the repo instead of only in the Windows tool.
- The LG TV's remote (arrow keys, OK) might drive a page open in the TV's browser directly: left/right for back/next. Unverified.
- Deleting or rating photos is a change to the photo files, so it is never done by the slideshow (hard rule 1). A button could still mark a photo for the owner's later review in the ingestion pipeline, as long as the mark is temporary and the lasting result is written into the photo by the owner's pipeline (principle 11).

## Open questions
The remaining ones are answered by the build (milestone M0 in the plan) or by the owner's checklist.

- ~~A great evening; buttons' purpose; calm or show; the board; TV mirrored or its own~~ answered in round 2. ~~Phone page form; which screen the phone controls; upright and date defaults; autoplay in present~~ answered in round 3.
- ~~Lockstep; search; PWA~~ answered in round 4.
- ~~Owner's ratings of the ideas~~: all wants (round 6).
- ~~Full screen from plain `http://`~~: allowed on a tap (documentation, M0.4); the owner checks on the phone. HTTPS only for installing the app.
- ~~Place names~~: built (offline GeoNames list, M1).
- The board's default key codes (not in the manual): the learn helper shows them when the board is plugged in (owner's checklist); F13 to F18 and the multimedia keys are both mapped.

## Round 6 (2026-11-18): ratings and the plan

- **Every idea (1 to 21) is a want**; none rejected. The owner asked for a formal delivery plan and one build prompt for a new session that builds all of it without testing feature by feature with the owner, reports when the version is built, and is **resumable** across sessions. Result: [slideshow-layer-build.md](slideshow-layer-build.md) (requirements R1 to R21, build mandate, milestones M0 to M8, tests, progress checklist, build log, the build prompt).
