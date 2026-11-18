# Pi Photo Hub: overview (start here)

The master description of **what the solution is**: its parts, how they connect, where each kind of fact is kept, and how the project grows. Kept current with every change that adds, removes or reshapes a part (the `make-changes` skill). Details live in the pages this one links to; nothing here is repeated elsewhere, and nothing elsewhere should repeat it.

Current release: **v1.0, the slideshow layer** (2026-11-18). History: "Releases" below.

## What it is

A living photo wall. The owner's photo library (an external HDD, about 63,000 JPEGs) plays as a slideshow on a 22" monitor on a living-room shelf. **One slideshow, held by the Pi; every screen is a window onto it**, and anyone can steer it from where they are: the phone, a button board in front of the shelf, or Paseo (an AI agent session) in plain words. The owner's goal statement is in [slideshow-layer.md](slideshow-layer.md), "Goal".

## The parts

| Part | Where | What it does | Details |
|---|---|---|---|
| Photo library | USB HDD on the Pi, `/mnt/photos` (read-only for the project, hard rule 1) | The photos and their own metadata, the lasting store of everything (principle 11) | [image-metadata.md](image-metadata.md), [hardware.md](hardware.md) |
| Picapport | Pi, Java, port 8080 | Indexes the photos; answers searches; resizes images. A disposable index; its own slideshow page is retired (emergency fallback only) | [architecture.md](architecture.md) "Picapport queries", [picapport-db.md](picapport-db.md) |
| Nightly scan | Pi, cron 03:30 | Reads the photos' metadata (read-only) into the vocabulary (searchable words) and the catalogue (date, upright, place, rating, people per photo); places from an offline GeoNames list | [architecture.md](architecture.md) "Vocabulary refresh" |
| Photo API | Pi, Node, port 3000 (`api/`) | Holds the one slideshow (order, position, settings), serves the page, photos and every control; the only control route (principle 12) | [architecture.md](architecture.md) "Photo API", "Slideshow layer" |
| The page `/show` | served by the API; shown by the shelf's kiosk Chromium and any browser | Shows the slideshow (motion, overlay, title cards); on a phone, the controls (search, browse, map, settings, marks) | [architecture.md](architecture.md) "The page" |
| Button board | USB keypad on the Pi; `photo-buttons` service | Back, pause, next, slower/faster, overlay style, screen | `button-board` skill, README "Button board" |
| Phone, TV | the owner's phone on the home network; the LG TV by mirroring the phone | Watch and steer; show a trip on the TV | [slideshow-experience.md](slideshow-experience.md) |
| Paseo (agent) | the owner's PC or phone, Claude Code sessions in this repo | Plain-word requests (`slideshow-control` skill); building and maintaining the project (`make-changes` and the other skills) | [CLAUDE.md](../CLAUDE.md) |
| GitHub | public repo | The source of truth; the Pi pulls from it (`scripts/update.sh`) | [principles.md](principles.md) 2, 7 |
| Owner's PC | Windows 11 | Agent sessions, SSH to the Pi, tests (`tools/browser-test`), the board's Windows tool | [network.md](network.md), README |

How they talk: viewers and controls call only the photo API; the API alone calls Picapport (`api/lib/picapport.js`); agents reach the Pi by SSH for maintenance and by the API for the slideshow; nothing on the Pi changes except through `scripts/update.sh` from GitHub.

## Where each kind of fact is kept (one master each)

Update the master; other pages link to it, they do not copy it. If you find a fact in two places, keep it in its master and replace the copy with a link.

| Kind of fact | Master |
|---|---|
| What the solution is, its parts, releases, how it grows | this page |
| Rules that always apply, the owner's working style, the skills list | [CLAUDE.md](../CLAUDE.md) |
| Why the rules exist and how they are enforced | [principles.md](principles.md) |
| Technical reference of the current system: components, paths, services, API, settings, modules, the code map, known limits | [architecture.md](architecture.md) |
| What the photos carry and what can be searched | [image-metadata.md](image-metadata.md) |
| How using the slideshow should feel (agreed with the owner) | [slideshow-experience.md](slideshow-experience.md) |
| Hardware, network | [hardware.md](hardware.md), [network.md](network.md) |
| Picapport's database: facts and repair history | [picapport-db.md](picapport-db.md) |
| Work in progress, ideas, open questions, done items with dates | [backlog.md](backlog.md) |
| How to do something (agent) | the skill in `.claude/skills/` |
| How to do something (person) | [README.md](../README.md), manual and automated forms |
| Why a phase was built the way it was (requirements, decisions, test evidence) | its phase pages, kept as history: release 1 is [slideshow-layer.md](slideshow-layer.md) and [slideshow-layer-build.md](slideshow-layer-build.md) |
| Defaults and mappings | `config/` (each file says what it is for) |
| Runtime state (what is playing, history, marks) | on the Pi only, `/var/lib/photo-api/` (principle 5) |
| Whether all of the above still agree with the code | `python scripts/hygiene.py` and the `project-hygiene` skill; record below, "Hygiene" |

## How the project grows

- **Small changes and features:** the `make-changes` skill (standing mandate, tests, deploy, docs).
- **A new phase** (a big piece such as the ingestion pipeline, L7): as release 1 was built. (1) Talk it through with the owner and write a phase page: what the owner said, the goal, requirements with IDs, decisions. (2) A build page: plan, mandate, milestones with a checklist and a build log, so any session can resume. (3) Build on a branch. (4) At the owner's "go": merge, tag a release, and **fold the lasting facts into the masters above** (this page's parts and releases, architecture, README, skills); the phase pages stay as history and say so at the top.
- **Parts outside the Pi** (for example a PC side of the ingestion pipeline) get a row in "The parts", their own section in architecture, and the same rules: code in this repo, tested, documented, no secrets.

## Keeping it true

- **Every change** updates its master pages in the same commit (the `make-changes` skill, "Keep the project current"); `scripts/check.sh` checks links and paths and warns when code changed without its usual pages.
- **Now and then, and at each release,** a hygiene run (the `project-hygiene` skill) checks the docs against the code and the Pi and fixes what drifted, in small targeted edits.

## Hygiene

Last hygiene run: 2026-11-18, commit `fc9c23e`; first run: 19 findings fixed or allowed with a reason (stale README paragraph on the saved slideshow, routes written in shorthand, undocumented dev routes and rebuild scripts); open: the deep clean of `docs/architecture.md` and the backlog's old "Done" items (backlog B38).

## Releases

| Release | Date | What |
|---|---|---|
| v1.0 | 2026-11-18 | The slideshow layer (B32): the photo API holds the one slideshow; `/show` for the shelf and the phone; resume without reshuffle; orders, presets, overlay, upright fill, motion; offline places; search, browse, map on the phone; button board service; screen schedule; history and marks. Requirements R1 to R21 and test evidence: [slideshow-layer-build.md](slideshow-layer-build.md). Before it: Picapport's own slideshow page, the photo API v2 and the maintenance work of Phase 1 (backlog "Done"). |
