# Slideshow experience

Layer 3 of slideshow control (principle 12): what it is like to ask for photos, and what the agent does and says. This page records the **design decisions** agreed with the owner (backlog B24, phase 3). The `slideshow-control` skill (phase 5) turns them into behaviour; when the owner asks for a different experience, this page and the skill change together.

Facts it builds on: what can be found ([image-metadata.md](image-metadata.md)), how the slideshow behaves ([architecture.md](architecture.md), "Picapport slideshow behaviour").

## The person using it

Someone who knows nothing about folders, tags, Picapport or query syntax, speaking naturally in Paseo (often by voice, so names may arrive misspelt). Today that is the owner, from a Paseo session; later possibly others and other clients (the planned buttons, L1).

## Agreed behaviour (owner, 2026-11-16)

1. **Act first, then talk.** A clear request is carried out straight away: no confirmation, no clarifying question before playing.
2. **Then a short reply** (Markdown that reads well in the Paseo mobile app): what it understood, what is included with counts per part, **every setting in effect including the defaults the person did not mention** (order, seconds per photo, saved), and how to change any of it.
3. **Then, optionally, a friendly follow-up.** When the request matched more than one thing, the agent says so and may offer something interesting, not as a rule but as encouragement to the agent: for example "this includes Barcelona on your honeymoon and on exchange, ten years apart; want only one, or just the photos of you two?" This is the place to experiment.
4. **Nothing found: do not play.** Say so and suggest close matches.
5. **Every slideshow started is saved**, so a restart or reboot plays the last one.
6. **Change one setting without restating the slideshow:** "slow it down to one every 30 seconds", "faster", "smart random". Everything else stays (B17).
7. **Default order: plain random.** Smart Random (short runs of about three consecutive photos) is available on request.
8. **Screen off and on, now and for a while:** "turn it off", "turn it off for an hour", "off until tomorrow morning", "turn it back on". A timed request is a one-off and leaves no lasting schedule. This is different from a regular daily schedule (later, L9). By default the screen is always on.
9. **Personal words.** "Us", "home", "my parents" mean specific people, places or folders. They come from a private word list (below), never guessed.

## Where the agent's knowledge comes from

| Knowledge | Source | Status |
|---|---|---|
| Searchable words: keywords, people, folder and place names | Built from the **photos themselves** (their metadata and folder names, principle 11) by our own scan, not from Picapport's keyword list, which is incomplete (28 of 55 keywords, 2026-11-16). Served to the agent by the photo API, so any client can use it | To design (phase 4, B29) |
| Places | The agent's own knowledge turns a place into a GPS box (`within:`), combined with folder and keyword words, because only about two thirds of photos have GPS | Proven query; skill to build |
| Dates | The photo's own date: year, month, day words and year ranges | Proven |
| Personal words ("us", "home") | A private word list, not in the public repo | Location to agree (phase 4) |
| What is playing now, current settings | The photo API | To design (phase 4) |

**Why a vocabulary matters:** if the agent knows the finite set of searchable words, it can map a vague request onto them. "Romantic photos of us" can become the two people plus a `sunset` tag, if such a tag exists. When the future AI tagging pipeline (L7) writes new keywords into the photos, the vocabulary grows by the next scan without changing the skill.

## Later (recorded ambitions, not designed)

- **Regular screen schedule** (L9): a routine off/on period, part of the repo with defaults, changeable; default always on.
- **History and suggestions** (L10): "what can you show us?" with suggestions from past slideshows.
- **Overlays on the slideshow** (L11): show the current photo's date, country or city on screen, toggled or chosen by the person; needs an extension of Picapport's slideshow page (or its replacement, L3).
- **AI tagging in the ingestion pipeline** (L7): richer keywords and people, written into the photos.
- **Video** (L8). **Phone shortcut**: not needed for now, Paseo is the client; the earlier idea of a custom client app is dropped.
