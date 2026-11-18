#!/bin/bash
# check.sh - pre-commit checks for this repo, run by hand or by an agent (no git hooks, owner's
# preference; backlog B13). Read-only. Runs in Git Bash on the owner's PC and on the Pi.
#
#   bash scripts/check.sh               check the working tree (docs-sync: changes against HEAD)
#   bash scripts/check.sh --base REF    docs-sync against REF instead (e.g. --base origin/main for a branch)
#
# Checks: shell syntax of every script (and shellcheck if installed); committed shell scripts have
# LF line endings and the executable bit; no private keys, tokens, passwords or full MAC addresses
# in tracked or changed files; every skill has a valid header and is listed in CLAUDE.md; the
# photo API smoke test (if node and api/node_modules are present); the Python tests in scripts/test;
# docs-sync: a changed script,
# unit, config or API file without any change to README.md, docs/ or a skill is reported (a
# reminder of hard rule 3, not proof), plus finer pairs (API without architecture.md, a unit without the
# parts pages, buttons without their skill or runbook). Exit 1 if any FAIL; WARN does not fail.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
BASE=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?--base needs a ref}"; shift ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
fails=0; warns=0
ok()   { echo "OK    $*"; }
warn() { echo "WARN  $*"; warns=$((warns + 1)); }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }

# --- shell syntax ----------------------------------------------------------------------------
shells="$(git ls-files -co --exclude-standard -- '*.sh' 'bootstrap.sh' 'cleanup.sh' | sort -u)"
bad=0
for f in $shells; do
  [ -f "$f" ] || continue
  if ! tr -d '\r' < "$f" | bash -n 2>/tmp/check-sh.$$; then fail "syntax: $f: $(head -1 /tmp/check-sh.$$)"; bad=1; fi
done
if ! tr -d '\r' < initd/picapport | sh -n 2>/dev/null; then fail "syntax: initd/picapport"; bad=1; fi
rm -f /tmp/check-sh.$$
[ "$bad" = 0 ] && ok "shell syntax ($(echo "$shells" | wc -w) scripts + initd/picapport)"
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -S error $shells >/tmp/check-sc.$$ 2>&1; then ok "shellcheck (errors only)"; else fail "shellcheck: $(grep -c '^In ' /tmp/check-sc.$$) finding(s); run: shellcheck -S error <file>"; fi
  rm -f /tmp/check-sc.$$
else
  echo "SKIP  shellcheck (not installed)"
fi

# --- line endings and executable bits (what the Pi gets from git) ---------------------------------
crlf="$(git ls-files --eol -- '*.sh' 'initd/*' 'systemd/*' 'config/*' | awk '$1 != "i/lf" && $1 != "i/none" {print $NF}')"
if [ -z "$crlf" ]; then ok "LF line endings in git for scripts, units and config"; else fail "not LF in git (bash on the Pi breaks on CR): $crlf"; fi
noexec="$(git ls-files -s -- ':(glob)scripts/*.sh' ':(glob)scripts/lib/apply-*.sh' bootstrap.sh cleanup.sh | awk '$1 != "100755" {print $4}')"
new_noexec=""
for f in $(git ls-files -o --exclude-standard -- ':(glob)scripts/*.sh' ':(glob)scripts/lib/apply-*.sh'); do new_noexec="$new_noexec $f(new: git update-index --chmod=+x after add)"; done
if [ -z "$noexec" ]; then ok "executable bit in git for scripts run directly"; else fail "missing executable bit in git (git update-index --chmod=+x): $noexec"; fi
[ -z "$new_noexec" ] || warn "untracked scripts:$new_noexec"

# --- secrets and identifying data (principle 7) ---------------------------------------------------
pat='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|(password|passwd|secret|token)[[:space:]]*[=:][[:space:]]*[^[:space:]<$({]{6,}|([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}'
hits="$(git ls-files -co --exclude-standard | grep -v -e '^api/node_modules/' -e 'package-lock.json$' -e '^orientdb/' -e '^picapport/' -e '^scripts/check.sh$' \
  | while read -r f; do [ -f "$f" ] && grep -IEn -- "$pat" "$f" 2>/dev/null | sed "s#^#$f:#"; done | cut -c1-160)"
if [ -z "$hits" ]; then ok "no keys, tokens, passwords or full MAC addresses found"; else fail "possible secret or identifying data (check each; the repo is public):"; echo "$hits" | sed 's/^/        /'; fi

