---
name: skill-authoring
description: Use when creating a new skill, changing an existing skill, or deciding whether something belongs in CLAUDE.md, a skill, docs/ or the README. Holds the project's skill template, the build-and-test method, and the checklist that keeps skills, scripts, runbooks and the backlog in step.
---

# Writing skills for this project

The project's aim is a set of skills that lets an agent do everything the project needs, safely, from a cold start. Skills only work if they are consistent, tested and kept current. This skill is how.

## Where things live

| Kind of content | Goes in | Why |
|---|---|---|
| Rules that must always apply (HDD is never modified, build the project not the instance, docs move with code, do not assume, working style) | `CLAUDE.md` | A rule must always be loaded. Skills load only when a task matches. |
| How to do something (decision points, checks, steps, undo) | a skill in `.claude/skills/<name>/SKILL.md` | Loaded when needed; one place to maintain. |
| The actual work, repeatably | a script in `scripts/` (idempotent, `--dry-run`, clear output) | Deterministic. The script is the source of truth for the steps. |
| Facts: paths, ports, network, hardware | `docs/` | Reference, not procedure. |
| The same procedure for a human, with manual and automated steps | `README.md` | Skills and the README point at the script; they do not each copy it. |
| What is in progress, planned, unknown | `docs/backlog.md` | One list. |

If you find numbered steps or commands in `CLAUDE.md`, they belong in a skill.

## Skill shape

```
---
name: <lowercase-hyphenated, verb or noun, e.g. apply-changes>
description: Use when <situation, in words the owner would say from a phone>. <one sentence on what it covers>. <read-only | changes the Pi, with an agreement gate>.
---
```

Then, in this order:
1. **What it is for and whether it is read-only.**
2. **Preconditions** and which hard rules apply (link `CLAUDE.md`, do not restate them).
3. **Steps.** Read-only checks first. Put an **agreement gate** before anything that changes the Pi: say what will change, why, the risk and how to undo it, then wait for the owner. For long command sequences, call the script and describe its flags; do not paste the script's logic.
4. **Verify**: what to look at to confirm it worked.
5. **Undo**: how to get back.
6. **Do not**: the specific mistakes to avoid.
7. **Links** to the script, the README runbook and the relevant `docs/` page.
8. **Last verified**: date, and how (for example "cold test in a fresh Paseo session, 2026-11-20").

Keep it short. A skill that a session cannot skim in a minute is too long; move reference facts to `docs/`.

## Method for each new skill

1. **Agree the objective with the owner first.** What are they trying to achieve? Do not start building from a title.
2. **Build the script** (or confirm the procedure) first. If it could break a fresh build or the running Pi, use a `feat/<topic>` branch (see the `git-workflow` skill). Test it on the Pi step by step with the owner present.
3. **Write the skill, the README runbook (manual and automated), the docs and the backlog together**, in one commit.
4. **Cold test.** Open a fresh Paseo session on this project with no hints and ask for the task in the owner's words. Pass means: it finds and follows the skill, asks for agreement before changing the Pi, stays inside the hard rules, and finishes or stops safely. Fix the skill (not the prompt) if it fails.
5. **Record "Last verified"**, update the skills table in `CLAUDE.md` and the backlog, then merge.

## Keeping skills current

- Changing a script changes its skill, runbook and backlog entry in the same commit (hard rule 3).
- If you notice a skill is wrong or stale while using it, fix it or add it to the backlog. Do not work around it silently.
- Add each new skill to the skills table in `CLAUDE.md`.
- A skill holds procedure, not facts: code maps, paths, endpoint lists and settings live in their master page (`docs/overview.md`, "Where each kind of fact is kept") and the skill links to them, so a change updates one place. The upkeep checklist for any change is in the `make-changes` skill, "Keep the project current".

## Do not

- Put rules in a skill, or procedures in `CLAUDE.md`.
- Write a skill for a procedure that has not been tested.
- Duplicate a script's logic, a fact from `docs/`, or a README runbook inside a skill.
- Weaken a hard rule inside a skill.

## Last verified

Written 2026-11-15; not yet used to author a skill.
