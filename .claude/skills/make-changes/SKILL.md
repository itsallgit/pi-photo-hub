---
name: make-changes
description: Use when the owner asks for a new feature, a change or a fix to the project ("add a random transition", "make the settings page use drop-downs", "show something on screen when I press a button", "the phone page should...", "it does X wrong"), or says "I want to change ..." without more context. Covers finding the code, small change or feature, the owner's standing mandate, testing on the PC, deploying and checking on the Pi, docs, and reporting. Changes the repo and the Pi under the standing mandate (owner, 2026-11-18).
---

# Making changes to the project

The everyday development loop since release 1 (tag `v1.0`, 2026-11-18). The owner starts a session and says what they want; you work out the rest from the repo. This skill is the procedure; the facts are in `docs/` (start with `docs/architecture.md`, "Slideshow layer").

## Standing mandate (owner, 2026-11-18)

Replaces the per-change agreement of `CLAUDE.md` "Working with the owner" **for development work**:

- **Small change** (the look or layout of the pages, a new setting or setting value, wording, a preset, a button mapping, a new read-only or slideshow API call, a bug fix inside existing behaviour): no plan needed. Build it, test it, commit to `main`, deploy to the Pi, check it, then tell the owner what changed and what to try.
- **Feature** (a new service or unit, a new package, a new state file or a change to one's format, a change to `update.sh`, `bootstrap.sh` or anything run as root, anything that writes outside `/var/lib/photo-api/` and `/var/cache/photo-api/`, a new outside service, or work of more than about a day): first agree the objective and a short plan with the owner (a few lines, readable on a phone; `CLAUDE.md`: understand the objective before extending). Then, without asking for each step: a branch `feat/<topic>`, commits and pushes, deploys of the branch to the Pi with `update.sh --branch`, tests on the Pi. **Merge to `main` only when the owner says "go"** (the `git-workflow` skill).
- **Still needs the owner every time (unchanged):** anything that writes to the photo HDD (hard rule 1, including tags and ratings in photos), reboots and shutdowns (the `pi-power` skill), restarting or reconfiguring Picapport, `cleanup.sh`, `bootstrap.sh`, `picapport-db.sh` beyond `status`, fixing the Pi by hand, force-push, rebase, `reset --hard`, deleting branches, sending photo data or the private word list to any outside service.
- If a change turns out bigger than it looked, stop and say so before going on.

## Orient (read-only, a few minutes)

1. `CLAUDE.md` "Session start": `git status`, `git log --oneline -5`, `docs/backlog.md` (the owner's idea may already be an item with notes).
2. Where the code is: `docs/architecture.md`, "Code map". Which page owns which fact: `docs/overview.md`, "Where each kind of fact is kept".
3. Look at the Pi if it matters (`pi-access`): what is playing, a screenshot.

## Build and test on the PC

- A setting is added in four places: `api/lib/settings.js` (check), `config/slideshow-presets.json` (default, presets), where it acts (`show.js` or `order.js`/`player.js`), and the phone's settings pane (`controls.js`, `settingsPane`). Viewers get every setting in each state event, so the page needs no new route.
- Tests (all must pass before a commit):
  - `bash scripts/check.sh` (on a branch `--base origin/main`): shell, secrets, skills, the API smoke and unit tests (`api/test/smoke.js`, `unit.js`, against `api/test/fake-picapport.js`), the Python tests (`scripts/test/`). Needs `cd api && npm install` once.
  - Page changes: `cd tools/browser-test && npm install && node run.js` (headless Chrome against the fake Picapport; shelf and phone, `--only <text>` for one test). Add a test for what you built. **Look at the screenshots** in `tools/browser-test/shots/` (the Read tool) before you call it done: wrong layout shows there, not in a test.
- Keep the page plain HTML, CSS and JavaScript (no build step); only `opacity` and `transform` animate (smooth on the Pi, `docs/architecture.md` "Motion on the Pi"); no library loaded from the internet (vendor it, like Leaflet).

## Deploy and check on the Pi

1. Commit (Conventional Commits, code + docs + backlog together, hard rule 3) and push: `main` for a small change, the branch for a feature.
2. `update.sh` (the `apply-changes` skill; its agreement gate is covered by this mandate): dry run, then the real run, `--branch feat/<topic>` for a feature. It restarts the app; the slideshow resumes where it was.
3. Check: `node api/test/pi-check.js` (API, lockstep, images; puts back what it changes), `cd tools/browser-test && node run.js --pi http://pi.local:3000` (a second viewer and a phone viewer against the real Pi), a screenshot of the shelf (`pi-access`), `verify.sh` for anything installed.
4. Leave the shelf playing what the owner had (note `GET /api/player` `source` and `settings` before you start; put them back if you changed them).

## Keep the project current (same commit as the change, hard rule 3)

Each fact has one master page (`docs/overview.md`, "Where each kind of fact is kept"); update the master, link from elsewhere, never copy. Go down this list for every change and update what applies:

| If the change... | Update |
|---|---|
| adds, removes or reshapes a part (a service, a page, a device, something on the PC) | `docs/overview.md` "The parts"; `docs/architecture.md` (components table, its own section); `docs/hardware.md` for a device |
| adds or changes an API call, a setting, a preset, a module, a file path or state file | `docs/architecture.md` (endpoint table, settings list, module table, code map, state files); `config/` file comments |
| changes something a person would do by hand (install, check, control, recover) | `README.md`, manual and automated forms |
| lets Paseo do something new, or changes a call it uses | the `slideshow-control` skill (and `docs/slideshow-experience.md` if the agreed experience changes) |
| touches the buttons | `config/buttons.json` `_about`, the `button-board` skill, README "Button board" |
| changes a procedure that has a skill (update, power, database, access) | that skill (and its "Last verified") |
| changes a rule, the mandate or the working style | `CLAUDE.md` and `docs/principles.md`: **only with the owner** |
| finishes, starts or discovers work | `docs/backlog.md`: tick the item with the date and commit, add new items or open questions (hard rule 4) |
| adds a test, a tool or a code area | `docs/architecture.md` "Code map" |
| adds a skill | the `skill-authoring` skill's method; the skills table in `CLAUDE.md` |

`bash scripts/check.sh` warns when code changed without the docs it usually needs; treat a warning as a question to answer, not noise. If you notice any page or skill that is wrong or stale while working, fix it in the same session (or add a backlog item), even if it is not part of the change.

## Releases

When the owner calls something a release (or a phase is merged on their "go"): run the `project-hygiene` skill first, then an annotated tag on `main` (`git tag -a vX.Y -m "..."`, `git push origin vX.Y`), a row in `docs/overview.md` "Releases", the backlog's "Where we are" updated. A phase's own pages (requirements, build plan) are marked as history at the top, and their lasting facts folded into the masters (`docs/overview.md`, "How the project grows").

## Report

- Tell the owner in a few lines: what changed, where to see it ("tap ⚙ on the phone"), anything they should decide, how to undo (`update.sh --ref <previous commit>`, the `apply-changes` skill).

## Undo

A bad change on `main`: revert the commit (`git revert`, never `reset`), push, `update.sh`. Release 1 is tag `v1.0`: `update.sh --ref v1.0` puts the Pi back on it (detached) while you fix `main`.

## Do not

- Write to photos to "tag" them, or call a feature done that needs it (hard rule 1; manual tagging needs the owner's decision first, backlog).
- Talk to Picapport from the page or the phone (viewers only call the photo API, principle 12).
- Skip the screenshot review for a visual change, or deploy without the tests passing.
- Grow a small change into a feature without saying so.

## Links

`CLAUDE.md`, `docs/architecture.md` ("Slideshow layer"), `docs/slideshow-layer.md` (what the owner wants and why), `docs/slideshow-layer-build.md` (how v1 was built and tested), skills `git-workflow`, `apply-changes`, `pi-access`, `slideshow-control`, `button-board`.

## Last verified

2026-11-18: written at release 1 from the procedure used to build it (every step was used during the build). Not yet cold-tested: the first new session with a feature request is the test.
