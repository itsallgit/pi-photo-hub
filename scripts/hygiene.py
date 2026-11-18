#!/usr/bin/env python3
"""hygiene.py - read-only consistency checks of the repo's docs, skills and code (the
project-hygiene skill). Runs on the PC or the Pi, from anywhere in the repo, in a few seconds.

    python scripts/hygiene.py            all checks, a report
    python scripts/hygiene.py --quick    links and file paths only (scripts/check.sh runs this)
    python scripts/hygiene.py --since REF   also list what changed since REF, by master page
                                            (default: the commit of the last hygiene run, from
                                            docs/overview.md "Hygiene")

Lines: OK (fine), FIND (worth a look; may be fine), plus INFO. It never changes a file. Exit 0
unless --strict is given and something was found. The judgement (is the page still true?) is
the agent's: see the project-hygiene skill. Mechanical facts only here.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.chdir(ROOT)
args = sys.argv[1:]
QUICK = "--quick" in args
STRICT = "--strict" in args
finds = 0


def say(kind, msg):
    global finds
    if kind == "FIND":
        finds += 1
    print(f"{kind:5} {msg}")


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True, encoding="utf-8").stdout


TRACKED = set(git("ls-files").split("\n")) | set(git("ls-files", "-o", "--exclude-standard").split("\n"))
TRACKED.discard("")
DIRS = {os.path.dirname(f) for f in TRACKED}
for d in list(DIRS):
    while d:
        DIRS.add(d)
        d = os.path.dirname(d)
SKIP = ("api/node_modules/", "tools/browser-test/node_modules/", "api/public/vendor/")
DOCS = sorted(f for f in TRACKED if f.endswith(".md") and not f.startswith(SKIP))


def read(f):
    with open(f, encoding="utf-8", errors="replace") as fh:
        return fh.read()


TEXT = {f: read(f) for f in DOCS}
ALLDOCS = "\n".join(TEXT.values())


def exists(path):
    path = path.rstrip("/")
    return path in TRACKED or path in DIRS


def ignored(path):
    """Paths git ignores on purpose (node_modules, lock files, screenshots): naming them is fine."""
    return subprocess.run(["git", "check-ignore", "-q", path], capture_output=True).returncode == 0


# History pages describe the past and may name what no longer exists; reference pages may not.
HISTORY = ("docs/backlog.md", "docs/slideshow-layer.md", "docs/slideshow-layer-build.md")

# Deliberate mentions, reviewed: "<file>|<text>|<reason>" per line in scripts/hygiene-allow.txt.
ALLOW = []
if os.path.exists("scripts/hygiene-allow.txt"):
    for line in read("scripts/hygiene-allow.txt").splitlines():
        if line.strip() and not line.startswith("#"):
            parts = line.split("|")
            if len(parts) >= 2:
                ALLOW.append((parts[0].strip(), parts[1].strip()))


def allowed(f, text):
    return any((a == f or a == "*") and b == text for a, b in ALLOW)


# ---------------------------------------------------------------------------------------------
# 1. Links and paths in the docs
# ---------------------------------------------------------------------------------------------
def check_links():
    bad = 0
    for f, t in TEXT.items():
        base = os.path.dirname(f)
        for m in re.finditer(r"\]\(([^)\s]+)\)", t):
            target = m.group(1).split("#")[0]
            if not target or re.match(r"^[a-z]+:", target):
                continue
            p = os.path.normpath(os.path.join(base, target)).replace("\\", "/")
            if not exists(p) and not allowed(f, target):
                bad += 1
                say("FIND", f"{f}: link to missing {target}")
    if not bad:
        say("OK", f"links: every relative link in {len(TEXT)} Markdown files resolves")


PATH_RE = re.compile(r"`((?:api|scripts|config|docs|systemd|initd|tools|\.claude|orientdb|picapport)/[A-Za-z0-9_./-]*[A-Za-z0-9_/])`")


def check_paths():
    bad = 0
    for f, t in TEXT.items():
        if f in HISTORY:
            continue
        for m in PATH_RE.finditer(t):
            p = m.group(1)
            if not exists(p) and not ignored(p) and not allowed(f, p):
                bad += 1
                say("FIND", f"{f}: names `{p}`, which is not in the repo")
    if not bad:
        say("OK", "paths: every repo path named in backticks exists")


# ---------------------------------------------------------------------------------------------
# 2. Code against its master pages
# ---------------------------------------------------------------------------------------------
def routes():
    src = read("api/server.js")
    out = {m.group(2) for m in re.finditer(r"app\.(get|post|patch|put|delete|use)\(\s*\"(/api/[^\"]*)\"", src)}
    dev = read("api/lib/dev.js")
    out |= {"/api/dev" + m.group(2) for m in re.finditer(r"r\.(get|post)\(\s*\"(/[^\"]*)\"", dev)}
    return sorted(out)


def norm(p):
    return re.sub(r"/:[a-z]+", "/<id>", p)


def check_api():
    arch = TEXT.get("docs/architecture.md", "")
    rs = routes()
    missing = [r for r in rs if norm(r).split("/<id>")[0] not in arch]
    for r in missing:
        say("FIND", f"route {r} (api/server.js) is not in docs/architecture.md")
    if not missing:
        say("OK", f"API: all {len(rs)} routes in api/server.js are in docs/architecture.md")
    known = {norm(r) for r in rs}
    prefixes = {k.split("/<id>")[0] for k in known}
    ghost = set()
    for f, t in TEXT.items():
        if f.startswith("docs/slideshow-layer") or f == "docs/backlog.md":
            continue  # history pages and the backlog may name old calls
        for m in re.finditer(r"(?<![\w./-])(/api/[a-z][a-z/-]*[a-z])(?![\w.])", t):
            p = m.group(1)
            if p not in prefixes and not any(k.startswith(p + "/") for k in prefixes) and not any(p.startswith(k + "/") for k in prefixes):
                ghost.add((f, p))
    for f, p in sorted(ghost):
        say("FIND", f"{f}: names {p}, which api/server.js does not serve")


def check_settings():
    arch = TEXT.get("docs/architecture.md", "")
    src = read("api/lib/settings.js")
    keys = set(re.findall(r"^\s+(\w+): \[", src.split("const BOOLS")[0], re.M))
    keys |= set(re.findall(r"\"(\w+)\"", re.search(r"const BOOLS = \[(.*?)\]", src).group(1)))
    keys |= set(re.findall(r"k === \"(\w+)\"", src))
    keys.discard("preset")
    missing = sorted(k for k in keys if f"`{k}`" not in arch)
    for k in missing:
        say("FIND", f"setting `{k}` (api/lib/settings.js) is not in docs/architecture.md")
    if not missing:
        say("OK", f"settings: all {len(keys)} settings are in docs/architecture.md")


def check_inventory():
    groups = [f for f in TRACKED if not f.startswith(SKIP) and (
        re.match(r"scripts/[^/]+\.(sh|py|ps1|template)$", f) or re.match(r"scripts/lib/[^/]+\.sh$", f)
        or f.startswith(("systemd/", "config/", "initd/")) or re.match(r"api/lib/[^/]+\.js$", f)
        or re.match(r"api/public/[^/]+\.(js|html)$", f) or re.match(r"tools/[^/]+/[^/]+\.js$", f)
        or re.match(r"api/test/[^/]+\.js$", f))]
    orphans = sorted(f for f in groups if f not in ALLDOCS and os.path.basename(f) not in ALLDOCS and not allowed("*", f))
    for f in orphans:
        say("FIND", f"{f} is not mentioned in any doc, README or skill (undocumented, or dead?)")
    if not orphans:
        say("OK", f"inventory: all {len(groups)} scripts, units, config files and modules are mentioned somewhere")


# ---------------------------------------------------------------------------------------------
# 3. The documentation model itself
# ---------------------------------------------------------------------------------------------
def check_model():
    ov = TEXT.get("docs/overview.md")
    if ov is None:
        say("FIND", "docs/overview.md is missing (the start page and the map of master pages)")
        return
    pages = [f for f in DOCS if f.startswith("docs/") and f != "docs/overview.md"]
    unmapped = [f for f in pages if os.path.basename(f) not in ov]
    for f in unmapped:
        say("FIND", f"{f} is not in docs/overview.md's map of master pages (who owns it?)")
    if not unmapped:
        say("OK", f"model: every page in docs/ ({len(pages)}) is in the overview's map")
    claude = read("CLAUDE.md")
    skills = sorted(d for d in os.listdir(".claude/skills") if os.path.isfile(f".claude/skills/{d}/SKILL.md"))
    for s in skills:
        if f"`{s}`" not in claude:
            say("FIND", f"skill {s} is not in CLAUDE.md's skills table")
    tags = [t for t in git("tag", "--sort=-creatordate").split("\n") if t]
    if tags and tags[0] not in ov:
        say("FIND", f"the latest release tag {tags[0]} is not in docs/overview.md 'Releases'")
    elif tags:
        say("OK", f"releases: {tags[0]} is in the overview")
    for s in skills:
        t = read(f".claude/skills/{s}/SKILL.md")
        m = re.search(r"## Last verified\s+(.+)", t)
        line = m.group(1).strip() if m else ""
        date = re.search(r"\d{4}-\d{2}-\d{2}", line)
        cold = "cold-test" in line.lower() or "cold test" in line.lower()
        not_cold = re.search(r"not (yet )?cold-tested|not cold-tested", line.lower())
        say("INFO" if date else "FIND", f"skill {s}: last verified {date.group(0) if date else 'never recorded'}"
            + ("; not cold-tested" if (not_cold or not cold) else "; cold-tested"))
    bl = TEXT.get("docs/backlog.md", "")
    for m in re.finditer(r"^\| (B\d+|L\d+) \| ([^|]{0,70})[^|]*\| (doing[^|]{0,60})", bl, re.M):
        say("INFO", f"backlog {m.group(1)} still 'doing': {m.group(2).strip()}... ({m.group(3).strip()})")
    markers = []
    for f, t in TEXT.items():
        for m in re.finditer(r"_to fill_|\bTODO\b|\bTBD\b|\bFIXME\b", t):
            markers.append(f)
    for f in sorted(set(markers)):
        if not allowed(f, "placeholder"):
            say("FIND", f"{f}: has a placeholder (TODO, TBD, to fill)")


# ---------------------------------------------------------------------------------------------
# 4. What changed since the last hygiene run, by the page that is its master
# ---------------------------------------------------------------------------------------------
AREAS = [
    (r"^api/(server\.js|lib/)|^config/slideshow-presets\.json", "docs/architecture.md (API, settings, modules); slideshow-control skill if Paseo is affected"),
    (r"^api/public/", "docs/architecture.md 'The page'; README phone section"),
    (r"^systemd/|^bootstrap\.sh|^scripts/lib/apply-|^scripts/update\.sh", "docs/overview.md parts; docs/architecture.md components, update; apply-changes skill"),
    (r"^scripts/photo-buttons\.py|^config/buttons\.json", "button-board skill; README 'Button board'"),
    (r"^scripts/(metadata-survey|refresh-vocabulary|build-vocabulary|places|fetch-places)", "docs/architecture.md 'Vocabulary refresh'; docs/image-metadata.md"),
    (r"^scripts/picapport-db|^initd/", "docs/picapport-db.md; picapport-db skill"),
    (r"^scripts/pi-power", "pi-power skill; docs/architecture.md 'Power'"),
    (r"^\.claude/skills/", "CLAUDE.md skills table"),
]


def check_since():
    ref = None
    if "--since" in args:
        ref = args[args.index("--since") + 1]
    else:
        m = re.search(r"Last hygiene run:.*?commit `([0-9a-f]{7,40})`", TEXT.get("docs/overview.md", ""))
        ref = m.group(1) if m else None
    if not ref:
        say("INFO", "no previous hygiene run recorded in docs/overview.md: review everything (a full run)")
        return
    files = [f for f in git("diff", "--name-only", f"{ref}..HEAD").split("\n") if f]
    commits = [c for c in git("log", "--oneline", f"{ref}..HEAD").split("\n") if c]
    say("INFO", f"since the last hygiene run ({ref}): {len(commits)} commits, {len(files)} files changed")
    for pat, master in AREAS:
        hit = [f for f in files if re.search(pat, f)]
        if hit:
            say("INFO", f"  changed {', '.join(hit[:4])}{' ...' if len(hit) > 4 else ''} -> check {master}")


def main():
    print("== links and paths")
    check_links()
    check_paths()
    if QUICK:
        sys.exit(1 if STRICT and finds else 0)
    print("== code against the docs")
    check_api()
    check_settings()
    check_inventory()
    print("== the documentation model")
    check_model()
    print("== what changed since the last hygiene run")
    check_since()
    print(f"---- {finds} FIND")
    sys.exit(1 if STRICT and finds else 0)


if __name__ == "__main__":
    main()
