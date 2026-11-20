---
name: slideshow-control
description: Use when the owner asks to see photos ("show us Barcelona", "the wedding", "photos of us from last summer", "this day in past years", "something we haven't seen in a while"), to change or steer the slideshow ("slower", "every 30 seconds", "next", "go back", "pause", "guests mode", "show the date", "skip the upright ones", "what's playing?", "where was that?"), to mark a photo ("star this one", "that's a bad photo"), or to switch the screen ("turn it off", "off for an hour", "off until tomorrow", "turn it back on", "off every night"). Turns plain words into photo API calls and replies in the agreed style. Changes the slideshow and screen through the photo API only; owner decision: no confirmation needed for these.
---

# Slideshow control

Layer 3 of slideshow control (principle 12). The person asking knows nothing about folders, tags or query syntax. You translate, act, and report.

**The slideshow layer (B32):** the Pi holds the one slideshow (order, position, settings) and every screen is a window onto it: the shelf screen, and the phone at `http://pi.local:3000/show` (tap for controls and full screen). What you change here shows everywhere at once. Full reference: `docs/architecture.md`, "Slideshow layer".

**Agreement:** playing, changing and stopping the slideshow and switching the screen **through the photo API** is the owner's everyday use. Act first, no confirmation (owner decision, 2026-11-16; `docs/slideshow-experience.md`). Anything else that touches the Pi (SSH that writes, restarting services, reboots, Picapport) is **not** this skill: use `pi-access` / `apply-changes` with their agreement gates. Hard rule 1 applies: never change photos or their tags.

## Preconditions

- Use the Bash tool (Git Bash) and `curl`. API: `API=http://pi.local:3000` (if `pi.local` does not answer, see `pi-access`, "If `pi.local` does not answer"). Check with `curl -s -m 10 $API/api/status`.
- No SSH is needed. Never call Picapport directly; the API is the only route (it guards against queries that break Picapport).

## Know what can be found (read-only, do first)

```bash
curl -s $API/api/status       # what is playing: query, label, sort, interval; screen state
curl -s $API/api/player       # now playing in detail: current photo (date, place, event, people), position, settings, preset
curl -s $API/api/words        # the owner's personal words: "us", "home", ...
curl -s $API/api/vocabulary   # keywords, people (with photo counts, searchable or not), folders (with a dirall: query), years, places (country, then city, with keys)
```

The vocabulary is large (hundreds of folders): read it into the conversation once, or filter it, e.g. `curl -s $API/api/vocabulary | grep -i -o '"path":"[^"]*barcelona[^"]*"'`.

Query rules (proven; details in `docs/image-metadata.md`, "Query syntax"):

| Want | Write |
|---|---|
| both / either / not | `a b` / `a OR b` / `-a`. **OR binds before AND**: `noosa OR croatia 2023` = (noosa or croatia) in 2023 |
| a year, month, day, years | `2024`, `sep` (3 letters), `sep18`, `2020-2021` |
| a folder and everything below it | `dirall:"/mnt/photos/PHOTOS/<path from the vocabulary>"` |
| a place by GPS (about 2/3 of photos have GPS) | `within:"minLat,minLng,maxLat,maxLng"` (5 decimals), from your own knowledge of the place; combine with the place's folder words using OR |
| a person or keyword | the word itself (3+ letters; shorter ones can never be found) |

Never: `*` (the API refuses it), quotes for phrases (they do not work), `field:value`, words under 3 letters. Words match anywhere: a name also matches the same word in folder names.

## Steps

1. **Understand the request.** Resolve personal words from `/api/words` first ("us" → its `query`). Map the rest onto the vocabulary: people, keywords, folder names, places (folder words OR a GPS box), dates. If a word could be a tag you see in the vocabulary (for example "romantic" → a `sunset` keyword), consider it. Never invent a tag that is not in the vocabulary.
2. **Count before playing:** each part and the whole, nothing changes on screen:
   `curl -s -G $API/api/count --data-urlencode "q=<part 1>" --data-urlencode "q=<part 2>" --data-urlencode "q=<whole query>"`
