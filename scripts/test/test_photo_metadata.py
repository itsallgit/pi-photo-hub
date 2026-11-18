#!/usr/bin/env python3
"""Tests of scripts/photo-metadata.py with a stand-in for exiftool, so they run anywhere. The real
exiftool and a real exFAT file system are tested on the Pi by scripts/test/photo-metadata-pi.sh."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "photo-metadata.py")
spec = importlib.util.spec_from_file_location("photo_metadata", SCRIPT)
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)

XMP_ID = b"http://ns.adobe.com/xap/1.0/\0"
FAKE_EXIFTOOL = r'''
import json, os, re, sys
XMP_ID = b"http://ns.adobe.com/xap/1.0/\0"
data = sys.stdin.buffer.read()
def split(d):
    i = d.find(b"\xff\xe1");
    while i >= 0:
        n = int.from_bytes(d[i + 2:i + 4], "big")
        if d[i + 4:].startswith(XMP_ID): return i, i + 2 + n, json.loads(d[i + 4 + len(XMP_ID):i + 2 + n])
        i = d.find(b"\xff\xe1", i + 2 + n)
    return 2, 2, {}
mode = os.environ.get("FAKE_EXIF", "")
if "-j" in sys.argv:
    s, e, tags = split(data)
    print(json.dumps([{"SourceFile": "-", **tags}])); sys.exit(0)
if mode == "fail": sys.stderr.write("broken"); sys.exit(1)
tag, value = re.match(r"-(.+)=(.*)", sys.argv[2]).groups()
s, e, tags = split(data)
tags = dict(tags); tags["XMP-x:XMPToolkit"] = "fake"
if mode != "no-value": tags[tag] = int(value)
if mode == "lose-tag": tags.pop("XMP-dc:Subject", None)
body = XMP_ID + json.dumps(tags).encode()
out = data[:s] + b"\xff\xe1" + (len(body) + 2).to_bytes(2, "big") + body + data[e:]
if mode == "pixels": out = out.replace(b"PIXELS", b"PIXELZ")
if mode == "trailer": out = out[:-1]
sys.stdout.buffer.write(out)
'''


def jpeg(tags=None):
    head = b"\xff\xd8"
    if tags is not None:
        body = XMP_ID + json.dumps(tags).encode()
        head += b"\xff\xe1" + (len(body) + 2).to_bytes(2, "big") + body
    exif = b"\xff\xe1\x00\x08Exif\0\0"
    return head + exif + b"\xff\xdb\x00\x04\x01\x02" + b"\xff\xda\x00\x04\x00\x00" + b"PIXELS\xff\x00DATA" + b"\xff\xd9" + b"PHONE-TRAILER"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.root = os.path.join(self.dir, "PHOTOS")
        os.makedirs(os.path.join(self.root, "A"))
        self.photo = os.path.join(self.root, "A", "p.jpg")
        self.original = jpeg({"XMP-dc:Subject": ["Alex"], "XMP-x:XMPToolkit": "old"})
        with open(self.photo, "wb") as fh:
            fh.write(self.original)
        os.utime(self.photo, (1000000000, 1000000000))
        fake = os.path.join(self.dir, "fake_exiftool.py")
        with open(fake, "w", encoding="utf-8") as fh:
            fh.write(FAKE_EXIFTOOL)
        self.drive = os.path.join(self.dir, "drive.json")
        self.drive_result(True)
        self.config = os.path.join(self.dir, "config.json")
        self.cfg = {"writesEnabled": True, "root": self.root, "mount": self.dir, "requireMount": False, "driveCheckFile": self.drive,
                    "driveCheckMaxAgeHours": 72, "lockFile": os.path.join(self.dir, "lock"), "exiftool": [sys.executable, fake]}
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        with open(self.config, "w", encoding="utf-8") as fh:
            json.dump(self.cfg, fh)

    def drive_result(self, ok, at=None):
        with open(self.drive, "w", encoding="utf-8") as fh:
            json.dump({"ok": ok, "at": at if at is not None else time.time()}, fh)

    def run_tool(self, *args, **env):
        p = subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True,
                           env={**os.environ, "PHOTO_METADATA_CONFIG": self.config, **env})
        return p.returncode, json.loads(p.stdout) if p.stdout.strip() else None

    def rate(self, value="5", *extra, **env):
        return self.run_tool("set-rating", self.photo, value, *extra, **env)

    def data(self, path=None):
        with open(path or self.photo, "rb") as fh:
            return fh.read()

    def files(self):
        return sorted(os.listdir(os.path.dirname(self.photo)))

    def assert_untouched(self):
        self.assertEqual(self.data(), self.original)
        self.assertEqual(self.files(), ["p.jpg"])


class Writing(Base):
    def test_sets_rating_and_keeps_everything_else(self):
        created = pm.created_time(self.photo)
        time.sleep(0.05)
        code, out = self.rate()
        self.assertEqual((code, out["ok"], out["changed"], out["rating"], out["previous"]), (0, True, True, 5, 0))
        self.assertEqual(self.files(), ["p.jpg"])
        new = self.data()
        self.assertEqual(pm.outside_xmp_hash(new), pm.outside_xmp_hash(self.original))
        self.assertTrue(new.endswith(b"PHONE-TRAILER"))
        self.assertEqual(int(os.stat(self.photo).st_mtime), 1000000000)
        self.assertEqual(pm.created_time(self.photo), created)
        self.assertEqual(self.run_tool("read", self.photo)[1]["rating"], 5)

    def test_every_allowed_value_round_trips(self):
        for value in ("1", "0", "5", "0"):
            self.assertEqual(self.rate(value)[0], 0)
            self.assertEqual(self.run_tool("read", self.photo)[1]["rating"], int(value))
        self.assertEqual(pm.outside_xmp_hash(self.data()), pm.outside_xmp_hash(self.original))

    def test_same_value_writes_nothing(self):
        self.rate("5")
        before = self.data()
        code, out = self.rate("5")
        self.assertEqual((code, out["changed"]), (0, False))
        self.assertEqual(self.data(), before)

    def test_standard_field_wins_and_zero_overrides_an_old_namespace(self):
        self.original = jpeg({"XMP-tmp0:Rating": 5})
        with open(self.photo, "wb") as fh:
            fh.write(self.original)
        self.assertEqual(self.run_tool("read", self.photo)[1]["rating"], 5)
        self.assertEqual(self.rate("0")[1]["changed"], True)
        self.assertEqual(self.run_tool("read", self.photo)[1]["rating"], 0)


class FailedChecks(Base):
    def test_each_bad_result_is_discarded_and_the_photo_untouched(self):
        for mode, code in (("pixels", "verify-failed"), ("trailer", "verify-failed"), ("no-value", "verify-failed"),
                           ("lose-tag", "verify-failed"), ("fail", "tool-failed")):
            with self.subTest(mode):
                rc, out = self.rate(FAKE_EXIF=mode)
                self.assertEqual((rc, out["ok"], out["code"]), (1, False, code))
                self.assert_untouched()

    def test_damage_found_after_the_rewrite_restores_the_original(self):
        rc, out = self.rate(PHOTO_METADATA_TEST_CORRUPT="after-rewrite")
        self.assertEqual((rc, out["code"]), (1, "verify-failed"))
        self.assert_untouched()

    def test_a_bad_safety_copy_stops_before_the_photo_is_touched(self):
        rc, out = self.rate(PHOTO_METADATA_TEST_CORRUPT="backup-written")
        self.assertEqual((rc, out["code"]), (1, "verify-failed"))
        self.assert_untouched()

    def reset(self):
        folder = os.path.dirname(self.photo)
        for name in os.listdir(folder):
            os.unlink(os.path.join(folder, name))
        with open(self.photo, "wb") as fh:
            fh.write(self.original)

    def crash_at(self, point):
        p = subprocess.run([sys.executable, SCRIPT, "set-rating", self.photo, "5"], capture_output=True,
                           env={**os.environ, "PHOTO_METADATA_CONFIG": self.config, "PHOTO_METADATA_TEST_CRASH": point})
        self.assertEqual(p.returncode, 99)

    def test_a_crash_always_leaves_a_complete_copy_and_recover_finishes_it(self):
        core = pm.outside_xmp_hash(self.original)
        folder = os.path.dirname(self.photo)
        for point in ("after-temp", "before-backup", "after-backup", "mid-rewrite", "after-rewrite", "after-verify"):
            with self.subTest(point):
                self.reset()
                self.crash_at(point)
                whole = []
                for name in os.listdir(folder):
                    try:
                        whole += [name] if pm.outside_xmp_hash(self.data(os.path.join(folder, name))) == core else []
                    except pm.Stop:
                        pass
                self.assertTrue(whole)
                self.assertGreaterEqual(self.run_tool("strays")[1]["count"], 1)
                self.assertEqual(self.rate()[1]["code"], "needs-attention", "the photo is left alone until recovered")
                rc, out = self.run_tool("recover", self.photo)
                self.assertEqual((rc, out["ok"]), (0, True), out)
                self.assertEqual(self.files(), ["p.jpg"])
                self.assertEqual(pm.outside_xmp_hash(self.data()), core)
                self.assertEqual(self.rate()[0], 0, "and can be changed again")

    def test_mid_rewrite_recovery_writes_the_original_back(self):
        self.crash_at("mid-rewrite")
        self.assertNotEqual(self.data(), self.original)
        self.assertEqual(self.run_tool("recover", self.photo)[1]["action"], "the original was written back")
        self.assert_untouched()

    def test_leftovers_block_that_photo_and_are_not_removed(self):
        for name in (".p.jpg.pph-old", ".p.jpg.pph-new"):
            stray = os.path.join(os.path.dirname(self.photo), name)
            with open(stray, "wb") as fh:
                fh.write(b"keep me")
            rc, out = self.rate()
            self.assertEqual((rc, out["code"]), (1, "needs-attention"))
            self.assertEqual(self.data(stray), b"keep me")
            self.assertEqual(self.data(), self.original)
            os.unlink(stray)

    def test_recover_refuses_a_damaged_safety_copy(self):
        self.crash_at("mid-rewrite")
        stray = os.path.join(os.path.dirname(self.photo), ".p.jpg.pph-old")
        with open(stray, "wb") as fh:
            fh.write(b"damaged")
        before = sorted(self.files())
        self.assertEqual(self.run_tool("recover", self.photo)[1]["code"], "not-a-jpeg")
        self.assertEqual(sorted(self.files()), before)


class Refusals(Base):
    def test_switched_off(self):
        self.cfg["writesEnabled"] = False
        self.save()
        self.assertEqual(self.rate()[1]["code"], "switched-off")
        self.assert_untouched()
        self.assertEqual(self.run_tool("status")[1]["writable"], False)
        self.assertEqual(self.rate("5", "--first-write")[0], 0)

    def test_drive_check_required_even_for_a_first_write(self):
        for setup in (lambda: self.drive_result(False), lambda: self.drive_result(True, time.time() - 73 * 3600), lambda: os.unlink(self.drive)):
            setup()
            self.assertEqual(self.rate("5", "--first-write")[1]["code"], "drive-check")
            self.assert_untouched()
            self.drive_result(True)

    def test_only_jpegs_inside_the_library(self):
        outside = os.path.join(self.dir, "x.jpg")
        png = os.path.join(self.root, "A", "x.png")
        for path in (outside, png):
            with open(path, "wb") as fh:
                fh.write(self.original)
            self.assertEqual(self.run_tool("set-rating", path, "5")[1]["code"], "not-allowed")
            self.assertEqual(self.data(path), self.original)
        self.assertEqual(self.run_tool("set-rating", os.path.join(self.root, "A", "..", "..", "x.jpg"), "5")[1]["code"], "not-allowed")

    def test_only_allowed_values(self):
        p = subprocess.run([sys.executable, SCRIPT, "set-rating", self.photo, "3"], capture_output=True,
                           env={**os.environ, "PHOTO_METADATA_CONFIG": self.config})
        self.assertEqual(p.returncode, 2)
        self.assert_untouched()

    def test_a_file_that_is_not_a_jpeg(self):
        with open(self.photo, "wb") as fh:
            fh.write(b"not a photo")
        self.original = b"not a photo"
        self.assertEqual(self.rate()[1]["code"], "not-a-jpeg")
        self.assert_untouched()


if __name__ == "__main__":
    unittest.main()
