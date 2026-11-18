#!/usr/bin/env python3
"""Test the metadata writer and the drive check on the Pi with the real exiftool and a real exFAT file
system, on a throwaway disk image in memory. The photo drive is only read, to copy a few samples.

    python3 scripts/test/photo-metadata-pi.py

For every crash point it copies the image as the disk would be at that moment (what was not yet
flushed is missing, as after a power cut), mounts the copy and checks a complete photo survives.
"""
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WRITER = os.path.join(HERE, "..", "photo-metadata.py")
CHECK = os.path.join(HERE, "..", "photo-drive-check.py")
SURVEY = os.path.expanduser("~/metadata-survey/survey.tsv")
POINTS = ["after-temp", "before-backup", "after-backup", "mid-rewrite", "after-rewrite", "after-verify", "after-unlink"]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pm = load("photo_metadata", WRITER)
dc = load("photo_drive_check", CHECK)
fails = 0


def ok(name, good, detail=""):
    global fails
    print(f"{'ok  ' if good else 'FAIL'} {name}{': ' + str(detail) if detail != '' else ''}", flush=True)
    fails += not good


def sh(*cmd, check=True, **kw):
    return subprocess.run(cmd, check=check, capture_output=True, text=True, **kw)


def samples():
    rows = [l.rstrip("\n").split("\t") for l in open(SURVEY, errors="replace")]
    jpegs = [r for r in rows if r[2] == "JPEG"]
    picks = {
        "lightroom": next(r for r in jpegs if r[18] not in ("-", "") and "Wedding" in r[0]),
        "rated": next(r for r in jpegs if r[18] == "5" and "Wedding" not in r[0]),
        "keywords": next(r for r in jpegs if r[15] not in ("-", "")),
        "faces": next(r for r in jpegs if r[22] not in ("-", "")),
        "samsung": next(r for r in jpegs if r[5].lower() == "samsung" and "Honeymoon" in r[0]),
        "apple": next(r for r in jpegs if r[5].startswith("Apple")),
        "canon": next(r for r in jpegs if r[5].startswith("Canon")),
        "whatsapp": next(r for r in jpegs if "-WA" in r[1]),
    }
    return {k: os.path.join(r[0], r[1]) for k, r in picks.items()}