3. **Nothing found (0):** do not play. Say so and suggest the closest things that do exist (with counts).
4. **Play** (it is saved and resumes where it was after a restart):
   `curl -s -X POST $API/api/slideshow -H 'content-type: application/json' -d '{"query":"<query>","label":"<short name in the owner's words>"}'`
   Settings not given (order, seconds per photo) are kept. If the same slideshow is already playing it is not restarted; add `"restart":true` only if the owner asks for a fresh shuffle. **`"preparing":true`** in the answer means a big slideshow is being listed (about 40 s for 12,000 photos the first time, seconds after); the old one plays until then: say "getting it ready".
   **Places, dates and history** (from the photo API's own catalogue, not a Picapport word): `POST $API/api/player/source -d '{"source":{...,"label":"..."}}'` with `places` (keys from the vocabulary's `places`: `["IT"]` a country, `["ES/Barcelona"]` a city), `years` (`[2019]`), `onThisDay: true` ("this day/week in past years"), `notSeenDays: 90` ("something we haven't seen in a while"), and/or a `query`; all given parts must match. `GET $API/api/suggestions` gives counts for "this week in past years", "not seen in 90 days" and the events not seen for longest, for "what can you show us?".
5. **Change settings** (no reshuffle; the current photo stays): `curl -s -X PATCH $API/api/slideshow -H 'content-type: application/json' -d '{"interval":30}'` still works for seconds and order (`{"sort":"randomsmart"}` is now **chapters**: short runs from one event with its name). Everything else with `PATCH $API/api/player/settings`:
   | Owner says | Body |
   |---|---|
   | "don't move on by itself" / "play again" | `{"autoplay":false}` / `{"autoplay":true}` |
   | "oldest first", "in order", "newest first", "chapters" | `{"order":"date-asc"}`, `"date-desc"`, `"chapters"`, `"random"` |
   | "skip the upright ones" / "show them again" | `{"upright":"skip"}` / `{"upright":"fill"}` |
   | "less movement", "no movement", "livelier" | `{"motion":"subtle"}`, `"off"`, `"lively"`; transitions `{"transition":"fade"}`, `"dip"`, `"slide"`, `"rise"`, `"zoom"`, `"bloom"`, `"drift"`, `"deck"`, the showpieces `"cube"`, `"flip"`, `"louvres"`, `"mosaic"`, `"shatter"`, `"ripple"`, `"doors"`, `"vortex"`, `"glitch"`, `"snapshot"`, or `"random"` (a different one per photo; `{"surpriseSkip":["glitch"]}` leaves some out of it, `[]` uses them all) |
   | "show the date", "how long ago", "no text", "show where", "show who" | `{"overlay":{"date":"absolute"}}`, `{"overlay":{"date":"relative"}}`, `{"overlayStyle":4}` (hidden; 0 small bottom left, 1 strip, 2 large top right, 3 dark text), `{"overlay":{"place":true}}`, `{"overlay":{"people":true}}` |
   | "title cards", "a clock", "dimmer" | `{"titleCards":true}`, `{"clock":true}`, `{"night":true}` |
   | "make the clock big", "flip clock", "clock in the middle", "clock mode" | `{"clock":true,"clockStyle":{...}}`, only the fields that change: `size` `s`/`m`/`l`/`xl`/`huge`, `face` `classic`/`thin`/`editorial`/`condensed`/`outline`/`flip`/`words`/`analog`, `position` `top-left`/`top-center`/`top-right`/`center`/`bottom-left`/`bottom-center`/`bottom-right`, `tone` `auto`/`light`/`dark`/`gold`, `backing` `shadow`/`plain`/`glass`/`pill`/`paper`/`rule`, `opacity` 10 to 100, `hour12`, `date`, `scrim` `none`/`soft`/`deep` (clock mode: `{"face":"editorial","position":"center","size":"huge","date":true,"scrim":"deep"}`) |
   | "go back to my caption layout" | `{"overlayMode":"custom"}` (the owner designs layouts on the phone; `overlay` and `overlayStyle` switch to the classic captions and keep the layout for later) |
   | "show every burst photo" | `{"bursts":false}` (default on: one photo per burst) |
   **Presets** (starting points; a change afterwards is kept): `POST $API/api/player/preset -d '{"name":"<ambient|present|guests|night or one of the owner's, listed by GET $API/api/presets>"}'`. "Save this as a preset called X": `POST $API/api/presets -d '{"label":"X"}'`. Ambient: plays by itself, gentle. Present: the owner steps through, date order, title cards, date, place and event. Guests: livelier chapters, how long ago. Night: dimmer, slower, no text.
