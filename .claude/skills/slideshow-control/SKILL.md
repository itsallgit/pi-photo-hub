---
name: slideshow-control
description: Use when the owner asks to see photos ("show us Barcelona", "the wedding", "photos of us from last summer"), to change the slideshow ("slower", "every 30 seconds", "smart random", "what's playing?"), or to switch the screen ("turn it off", "off for an hour", "off until tomorrow", "turn it back on"). Turns plain words into photo API calls and replies in the agreed style. Changes the slideshow and screen through the photo API only; owner decision: no confirmation needed for these.
---

# Slideshow control

Layer 3 of slideshow control (principle 12). The person asking knows nothing about folders, tags or query syntax. You translate, act, and report.

**Agreement:** playing, changing and stopping the slideshow and switching the screen **through the photo API** is the owner's everyday use. Act first, no confirmation (owner decision, 2026-11-16; `docs/slideshow-experience.md`). Anything else that touches the Pi (SSH that writes, restarting services, reboots, Picapport) is **not** this skill: use `pi-access` / `apply-changes` with their agreement gates. Hard rule 1 applies: never change photos or their tags.

## Preconditions

- Use the Bash tool (Git Bash) and `curl`. API: `API=http://pi.local:3000` (if `pi.local` does not answer, see `pi-access`, "If `pi.local` does not answer"). Check with `curl -s -m 10 $API/api/status`.
- No SSH is needed. Never call Picapport directly; the API is the only route (it guards against queries that break Picapport).

## Know what can be found (read-only, do first)

```bash
curl -s $API/api/status       # what is playing: query, label, sort, interval; screen state
curl -s $API/api/words        # the owner's personal words: "us", "home", ...
curl -s $API/api/vocabulary   # keywords, people (with photo counts, searchable or not), folders (with a dirall: query), years
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
4. **Play** (it is saved and plays again after a restart):
   `curl -s -X POST $API/api/slideshow -H 'content-type: application/json' -d '{"query":"<query>","label":"<short name in the owner's words>"}'`
   Settings not given (order, seconds per photo) are kept. If the same slideshow is already playing it is not reshuffled; add `"restart":true` only if the owner asks for a fresh shuffle.
5. **Change settings only** ("slower", "every 30 seconds", "smart random", back to "random"):
   `curl -s -X PATCH $API/api/slideshow -H 'content-type: application/json' -d '{"interval":30}'` (or `{"sort":"randomsmart"}`). A change reshuffles.
6. **Screen:** off `-d '{"on":false}'`; off for a while `-d '{"on":false,"minutes":60}'`; off until a time `-d '{"on":false,"until":"<ISO time>"}'` (get it with `date -d "tomorrow 07:00" -Iseconds`; the Pi and the owner are on Sydney time); on `-d '{"on":true}'`; all `POST $API/api/screen`. Starting a new slideshow turns the screen on.
7. **Reply** in the format below, then optionally a follow-up.

## Reply format (Markdown for the Paseo mobile app)

Visual and short: **one heading** with an emoji that says what happened, settings as inline-code **chips**, contents as a short list with counts, and any question or offer in a **💬 quote** (a speech bubble). No tables. Numbers with thousands separators; dates and times in plain words. Always show every setting in effect, including defaults the owner did not mention. Fill in real values; the examples below show the shape.

**Playing something new**

````markdown
### 🖼️ Now playing · Barcelona
**4,252 photos** · saved, comes back after a restart

`🔀 Random` `⏱️ 20 s` `🖥️ Screen on`

**What's in it**
- 💍 Honeymoon, Barcelona · 2,203
- 🎓 Exchange 2015–16 · 1,180
- 📍 Other photos taken in Barcelona · 869

> 💬 This mixes your honeymoon and your exchange, ten years apart. Just the honeymoon, or only the two of you?

*Try: "only the honeymoon" · "slower" · "smart random"*
````

**Changing a setting**

````markdown
### ⏱️ Slower · one photo every 30 s
Still **Honeymoon** · `🔀 Random` `⏱️ 30 s` · reshuffled
````

**Screen**

````markdown
### 🌙 Screen off · until 7:00 tomorrow
**Honeymoon** stays saved and shows again when the screen comes on. Say "turn it on" any time.
````
(☀️ for "Screen on".)

**What's playing?**

````markdown
### 🖼️ Playing now · Honeymoon
**11,807 photos** · `🔀 Random` `⏱️ 20 s` `🖥️ Screen on` · since 10:49 pm
````

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
- Default order: plain `random`. Smart Random (`randomsmart`, short runs of about 3 consecutive photos) only on request.
- Default seconds per photo: keep the current setting (20 s as of 2026-11-16).
- Replies use the visual format above: emoji heading, setting chips, 💬 quote for questions (owner, 2026-11-17).
- The mouse pointer is hidden on the slideshow screen (built in; nothing to do).
- "Tomorrow morning" for the screen means 07:00 (proposed default; change it if the owner says otherwise).

**When the owner asks for a different experience** ("don't tell me the counts", "default to 10 seconds"), change this section and `docs/slideshow-experience.md` in the same commit (`git-workflow`), and say what you changed.

## The private word list

When the owner explains a personal word ("home means Lusty Bonar", "my parents are Mum and Dad"), save it: GET `/api/words`, add or change the entry `{ "means": "<plain description>", "query": "<query it stands for>" }`, PUT the whole document back:
`curl -s -X PUT $API/api/words -H 'content-type: application/json' -d @words.json` (write the JSON to a temporary file first). Tell the owner what you saved. The list lives only on the Pi (`/var/lib/photo-api/words.json`), never in the repo; the API creates it from `config/words.example.json` if it is missing.

## Verify

The POST/PATCH answer has `"played":true` (or `"relaunched"`), and `GET /api/status` shows the new slideshow. If the owner says the screen looks wrong, use `pi-access` ("See what the screen shows").

## Undo

Before playing, keep the old `slideshow` from `GET /api/status`. To go back, POST its `query`, `label`, `sort` and `interval`.

## Do not

- Use SSH, Picapport's own URLs, or the Picapport web UI to control the slideshow.
- Send `*`, phrases in quotes, or words under 3 letters as if they could match.
- Edit photo metadata or "fix" tags (hard rule 1). If tags are missing or misspelt, tell the owner what you noticed.
- Ask for confirmation before playing, or reboot/restart anything to fix a slideshow problem (that is `pi-access` and `apply-changes`, with agreement).

## Links

`docs/slideshow-experience.md` (the agreed experience), `docs/image-metadata.md` (what can be found, query syntax), `docs/architecture.md` ("Photo API"), README "Controlling the Slideshow" (the same calls by hand), backlog B23, B24.

## Last verified

2026-11-17: cold-tested by the owner in fresh Paseo sessions: fast, good follow-up questions, answers exploring questions such as "where did I go in Italy?" (owner's words: "working very well"). Reply format then changed to the visual style above (not yet re-tested). 2026-11-16: every call above run against the Pi while building it.