def main():
    work = tempfile.mkdtemp(prefix="pph-test-", dir="/dev/shm")
    image, mnt, snap_mnt = (os.path.join(work, n) for n in ("disk.img", "mnt", "snap"))
    os.makedirs(mnt)
    os.makedirs(snap_mnt)
    loop = None
    uid = f"uid={os.getuid()},gid={os.getgid()}"
    try:
        with open(image, "wb") as fh:
            fh.truncate(128 * 1024 * 1024)
        sh("/usr/sbin/mkfs.exfat", image)
        loop = sh("sudo", "-n", "losetup", "--find", "--show", image).stdout.strip()
        assert loop.startswith("/dev/loop")
        sh("sudo", "-n", "mount", "-o", uid, loop, mnt)
        root = os.path.join(mnt, "PHOTOS")
        os.makedirs(os.path.join(root, "A"))
        cfgfile = os.path.join(work, "config.json")
        drive = os.path.join(work, "drive.json")
        cfg = {"writesEnabled": True, "root": root, "mount": mnt, "driveCheckFile": drive, "driveCheckMaxAgeHours": 72, "lockFile": os.path.join(work, "lock")}
        json.dump(cfg, open(cfgfile, "w"))
        env = {**os.environ, "PHOTO_METADATA_CONFIG": cfgfile}
        real = pm.load_config.__globals__
        real["CONFIG"] = cfgfile
        tool_cfg = pm.load_config()

        def drive_check(device=loop, sudo=True):
            cmd = (["sudo", "-n"] if sudo else []) + ["python3", CHECK, "--device", device]
            p = sh(*cmd, check=False)
            return p.returncode, json.loads(p.stdout)

        def writer(*args, **extra):
            p = sh("python3", WRITER, *args, check=False, env={**env, **extra})
            try:
                return p.returncode, json.loads(p.stdout)
            except ValueError:
                return p.returncode, {}

        sources = samples()
        originals = {}
        for name, src in sources.items():
            dst = os.path.join(root, "A", f"{name}.jpg")
            shutil.copyfile(src, dst)
            os.utime(dst, (1000000000, 1000000000))
            originals[name] = pm.read_file(dst)
        os.sync()
        created = {name: pm.created_time(os.path.join(root, "A", f"{name}.jpg")) for name in originals}
        time.sleep(3)  # a replaced file would now show a later created date
        rc, out = drive_check()
        ok("drive check passes on a fresh exFAT image", rc == 0 and out["ok"], out.get("failedChecks"))
        out["at"] = time.time()
        json.dump(out, open(drive, "w"))

        for name, data in originals.items():
            path = os.path.join(root, "A", f"{name}.jpg")
            core = pm.outside_xmp_hash(data)
            before = pm.comparable(pm.xmp_tags(tool_cfg, data), {"XMP-xmp:Rating"})
            good = True
            detail = ""
            for value in (5, 1, 0):
                rc, out = writer("set-rating", path, str(value))
                now = pm.read_file(path)
                tags = pm.xmp_tags(tool_cfg, now)
                same = pm.outside_xmp_hash(now) == core and pm.comparable(tags, {"XMP-xmp:Rating"}) == before
                read = writer("read", path)[1].get("rating")
                if rc != 0 or not same or read != value or int(os.stat(path).st_mtime) != 1000000000 or pm.created_time(path) != created[name]:
                    good = False
                    detail = f"value {value}: rc {rc} {out} same={same} read={read}"
                detail = detail or f"{out.get('seconds')} s, {len(now) - len(data):+d} bytes"
            ok(f"real exiftool on exFAT: {name}: 5, 1, 0 read back, all else identical, created and modified dates kept", good, detail)
        ok("no work files left", writer("strays")[1].get("count") == 0)
        os.sync()
        rc, out = drive_check()
        ok("drive check still passes after the writes", rc == 0 and out["ok"], out.get("failedChecks"))

        sample = originals["samsung"]
        core = pm.outside_xmp_hash(sample)
        for point in POINTS:
            folder = os.path.join(root, point)
            os.makedirs(folder)
            path = os.path.join(folder, "p.jpg")
            with open(path, "wb") as fh:
                fh.write(sample)
                fh.flush()
                os.fsync(fh.fileno())
            os.sync()
            rc, _ = writer("set-rating", path, "5", PHOTO_METADATA_TEST_CRASH=point)
            snapshot = os.path.join(work, "snapshot.img")
            sh("sudo", "-n", "cp", "--sparse=always", image, snapshot)  # the disk as a power cut would leave it
            snap_loop = sh("sudo", "-n", "losetup", "--find", "--show", "--read-only", snapshot).stdout.strip()
            try:
                sh("sudo", "-n", "mount", "-o", f"ro,{uid}", snap_loop, snap_mnt)
                try:
                    there = os.path.join(snap_mnt, "PHOTOS", point)
                    names = sorted(os.listdir(there))
                    whole = []
                    for n in names:
                        try:
                            if pm.outside_xmp_hash(pm.read_file(os.path.join(there, n))) == core:
                                whole.append(n)
                        except pm.Stop:
                            pass
                finally:
                    sh("sudo", "-n", "umount", snap_mnt)
                crc, cres = drive_check(snap_loop)
            finally:
                sh("sudo", "-n", "losetup", "-d", snap_loop)
                sh("sudo", "-n", "rm", "-f", snapshot)
            ok(f"crash {point}: a complete photo survives a simulated power cut", rc == 99 and bool(whole), f"names {names}, complete {whole}, drive check {'passed' if crc == 0 else cres.get('failedChecks')}")
            live = sorted(os.listdir(folder))
            if any(n.endswith((".pph-new", ".pph-old")) for n in live):
                refused = writer("set-rating", path, "5")[1]
                ok(f"crash {point}: leftovers are reported and block that photo", refused.get("code") == "needs-attention", refused.get("code"))
                born = pm.created_time(path)
                rc, out = writer("recover", path)
                good = rc == 0 and sorted(os.listdir(folder)) == ["p.jpg"] and pm.created_time(path) == born
                ok(f"crash {point}: recover finishes it", good, out.get("action") or out)
            ok(f"crash {point}: the photo is complete", pm.outside_xmp_hash(pm.read_file(path)) == core)
            ok(f"crash {point}: it can be changed again", writer("set-rating", path, "1")[0] == 0)

        canon = os.path.join(root, "A", "canon.jpg")
        before_damage = pm.read_file(canon)
        born = pm.created_time(canon)
        rc, out = writer("set-rating", canon, "5", PHOTO_METADATA_TEST_CORRUPT="after-rewrite")
        ok("damage found after the rewrite writes the original back", rc == 1 and out.get("code") == "verify-failed", out.get("code"))
        ok("the original is back, with its created date and no work files", pm.read_file(canon) == before_damage and pm.created_time(canon) == born and not [n for n in os.listdir(os.path.dirname(canon)) if n.startswith(".")])

        sh("sudo", "-n", "umount", mnt)
        rc = subprocess.run(["sudo", "-n", "/usr/sbin/fsck.exfat", "-n", loop], capture_output=True, text=True)
        ok("the standard exFAT checker accepts the image afterwards (leftovers are ordinary files)", rc.returncode == 0, rc.stdout.strip().splitlines()[-1:] )
        rc, out = drive_check()
        ok("the drive check agrees", rc == 0, out.get("failedChecks"))

        damaged = os.path.join(work, "damaged.img")
        sh("sudo", "-n", "cp", "--sparse=always", loop, damaged)
        sh("sudo", "-n", "chown", f"{os.getuid()}:{os.getgid()}", damaged)
        v = dc.Volume(damaged)
        root_dir = v.clusters([v.root])
        offset = None
        for i in range(0, len(root_dir), 32):
            if root_dir[i] == 0x81:
                first = struct.unpack_from("<I", root_dir, i + 20)[0]
                offset = v.heap * v.bps + (first - 2) * v.cluster
                break
        index = v.root - 2
        with open(damaged, "r+b") as fh:
            fh.seek(offset + (index >> 3))
            byte = fh.read(1)[0]
            fh.seek(offset + (index >> 3))
            fh.write(bytes([byte & ~(1 << (index & 7))]))
        rc, out = drive_check(damaged, sudo=False)
        ok("the drive check catches used space marked as free", rc == 1 and "usedButMarkedFree" in out.get("failedChecks", []), out.get("failedChecks"))
    finally:
        sh("sudo", "-n", "umount", snap_mnt, check=False)
        sh("sudo", "-n", "umount", mnt, check=False)
        if loop:
            sh("sudo", "-n", "losetup", "-d", loop, check=False)
        sh("sudo", "-n", "rm", "-rf", work, check=False)
    print("FAILED" if fails else "all passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