6. **Steer what is playing** ("next", "go back three", "pause", "keep going", "jump to 2019"): `POST $API/api/player/next`, `/back` (body `{"steps":3}`), `/pause`, `/play`, `/jump` (`{"year":2019}` in a date order).
7. **Favourite or skip a photo** ("star this one", "unstar it", "skip this", "bring it back"): `POST $API/api/photo/rating -d '{"rating":5}'` (5 favourite, 1 skipped, 0 neither; optional `"id"`, otherwise the photo on screen). It waits and answers with the verified result: the rating is written into the photo by the one metadata writer (hard rule 1), and a 409 or 500 means nothing changed, so say why. `GET $API/api/ratings` gives the counts and whether saving is on. Play them with the sources `{"favourites":true,"label":"Favourites"}` and `{"skipped":true,"label":"Skipped photos"}`; every other slideshow leaves skipped photos out.
8. **Screen:** off `-d '{"on":false}'`; off for a while `-d '{"on":false,"minutes":60}'`; off until a time `-d '{"on":false,"until":"<ISO time>"}'` (get it with `date -d "tomorrow 07:00" -Iseconds`; the Pi and the owner are on Sydney time); on `-d '{"on":true}'`; all `POST $API/api/screen`. Starting a new slideshow turns the screen on. **Every night** ("off at midnight, on at 6"): `PUT $API/api/schedule -d '{"enabled":true,"off":"00:00","on":"06:00"}'` (`{"enabled":false}` to stop; off by default). Turning it on by hand at night is respected until the next night.
9. **Reply** in the format below, then optionally a follow-up.

## Reply format (Markdown for the Paseo mobile app)

Visual and short: **one heading** with an emoji that says what happened, the photo count under it, contents as a short list with counts, a **Settings** section with inline-code **chips** (order, seconds per photo; mention the screen only when it is off or the request was about it), and any question or offer in a **💬 quote** (a speech bubble). No tables. Numbers with thousands separators; dates and times in plain words. Always show every setting in effect in the Settings section, including defaults the owner did not mention. Do not write "saved, comes back after a restart" (owner, 2026-11-17: everything is saved anyway). Fill in real values; the examples below show the shape.

**Playing something new**

````markdown
### 🖼️ Now playing · Barcelona
**4,252 photos**

**What's in it**
- 💍 Honeymoon, Barcelona · 2,203
- 🎓 Exchange 2015–16 · 1,180
- 📍 Other photos taken in Barcelona · 869

**Settings**
`🔀 Random` `⏱️ 20 s`

> 💬 This mixes your honeymoon and your exchange, ten years apart. Just the honeymoon, or only the two of you?

*Try: "only the honeymoon" · "slower" · "smart random"*
````

**Changing a setting**

````markdown
### ⏱️ Slower · one photo every 30 s
Still **Honeymoon** · same order, same photo

**Settings**
`🔀 Random` `⏱️ 30 s`
````

**Screen**

````markdown
### 🌙 Screen off · until 7:00 tomorrow
**Honeymoon** stays saved and shows again when the screen comes on. Say "turn it on" any time.
````
(☀️ for "Screen on".)

**What's playing?** / **"Where was that?"** (from `GET /api/player`: `current.info` and `current.thumb`)

