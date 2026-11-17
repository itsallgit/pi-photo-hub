"""Tests for build-vocabulary.py and places.py with small fixtures (no Pi, no photos).
Run: python -m unittest discover -s scripts/test   (scripts/check.sh runs it)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, SCRIPTS)
from places import Places  # noqa: E402

# GeoNames cities1000 format: id, name, ascii, alternates, lat, lon, class, code, cc, cc2,
# admin1..4, population, elevation, dem, timezone, modified (19 columns)
CITIES = [
    ("1", "Sydney", -33.86785, 151.20732, "AU", 4627345),
    ("2", "Newtown", -33.8977, 151.1794, "AU", 14500),
    ("3", "La Spezia", 44.10704, 9.82819, "IT", 93000),
    ("4", "Vernazza", 44.13525, 9.68316, "IT", 1000),
    ("5", "Monterosso al Mare", 44.14601, 9.65464, "IT", 1500),
    ("6", "Noosa Heads", -26.39433, 153.09010, "AU", 3929),
]


def city_line(c):
    gid, name, lat, lon, cc, pop = c
    return "\t".join([gid, name, name, "", str(lat), str(lon), "P", "PPL", cc, "", "", "", "", "", str(pop), "", "0", "tz", "2024-01-01"])


def survey_line(d, f, date="-", orient="-", w="-", h="-", lat="-", lon="-", kw="-", person="-", rating="-", ftype="JPEG"):
    c = ["-"] * 32
    c[0], c[1], c[2], c[3] = d, f, ftype, date
    c[4] = "33 deg S" if lat != "-" else "-"
    c[15], c[20], c[18] = kw, person, rating
    c[27], c[28], c[29], c[30], c[31] = orient, w, h, lat, lon
    return "\t".join(c)


ROOT = "/mnt/photos/PHOTOS"
SURVEY = [
    survey_line(f"{ROOT}/2026 - Cinque Terre", "a.jpg", "2026:09:20 10:00:00", "1", "4000", "2252", "44.1350", "9.6840", kw="Troy"),
    survey_line(f"{ROOT}/2026 - Cinque Terre", "b.jpg", "2026:09:20 10:00:02", "6", "4000", "2252", "44.1460", "9.6550", person="Troy"),
    survey_line(f"{ROOT}/2026 - Cinque Terre", "c.jpg", "2026:09:21 11:00:00", "1", "2252", "4000"),
    survey_line(f"{ROOT}/_Friends", "d.jpg", "2018:10:05 20:01:08", "1", "4032", "3024", "-33.8975", "151.1790", rating="5"),
    survey_line(f"{ROOT}/_Friends", "e.jpg", "-", "-", "-", "-", "0", "0"),
    survey_line(f"{ROOT}/_Friends", "f.heic", "2018:10:05 20:01:08", ftype="HEIC"),
    survey_line(f"{ROOT}/2021.05 - Noosa", "g.jpg", "2021:05:03 05:09:49", "1", "4032", "3024", "-26.39", "153.09"),
    survey_line(f"{ROOT}/Sea", "h.jpg", "2021:05:03 05:09:49", "1", "100", "50", "-30.0", "160.0"),
]
OLD_FORMAT = "\t".join([f"{ROOT}/Old", "old.jpg", "JPEG", "2010:01:01 00:00:00"] + ["-"] * 23)


class PlacesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        with open(os.path.join(self.dir, "cities1000.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(city_line(c) for c in CITIES) + "\n")
        with open(os.path.join(self.dir, "countryInfo.txt"), "w", encoding="utf-8") as fh:
            fh.write("#ISO\tISO3\tnum\tfips\tCountry\n" + "AU\tAUS\t036\tAS\tAustralia\nIT\tITA\t380\tIT\tItaly\n")
        self.p = Places(os.path.join(self.dir, "cities1000.txt"), os.path.join(self.dir, "countryInfo.txt"))

    def tearDown(self):
        shutil.rmtree(self.dir)

    def name(self, i):
        return None if i is None else self.p.places[i][0]

    def test_locality_is_nearest_city_is_biggest(self):
        loc, city = self.p.lookup(44.1350, 9.6840)
        self.assertEqual(self.name(loc), "Vernazza")
        self.assertEqual(self.name(city), "La Spezia")
        loc, city = self.p.lookup(-33.8975, 151.1790)
        self.assertEqual((self.name(loc), self.name(city)), ("Newtown", "Sydney"))

    def test_far_from_everything(self):
        self.assertEqual(self.p.lookup(-30.0, 160.0), (None, None))

    def test_country_names(self):
        self.assertEqual(self.p.country_name("IT"), "Italy")
        self.assertEqual(self.p.country_name("ZZ"), "ZZ")


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, "places"))
        with open(os.path.join(self.dir, "places", "cities1000.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(city_line(c) for c in CITIES) + "\n")
        with open(os.path.join(self.dir, "places", "countryInfo.txt"), "w", encoding="utf-8") as fh:
            fh.write("AU\tAUS\t036\tAS\tAustralia\nIT\tITA\t380\tIT\tItaly\n")
        self.survey = os.path.join(self.dir, "survey.tsv")
        with open(self.survey, "w", encoding="utf-8") as fh:
            fh.write("\n".join(SURVEY + [OLD_FORMAT]) + "\n")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def build(self, *extra):
        out = os.path.join(self.dir, "vocabulary.json")
        cat = os.path.join(self.dir, "catalogue.json")
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "build-vocabulary.py"), self.survey, out, "--catalogue", cat, *extra],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(out, encoding="utf-8") as fh:
            vocab = json.load(fh)
        with open(cat, encoding="utf-8") as fh:
            return vocab, json.load(fh), r.stdout

    def test_catalogue_rows(self):
        vocab, cat, out = self.build()
        self.assertEqual(vocab["photos"], 8)  # 7 JPEGs + the old-format row; HEIC skipped
        self.assertEqual(len(cat["photos"]), 8)
        rows = {r[1]: dict(zip(cat["fields"], r)) for r in cat["photos"]}
        a, b, c = rows["a.jpg"], rows["b.jpg"], rows["c.jpg"]
        self.assertEqual(cat["folders"][a["folder"]], f"{ROOT}/2026 - Cinque Terre")
        self.assertEqual(a["date"], "2026-09-20T10:00:00")
        self.assertEqual(cat["places"][a["locality"]]["name"], "Vernazza")
        self.assertEqual(cat["places"][a["city"]]["name"], "La Spezia")
        self.assertEqual(cat["places"][a["city"]]["country"], "Italy")
        self.assertEqual(cat["places"][b["locality"]]["name"], "Monterosso al Mare")
        self.assertEqual(b["orientation"], 6)
        self.assertEqual(cat["people"][b["people"][0]], "Troy")
        self.assertIsNone(c["lat"])
        self.assertEqual(rows["d.jpg"]["rating"], 5)
        self.assertIsNone(rows["e.jpg"]["city"])  # GPS 0,0 is no position
        self.assertIsNone(rows["h.jpg"]["city"])  # far from any place
        self.assertIsNone(rows["old.jpg"]["width"])  # old survey format still read
        self.assertIn("2 upright", out)  # b (turned a quarter) and c (taller than wide)

    def test_vocabulary_places_tree(self):
        vocab, _, _ = self.build()
        by_cc = {p["cc"]: p for p in vocab["places"]}
        self.assertEqual(by_cc["IT"]["country"], "Italy")
        self.assertEqual(by_cc["IT"]["photos"], 2)
        self.assertEqual(by_cc["IT"]["cities"], [{"city": "La Spezia", "key": "IT/La Spezia", "photos": 2}])
        self.assertEqual({c["city"] for c in by_cc["AU"]["cities"]}, {"Sydney", "Noosa Heads"})
        self.assertEqual(vocab["photosWithPlace"], 4)

    def test_without_place_list(self):
        vocab, cat, _ = self.build("--places", os.path.join(self.dir, "none"))
        self.assertEqual(vocab["places"], [])
        self.assertEqual(cat["places"], [])
        self.assertIsNone(cat["attribution"])


if __name__ == "__main__":
    unittest.main()