# --- skills ---------------------------------------------------------------------------------------
bad=0
for d in .claude/skills/*/; do
  n="$(basename "$d")"; f="$d/SKILL.md"
  [ -f "$f" ] || { fail "skill $n: no SKILL.md"; bad=1; continue; }
  head -1 "$f" | tr -d '\r' | grep -qx -- '---' || { fail "skill $n: SKILL.md does not start with a --- header"; bad=1; }
  grep -q "^name: $n\b" "$f" || { fail "skill $n: header name is not '$n'"; bad=1; }
  grep -q '^description: .\{40,\}' "$f" || { fail "skill $n: missing or very short description"; bad=1; }
  grep -q "^| \`$n\` |" CLAUDE.md || { fail "skill $n: not in the skills table in CLAUDE.md"; bad=1; }
  grep -qi '^## Last verified' "$f" || { warn "skill $n: no 'Last verified' section"; }
done
[ "$bad" = 0 ] && ok "skills: headers and CLAUDE.md table ($(ls -d .claude/skills/*/ | wc -l) skills)"

# --- photo API smoke test ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -d api/node_modules ]; then
  if node api/test/smoke.js >/tmp/check-api.$$ 2>&1; then ok "photo API smoke test ($(grep -c . /tmp/check-api.$$) lines of output)"; else fail "photo API smoke test: $(tail -3 /tmp/check-api.$$ | tr '\n' ' ')"; fi
  rm -f /tmp/check-api.$$
else
  echo "SKIP  photo API smoke test (needs node and api/node_modules: cd api && npm install)"
fi

# --- Python tests (scripts/test: vocabulary, catalogue, places) ---------------------------------------
py=""
for c in python3 python; do if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 7))' 2>/dev/null; then py="$c"; break; fi; done
if [ -n "$py" ]; then
  if "$py" -m unittest discover -s scripts/test >/tmp/check-py.$$ 2>&1; then ok "Python tests ($(grep -o 'Ran [0-9]* tests' /tmp/check-py.$$))"; else fail "Python tests: $(tail -3 /tmp/check-py.$$ | tr '\n' ' ')"; fi
  rm -f /tmp/check-py.$$
else
  echo "SKIP  Python tests (no python3)"
fi

# --- links and paths in the docs (scripts/hygiene.py --quick; the full check is the project-hygiene skill) ---
if [ -n "$py" ]; then
  hq="$("$py" scripts/hygiene.py --quick 2>&1 | grep '^FIND' || true)"
  if [ -z "$hq" ]; then ok "docs: links and repo paths resolve"; else warn "docs: $(echo "$hq" | wc -l) broken link(s) or missing path(s):"; echo "$hq" | sed 's/^/        /'; fi
fi

# --- docs-sync (hard rule 3) ------------------------------------------------------------------------
changed="$( { git diff --name-only "$BASE" 2>/dev/null; git ls-files -o --exclude-standard; } | sort -u | grep -v 'package-lock.json$')"
code="$(echo "$changed" | grep -E '^(scripts/|systemd/|initd/|config/|api/|bootstrap.sh|cleanup.sh)' || true)"
docs="$(echo "$changed" | grep -E '^(README.md|docs/|\.claude/skills/|CLAUDE.md)' || true)"
if [ -z "$changed" ]; then ok "docs-sync: nothing changed against $BASE"
elif [ -n "$code" ] && [ -z "$docs" ]; then warn "docs-sync: code/config changed against $BASE but no README, docs/ or skill change (hard rule 3): $(echo $code)"
elif [ -n "$code" ] && ! echo "$changed" | grep -qx 'docs/backlog.md'; then warn "docs-sync: code changed but docs/backlog.md did not"
else ok "docs-sync: $(echo "$changed" | wc -l) changed file(s) against $BASE, docs included"; fi
# Finer pairs: an area of code and the page or skill that is its master (docs/overview.md, "Where
# each kind of fact is kept"). A reminder to answer, not proof (the make-changes skill's checklist).
pair() { # pair <code pattern> <doc pattern> <what to update>
  if echo "$changed" | grep -qE "$1" && ! echo "$changed" | grep -qE "$2"; then warn "docs-sync: $(echo "$changed" | grep -E "$1" | head -3 | tr '
' ' ')changed but not $3"; fi
}
if [ -n "$changed" ]; then
  pair '^api/(server\.js|lib/)|^config/slideshow-presets\.json' '^docs/architecture\.md' 'docs/architecture.md (API, settings, modules)'
  pair '^systemd/|^scripts/lib/apply-|^bootstrap\.sh' '^docs/(architecture|overview)\.md' 'docs/architecture.md or overview.md (parts, services)'
  pair '^scripts/photo-buttons\.py|^config/buttons\.json' '^\.claude/skills/button-board/|^README\.md' 'the button-board skill or README "Button board"'
  pair '^api/server\.js' '^\.claude/skills/slideshow-control/|^docs/architecture\.md' 'the slideshow-control skill (if Paseo can do something new)'
fi

echo "----"
echo "$fails FAIL, $warns WARN"
[ "$fails" = 0 ]
