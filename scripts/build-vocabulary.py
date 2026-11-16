#!/usr/bin/env python3
"""build-vocabulary.py - turn a metadata survey (scripts/metadata-survey.sh scan) into the slideshow
vocabulary: the searchable keywords, people and folders, with photo counts (backlog B29).

    build-vocabulary.py SURVEY.tsv OUT.json [--root /mnt/photos/PHOTOS]

Only what Picapport indexes is counted (docs/image-metadata.md, field test 2026-11-16): JPEG files;
keywords from XMP dc:subject, Windows XPKeywords and MicrosoftPhoto LastKeywordXMP; people from
PersonInImage and face regions (MWG, Microsoft). Words under 3 letters are kept but marked
not searchable. Reads the survey only; writes OUT.json atomically.
"""
import json, os, re, sys, tempfile
from collections import Counter
from datetime import datetime, timezone

# Columns of metadata-survey.sh (1-based in the script; 0-based here).
COL = {"dir": 0, "file": 1, "type": 2, "date": 3, "gps": 4, "xpkeywords": 8, "dcsubject": 15,
       "lastkeyword": 19, "personinimage": 20, "mpregion": 21, "mwgregion": 22}
WORD = re.compile(r"[A-Za-z0-9]+")


def values(cell):
    if cell in ("-", "", None):
        return []
    return [v.strip() for v in re.split(r"[;,]", cell) if v.strip()]


def searchable(term):
    return all(len(w) >= 3 for w in WORD.findall(term)) and bool(WORD.findall(term))


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    survey, out = args[0], args[1]
    root = args[args.index("--root") + 1] if "--root" in args else "/mnt/photos/PHOTOS"
    keywords, people, folders, years = Counter(), Counter(), Counter(), Counter()
    photos = with_gps = 0
    with open(survey, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            c = line.rstrip("\n").split("\t")
            if len(c) <= COL["mwgregion"] or c[COL["type"]] != "JPEG":
                continue
            photos += 1
            if c[COL["gps"]] not in ("-", ""):
                with_gps += 1
            if re.match(r"\d{4}:", c[COL["date"]]):
                years[c[COL["date"]][:4]] += 1
            kws = {k.lower(): k for col in ("dcsubject", "xpkeywords", "lastkeyword") for k in values(c[COL[col]])}
            ppl = {p.lower(): p for col in ("personinimage", "mpregion", "mwgregion") for p in values(c[COL[col]])}
            for k in kws.values():
                keywords[k] += 1
            for p in ppl.values():
                people[p] += 1
            d = c[COL["dir"]]
            rel = os.path.relpath(d, root) if d.startswith(root) else d
            parts = [] if rel == "." else rel.split(os.sep if os.sep in rel else "/")
            for i in range(1, len(parts) + 1):  # count the photo in every folder above it (dirall:)
                folders["/".join(parts[:i])] += 1

    def merge_case(counter):  # "Troy" and "troy" are one word to Picapport
        merged = {}
        for term, n in counter.items():
            key = term.lower()
            if key in merged:
                merged[key]["photos"] += n
            else:
                merged[key] = {"word": term, "photos": n}
        return sorted(merged.values(), key=lambda x: (-x["photos"], x["word"].lower()))

    vocab = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"survey": survey, "surveyModified": datetime.fromtimestamp(os.path.getmtime(survey), timezone.utc).isoformat(timespec="seconds"), "root": root},
        "photos": photos,
        "photosWithGps": with_gps,
        "years": dict(sorted(years.items())),
        "keywords": [dict(k, searchable=searchable(k["word"])) for k in merge_case(keywords)],
        "people": [dict(p, searchable=searchable(p["word"])) for p in merge_case(people)],
        "folders": [{"path": f, "query": f'dirall:"{root}/{f}"', "photos": n} for f, n in sorted(folders.items())],
        "notes": "Counts are JPEG files in the survey (what Picapport indexes). A keyword or name also matches the same word in folder names. Places can also be searched by GPS area: within:\"minLat,minLng,maxLat,maxLng\".",
    }
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(out)), prefix=".vocabulary-")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(vocab, fh, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o644)
    os.replace(tmp, out)
    print(f"{out}: {photos} photos, {len(vocab['keywords'])} keywords, {len(vocab['people'])} people, {len(vocab['folders'])} folders")


if __name__ == "__main__":
    main()