````markdown
### 🖼️ Playing now · Honeymoon
**Vernazza, Italy** · 21 September 2026 (8 weeks ago) · Honeymoon › Cinque Terre
![now](http://pi.local:3000/api/photo/<current.id>?size=thumb)
Photo 1,204 of 6,931

**Settings**
`🌿 Ambient` `🔀 Random` `⏱️ 20 s`
````

The preview link works on the home network only (the phone in the house). Settings chips: the preset (and "changed" if `preset.changed` is not empty), the order, seconds; add others only when they are not the preset's (for example `🙈 no upright`, `🕰️ clock`).

**Nothing found** (nothing was played)

````markdown
### 🔍 Nothing found for "snow"
Closest I can show:
- 🏔️ Japan, Magome–Tsumago · 412
- 🇳🇿 New Zealand 2019 · 230

> 💬 Want one of these on the screen?
````

**Exploring** ("where did I go in Italy?", "what do we have from 2019?")

````markdown
### 🗺️ Italy in your photos
- 🏛️ Rome · Europe trip, Jan 2016 · 320
- 🛶 Venice · Europe trip, Jan 2016 · 180
- 🍋 Amalfi Coast · Honeymoon, Sep 2026 · 1,140

> 💬 Want any of these on the screen?
````

Pick emoji that fit the content (a ring for a wedding or honeymoon, a flag for a country); one per line at most. Keep the whole reply to about ten lines. The 💬 quote is for a question or an offer only, and is optional (see below).

**Follow-up (encouraged, not a rule):** when the request matched several things, say so after playing and offer something interesting, for example two trips ten years apart, or "only the two of you". One or two lines, in the 💬 quote.

## Experience preferences (owned by the owner; change them here when asked)

- Act first; never ask before playing a clear request. Ask only after playing, as a follow-up.
- Default order: plain `random`. Chapters (the old Smart Random: short runs from one event) only on request.
- Default preset: Ambient. Burst thinning on, upright photos shown with a blurred fill (the owner decides these on their checklist, M8).
- Default seconds per photo: keep the current setting (20 s as of 2026-11-16).
- Replies use the visual format above: emoji heading, setting chips, 💬 quote for questions (owner, 2026-11-17).
- The mouse pointer is hidden on the slideshow screen (built in; nothing to do).
- "Tomorrow morning" for the screen means 07:00 (proposed default; change it if the owner says otherwise).

**When the owner asks for a different experience** ("don't tell me the counts", "default to 10 seconds"), change this section and `docs/slideshow-experience.md` in the same commit (`git-workflow`), and say what you changed.

## The private word list

When the owner explains a personal word ("home means Lusty Bonar", "my parents are Mum and Dad"), save it: GET `/api/words`, add or change the entry `{ "means": "<plain description>", "query": "<query it stands for>" }`, PUT the whole document back:
`curl -s -X PUT $API/api/words -H 'content-type: application/json' -d @words.json` (write the JSON to a temporary file first). Tell the owner what you saved. The list lives only on the Pi (`/var/lib/photo-api/words.json`), never in the repo; the API creates it from `config/words.example.json` if it is missing.

## Verify

The POST/PATCH answer has `"played":true`, and `GET /api/player` shows the new slideshow (`status` `playing`; `preparing` while a big one is listed). If the owner says the screen looks wrong, use `pi-access` ("See what the screen shows").

## Undo

Before playing, keep the old `source` and `settings` from `GET /api/player`. To go back, POST the source to `/api/player/source` (or the old `query` and `label` to `/api/slideshow`) and PATCH the settings back. If our page itself misbehaves, `PATCH /api/player/settings {"viewer":"picapport"}` puts Picapport's own slideshow page on the shelf (the old behaviour; `"layer"` to come back) and tell the owner.

## Do not

- Use SSH, Picapport's own URLs, or the Picapport web UI to control the slideshow.
- Send `*`, phrases in quotes, or words under 3 letters as if they could match.
- Edit photo metadata or "fix" tags (hard rule 1). If tags are missing or misspelt, tell the owner what you noticed.
- Ask for confirmation before playing, or reboot/restart anything to fix a slideshow problem (that is `pi-access` and `apply-changes`, with agreement).

## Links

`docs/slideshow-experience.md` (the agreed experience), `docs/image-metadata.md` (what can be found, query syntax), `docs/architecture.md` ("Photo API", "Slideshow layer"), the `button-board` skill, README "Controlling the Slideshow" (the same calls by hand), backlog B23, B24.

## Last verified

2026-11-18: extended for the slideshow layer (B32): every new call run against the Pi during the build (not cold-tested in this form). 2026-11-17: cold-tested by the owner in fresh Paseo sessions: fast, good follow-up questions, answers exploring questions such as "where did I go in Italy?" (owner's words: "working very well"). Reply format then changed to the visual style above (not yet re-tested). 2026-11-16: every call above run against the Pi while building it.
