# Slideshow experience

Layer 3 of slideshow control (principle 12): what it is like to ask for photos, and what the agent does and says. This page records the **design decisions** agreed with the owner (backlog B24, phase 3). The `slideshow-control` skill (`.claude/skills/slideshow-control/SKILL.md`, built 2026-11-16) turns them into behaviour; when the owner asks for a different experience, this page and the skill change together.

Facts it builds on: what can be found ([image-metadata.md](image-metadata.md)), how the slideshow behaves ([architecture.md](architecture.md), "Picapport slideshow behaviour").

## The person using it

Someone who knows nothing about folders, tags, Picapport or query syntax, speaking naturally in Paseo (often by voice, so names may arrive misspelt). Today that is the owner, from a Paseo session; later possibly others and other clients (the planned buttons, L1).

## Agreed behaviour (owner, 2026-11-16)

1. **Act first, then talk.** A clear request is carried out straight away: no confirmation, no clarifying question before playing.
2. **Then a short, visual reply** (Markdown for the Paseo mobile app: an emoji heading, settings as small chips, the contents as a short list, questions in a 💬 quote; owner, 2026-11-17): what it understood, what is included with counts per part, **every setting in effect including the defaults the person did not mention** (order, seconds per photo, saved), and how to change any of it.
3. **Then, optionally, a friendly follow-up.** When the request matched more than one thing, the agent says so and may offer something interesting, not as a rule but as encouragement to the agent: for example "this includes Barcelona on your honeymoon and on exchange, ten years apart; want only one, or just the photos of you two?" This is the place to experiment.
4. **Nothing found: do not play.** Say so and suggest close matches.
5. **Every slideshow started is saved**, so a restart or reboot plays the last one, and since the slideshow layer (B32, 2026-11-18) it **resumes at the same photo in the same order** (no reshuffle).
6. **Change one setting without restating the slideshow:** "slow it down to one every 30 seconds", "faster", "chapters", "show the date", "skip the upright ones", "guests mode". Everything else stays (B17), and the photo on screen stays.
7. **Default order: plain random.** Chapters (short runs from one event, with its name; the old Smart Random) on request. Default preset Ambient.
11. **One slideshow, every screen a window onto it** (B32): the shelf, the phone at `http://pi.local:3000/show` (tap for controls and full screen; swipe for next and back; search, browse, settings, star or flag a photo), the TV by mirroring the phone, the button board and Paseo all steer the same slideshow, in lockstep. Paseo is for "a moment in time" requests; the phone page for live control.
12. **"What's playing?" and "where was that?"** answer with the photo's date (and how long ago), place, event and a small preview.
13. **Marking a photo** ("star this", "bad photo") only puts it on a review list for the owner's pipeline; the photo itself is never changed.
8. **Screen off and on, now and for a while:** "turn it off", "turn it off for an hour", "off until tomorrow morning", "turn it back on". A timed request is a one-off and leaves no lasting schedule. This is different from a regular daily schedule (later, L9). By default the screen is always on.
9. **Personal words.** "Us", "home", "my parents" mean specific people, places or folders. They come from a private word list (below), never guessed.
10. **No mouse pointer on the slideshow screen** (owner, 2026-11-16): hidden by default, nothing to choose.

## Where the agent's knowledge comes from

| Knowledge | Source | Status |
|---|---|---|
| Searchable words: keywords, people, folder and place names | Built from the **photos themselves** (their metadata and folder names, principle 11) by our own scan, not from Picapport's keyword list, which is incomplete (28 of 55 keywords, 2026-11-16). Served by the photo API (`GET /api/vocabulary`), rebuilt nightly | Built 2026-11-16 (B29) |
| Places | Country and city for every photo with GPS (about two thirds), from an offline place list (GeoNames) in the nightly build; in the vocabulary as `places` and played with a `places` source. Places without GPS still come from folder and keyword words; a GPS box (`within:`) still works | Built 2026-11-18 (B32) |
| Dates | The photo's own date: year, month, day words and year ranges | Proven |
| Personal words ("us", "home") | A private word list on the Pi (`/var/lib/photo-api/words.json`, `GET`/`PUT /api/words`), created from the template `config/words.example.json`; never in the public repo (owner agreed 2026-11-16) | Built 2026-11-16 |
| What is playing now, current settings | The photo API (`GET /api/status`; `GET /api/player` for the photo on screen) | Built 2026-11-16; photo details 2026-11-18 |
| What was shown, what has not been seen for a while | The photo API (`GET /api/history`, `GET /api/suggestions`), kept on the SD card | Built 2026-11-18 (B32) |

**Why a vocabulary matters:** if the agent knows the finite set of searchable words, it can map a vague request onto them. "Romantic photos of us" can become the two people plus a `sunset` tag, if such a tag exists. When the future AI tagging pipeline (L7) writes new keywords into the photos, the vocabulary grows by the next scan without changing the skill.

## Later (recorded ambitions, not designed)

- Built in the slideshow layer (B32, 2026-11-18, on the branch until the owner says "go"): the regular screen schedule (L9, off by default), history and suggestions (L10), our own slideshow page with upright handling (B31), overlays (L11) and resume without reshuffling (B26).
- **AI tagging in the ingestion pipeline** (L7): richer keywords and people, written into the photos.
- **Video** (L8). **Phone shortcut**: not needed for now, Paseo is the client; the earlier idea of a custom client app is dropped.
