---
name: git-workflow
description: Use when committing, branching, pushing, merging to main, or testing a change on the Pi before it reaches main. Covers commit format, when to branch, the test-then-fast-forward merge, and the checks to run before pushing to this public repo. Changes the repo and GitHub.
---

# Git workflow

The owner is the only maintainer, so this is kept simple. No git hooks. `main` is what a fresh Pi builds, and the Pi pulls from GitHub, so a change reaches the Pi only after it is pushed.

## Every commit

- **Format:** Conventional Commits, `<type>(<scope>): <description>`. Types: `feat fix chore docs refactor test ci`. No `Co-Authored-By` lines and no AI attribution.
- **One logical change per commit, including its docs.** Script change, its skill, its README runbook, the relevant `docs/` page and `docs/backlog.md` go in the same commit (hard rule 3).
- **Before you commit**, check the public-repo rules (principle 7): no passwords, keys or tokens; no full MAC addresses; nothing that identifies the owner's network beyond what is needed. `git diff --staged` and read it.
- Git on this Windows PC warns "LF will be replaced by CRLF". That is normal (`core.autocrlf`); the repository stores LF, which the Pi needs.

## Default: straight to `main`

For documentation, skills, the backlog and other low-risk changes: commit on `main`, then push (`git push origin main`).

## When to use a branch

Use a short-lived `feat/<topic>` or `fix/<topic>` branch for code that could break a fresh build or the running Pi: `bootstrap.sh`, systemd units, `scripts/mount-hdd.sh`, update scripts, the API.

1. `git switch -c feat/<topic>`
2. Commit as above. `git push -u origin feat/<topic>` so the Pi and any other clone can see it.
3. **Test it on the Pi.** Use the `apply-changes` skill with the branch name once it exists (backlog B06); until then agree a plan with the owner first. Changes to the Pi follow "Working with the owner".
4. When it works: `git switch main`, `git pull --ff-only`, `git merge --ff-only feat/<topic>`, `git push origin main`.
5. If `--ff-only` fails because `main` has moved: `git switch feat/<topic>`, `git merge main`, retest on the Pi, then repeat step 4.
6. Ask the owner before deleting the branch (deleting branches needs explicit instruction).

This repo-level rule (no pull request needed, fast-forward merge) overrides the global "use PRs for main" rule by the owner's decision. The global rule may still make a session ask first; that is fine.

## Do not

- Force-push, rebase, `git reset --hard`, `git clean`, or skip checks (`--no-verify`) without the owner's explicit instruction.
- Run any of those, or `git checkout`/`stash`, on the Pi's checkout: it is known to be dirty (backlog B06) and is changed only through the agreed apply path.
- Commit a script that has never been run and describe it as working. Say it is untested (the health logger is an example, backlog B03).
- Push work in progress to `main`. Use a branch.

## Links

`CLAUDE.md` (commit format, hard rules), `docs/principles.md`, `docs/backlog.md` (B06, B11).

## Last verified

Written 2026-11-15 from the Git standard previously in `CLAUDE.md`; not yet cold-tested.
