---
name: project-hygiene
description: Use when the owner asks for a hygiene check, a tidy-up or an audit of the repo ("is the documentation up to date?", "check for stale information", "clean up the architecture page", "tidy the backlog"), at a release, or every few weeks. Checks that docs, skills and README still match the code and the running Pi, using the documentation model in docs/overview.md, and makes targeted fixes. Read-only checks first; doc fixes are bookkeeping (no review needed); anything else goes through make-changes.
---

# Project hygiene

A periodic check that the repo still describes the current solution: every fact true, in its one master page, linked (not copied) elsewhere, and no gaps. Optional, not a gate; run it now and then, at a release, or when something feels off. It complements `scripts/check.sh` (every commit, mechanical) with judgement.

**Principles:** cheapest checks first; let the script find candidates and spend reading only where it points; fix in place with the smallest edit (a line, a row, a link), never rewrite a page to fix a sentence; when a fact is in two places, keep the master (`docs/overview.md`, "Where each kind of fact is kept") and turn the copy into a link; history is not deleted, it is moved or marked.

**Changes allowed:** doc and skill fixes are bookkeeping (`CLAUDE.md`, "Working with the owner"): make them and report. A fix that needs code, config or the Pi is not hygiene: note it and use `make-changes`. Rules, the mandate and `docs/principles.md`: only with the owner.

## 1. Mechanical pass (seconds)

```
python scripts/hygiene.py
```
(`python3` on the Pi.) It reports, read-only:
- broken relative links, and repo paths named in reference pages that do not exist (history pages are skipped; git-ignored paths are fine);
- API routes in `api/server.js` missing from `docs/architecture.md`, and `/api/...` calls named in docs that the API does not serve;
- settings in `api/lib/settings.js` missing from `docs/architecture.md`;
- scripts, units, config files and modules no doc mentions (undocumented or dead);
- pages in `docs/` missing from the overview's map; skills missing from `CLAUDE.md`; the latest release tag missing from the overview;
- each skill's "Last verified" date and whether it was cold-tested; backlog items still "doing"; placeholders (TODO, TBD, "to fill");
- **what changed since the last hygiene run**, grouped by the master page each change should have touched. This is the scope for step 2.

Deliberate exceptions are in `scripts/hygiene-allow.txt` (`file|text|reason`); add one only with a reason, and question old ones each run.

## 2. Judgement pass (targeted)

Work from the script's "changed since" list (a full pass only for the first run, or on request):

1. **For each changed area, read its master section** (not the whole page) against the code that changed: does it still say what the code does? Typical stale spots: endpoint behaviour, defaults and presets (`config/slideshow-presets.json`), file and state paths, what a service does, counts quoted as current.
2. **Duplicates:** search for the distinctive words of a changed fact (`grep -rn "<phrase>" docs README.md .claude CLAUDE.md`). Each hit outside the master: replace the copy with a link, or make it say less.
3. **Gaps:** a part, setting or procedure that exists but has no master entry; a master entry with no code behind it; a decision in the backlog or a phase page that never reached the master (for example a default the owner chose).
4. **The Pi (optional, read-only, `pi-access`):** `bash ~/pi-photo-hub/scripts/verify.sh` (drift) and that the docs' "state of the Pi" in the backlog is not older than what you saw.
5. **Skills:** a skill whose steps no longer match its script (`--help` of the script is the truth); "Last verified" older than the last change to its script; skills never cold-tested (list them for the owner; a cold test is a fresh session using the skill).
6. **Backlog:** done items still marked open, open questions answered elsewhere, "Where we are right now" out of date.

## 3. Fix and record

- One commit: `docs(hygiene): <what was fixed>`, after `bash scripts/check.sh` passes.
- Record the run in `docs/overview.md`, section "Hygiene": `Last hygiene run: <date>, commit `<short sha of HEAD before the fix>`; <n> fixes; open: <what was left>`. The next run scopes from that commit.
- Tell the owner briefly: what was fixed, what needs them (rules, decisions, cold tests), what was left for later and why (added to the backlog).

## Deep cleans (a larger tidy, on request)

For a page that has grown hard to read (for example `docs/architecture.md`, backlog B38): agree the outline with the owner in a few lines first, then move section by section in separate commits, so each diff is reviewable:
- **Current facts** stay in the reference page, shortest true form.
- **History** (how something came to be, incidents, measurements that led to a decision) moves to the backlog item it belongs to (done items keep their story) or a phase page, and the reference page keeps one line: the decision and a link to the item.
- **Old backlog "Done" items** from before the last release may move to `docs/backlog-done.md` (create it, add it to the overview's map), keeping their IDs so links still work.
- After each move: `python scripts/hygiene.py` (links and paths) and grep for the moved headings to fix links to them.

## Do not

- Rewrite a page wholesale, or reformat what is not wrong.
- Delete history, or a backlog item, without moving it.
- Change code, config, rules or the Pi as part of hygiene.
- Add an allowlist entry to silence a real finding.

## Links

`scripts/hygiene.py`, `scripts/hygiene-allow.txt`, `docs/overview.md` (the documentation model, "Hygiene"), `scripts/check.sh`, the `make-changes` skill ("Keep the project current"), `skill-authoring`.

## Last verified

2026-11-18: written with `scripts/hygiene.py`; first run found 19 items (11 path mentions, 4 routes, 3 undocumented scripts, a stale README paragraph about the saved slideshow), fixed or allowed with a reason; a planted broken link, missing path, undocumented route and undocumented script were all reported. Not yet cold-tested.

2026-11-19: second run, for `v1.1.0`; scoped from the previous run's commit as described.
