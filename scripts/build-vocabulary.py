#!/usr/bin/env python3
"""build-vocabulary.py - turn a metadata survey (scripts/metadata-survey.sh scan) into the slideshow
vocabulary: the searchable keywords, people and folders, with photo counts (backlog B29).

    build-vocabulary.py SURVEY.tsv OUT.json [--root /mnt/photos/PHOTOS] [--catalogue CATALOGUE.json]
                        [--places DIR]

Only what Picapport indexes is counted (docs/image-metadata.md, field test 2026-11-16): JPEG files;
keywords from XMP dc:subject, Windows XPKeywords and MicrosoftPhoto LastKeywordXMP; people from
PersonInImage and face regions (MWG, Microsoft). Words under 3 letters are kept but marked
not searchable. Reads the survey only; writes OUT.json atomically.

With --catalogue it also writes the photo catalogue for the slideshow layer (B32): one row per JPEG,
keyed by its file path, with date, rotate tag, pixel size, GPS, place, rating and people. It is
derived and disposable, rebuilt nightly from the photos (principle 11). Places come from GPS with
the offline GeoNames list in --places DIR (default: places/ next to the survey; fetched by
scripts/fetch-places.sh); without it there are no places, and everything else still works.
"""
import json, os, re, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from places import Places  # noqa: E402
from collections import Counter
from datetime import datetime, timezone

# Columns of metadata-survey.sh (1-based in the script; 0-based here).
COL = {"dir": 0, "file": 1, "type": 2, "date": 3, "gps": 4, "xpkeywords": 8, "dcsubject": 15,
       "rating": 18, "lastkeyword": 19, "personinimage": 20, "mpregion": 21, "mwgregion": 22,
       # added 2026-11-18 (columns 28 to 32 of metadata-survey.sh); older surveys stop at 27
       "orientation": 27, "width": 28, "height": 29, "lat": 30, "lon": 31}
CATALOGUE_FIELDS = ["folder", "file", "date", "orientation", "width", "height", "lat", "lon",
                    "locality", "city", "rating", "people"]
WORD = re.compile(r"[A-Za-z0-9]+")


def values(cell):
    if cell in ("-", "", None):
        return []
    return [v.strip() for v in re.split(r"[;,]", cell) if v.strip()]


def num(c, key, kind=float):
    i = COL[key]
    if i >= len(c) or c[i] in ("-", ""):
        return None
    try:
        return kind(float(c[i])) if kind is int else kind(c[i])
    except ValueError:
        return None


def iso_date(cell):
    m = re.match(r"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})", cell or "")
    if not m or m.group(1) == "0000":
        return None
    return "%s-%s-%sT%s:%s:%s" % m.groups()


def write_json(out, value, prefix, indent=None):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(out)), prefix=prefix)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, out)


def searchable(term):
    return all(len(w) >= 3 for w in WORD.findall(term)) and bool(WORD.findall(term))


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    survey, out = args[0], args[1]
    root = args[args.index("--root") + 1] if "--root" in args else "/mnt/photos/PHOTOS"
    catalogue_out = args[args.index("--catalogue") + 1] if "--catalogue" in args else None
    places_dir = args[args.index("--places") + 1] if "--places" in args else os.path.join(os.path.dirname(os.path.abspath(survey)), "places")
    places = None
    cities_file = os.path.join(places_dir, "cities1000.txt")
    if os.path.exists(cities_file):
        places = Places(cities_file, os.path.join(places_dir, "countryInfo.txt"))
    keywords, people, folders, years = Counter(), Counter(), Counter(), Counter()
    photos = with_gps = 0
    rows, folder_ix, person_ix, used_places = [], {}, {}, {}
    place_photos = Counter()  # city's GeoNames index -> photos
    uprights = with_place = 0

    def place_id(i):
        if i is None:
            return None
        if i not in used_places:
            used_places[i] = len(used_places)
        return used_places[i]
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
            if catalogue_out is not None:
                orient, w, h = num(c, "orientation", int), num(c, "width", int), num(c, "height", int)
                lat, lon = num(c, "lat"), num(c, "lon")
                if w and h and (h > w) != (orient in (5, 6, 7, 8)):
                    uprights += 1
                loc = city = None
                if places is not None and lat is not None and lon is not None and (lat, lon) != (0.0, 0.0):
                    loc, city = places.lookup(lat, lon)
                    if city is not None:
                        with_place += 1
                        place_photos[city] += 1
                rating = num(c, "rating", float)
                rows.append([folder_ix.setdefault(d, len(folder_ix)), c[COL["file"]], iso_date(c[COL["date"]]),
                             orient or 1, w, h, round(lat, 6) if lat is not None else None,
                             round(lon, 6) if lon is not None else None, place_id(loc), place_id(city),
                             int(rating) if rating else 0,
                             [person_ix.setdefault(p.lower(), (len(person_ix), p))[0] for p in ppl.values()]])
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
        "places": [],
        "notes": "Counts are JPEG files in the survey (what Picapport indexes). A keyword or name also matches the same word in folder names. Places can also be searched by GPS area: within:\"minLat,minLng,maxLat,maxLng\".",
    }
    if places is not None:
        # Places for the phone's tag tree: country, then city (each photo's "city"), with a key the
        # player understands (a source's "places": ["<cc>" or "<cc>/<city>"]).
        countries = {}
        for i, n in place_photos.items():
            name, cc = places.places[i][0], places.places[i][1]
            e = countries.setdefault(cc, {"country": places.country_name(cc), "cc": cc, "key": cc, "photos": 0, "cities": []})
            e["photos"] += n
            e["cities"].append({"city": name, "key": f"{cc}/{name}", "photos": n})
        for e in countries.values():
            e["cities"].sort(key=lambda x: (-x["photos"], x["city"]))
        vocab["places"] = sorted(countries.values(), key=lambda x: (-x["photos"], x["country"]))
        vocab["photosWithPlace"] = with_place
        vocab["notes"] += " Places (country, then city) come from GPS with the offline GeoNames list (CC BY 4.0); they are played from the photo API's own catalogue (source places), not by a Picapport word."
    write_json(out, vocab, ".vocabulary-", indent=1)
    print(f"{out}: {photos} photos, {len(vocab['keywords'])} keywords, {len(vocab['people'])} people, {len(vocab['folders'])} folders, {len(vocab['places'])} countries")
    if catalogue_out is not None:
        place_list = [None] * len(used_places)
        for i, k in used_places.items():
            name, cc, lat, lon, pop = places.places[i]
            place_list[k] = {"name": name, "cc": cc, "country": places.country_name(cc), "lat": lat, "lon": lon, "population": pop}
        catalogue = {
            "version": 1,
            "generatedAt": vocab["generatedAt"],
            "root": root,
            "fields": CATALOGUE_FIELDS,
            "folders": [d for d, _ in sorted(folder_ix.items(), key=lambda x: x[1])],
            "places": place_list,
            "people": [name for _, (i, name) in sorted(person_ix.items(), key=lambda x: x[1][0])],
            "photos": rows,
            "attribution": "Place names: GeoNames (https://www.geonames.org), CC BY 4.0" if places else None,
        }
        write_json(catalogue_out, catalogue, ".catalogue-")
        print(f"{catalogue_out}: {len(rows)} photos, {uprights} upright, {with_place} with a place, {len(place_list)} places")


if __name__ == "__main__":
    main()
