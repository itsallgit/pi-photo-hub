#!/usr/bin/env python3
"""photo-metadata.py - the project's ONE way to change a photo file (hard rule 1, principle 11).

It changes embedded XMP metadata of a JPEG in the library and nothing else: never the pixels, never
another metadata block, never a file's name or place. Only the fields listed in FIELDS can be set;
adding a field (tags, for example) means extending FIELDS and its tests.

    photo-metadata.py status                       may photos be changed right now?
    photo-metadata.py read PATH                    the rating stored in a photo
    photo-metadata.py set-rating PATH 0|1|5        0 no rating, 1 skipped, 5 favourite
    photo-metadata.py strays                       leftover work files after an interruption

    --first-write  (set-rating) ignores only the "writesEnabled" switch, for the owner's agreed
                   first test photo. Every other check still applies.

Prints one JSON object. Exit 0 when it worked, 1 when it did not; on failure the photo is as it was.

How a change is made, all beside the photo on the same drive:
 1. The new version is written to ".NAME.pph-new". The original is not touched.
 2. It is checked: the new value reads back, every byte outside the XMP blocks is identical
    (pixels, EXIF, the data phones add after the image), and every other XMP value is the same.
 3. The original becomes ".NAME.pph-old", the new version becomes NAME, and NAME is checked again.
 4. Only then is ".NAME.pph-old" removed. If a check fails, the original is put back.
A full copy exists under one of these names at every moment. After a power cut, `strays` lists what
is left; nothing removes those files automatically (the `photo-metadata` skill, "Recovery").
"""
import errno
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time

try:
    import fcntl
except ImportError:  # Windows, for the unit tests only
    fcntl = None

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.environ.get("PHOTO_METADATA_CONFIG", os.path.join(HERE, "..", "config", "photo-metadata.json"))
FIELDS = {"rating": {"tag": "XMP-xmp:Rating", "values": {0, 1, 5}}}
ALWAYS_REWRITTEN = {"SourceFile", "XMP-x:XMPToolkit"}  # exiftool stamps its own name on the XMP block
NEW, OLD = "pph-new", "pph-old"
JPEG_EXT = (".jpg", ".jpeg")
MAX_BYTES = 300 * 1024 * 1024
TOOL_TIMEOUT = 120


class Stop(Exception):
    """A refusal or failure with a stable code and a sentence a person can read."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def load_config():
    with open(CONFIG, encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg.setdefault("exiftool", ["exiftool"])
    cfg.setdefault("requireMount", True)
    cfg["lockFile"] = os.path.expanduser(cfg["lockFile"])
    return cfg


def test_hook(point, temp=None):
    """Fault injection for the tests; does nothing unless a test sets these variables."""
    if os.environ.get("PHOTO_METADATA_TEST_CRASH") == point:
        os._exit(99)
    if temp and os.environ.get("PHOTO_METADATA_TEST_CORRUPT") == point:
        with open(temp, "r+b") as fh:
            fh.seek(-1, os.SEEK_END)
            last = fh.read(1)
            fh.seek(-1, os.SEEK_END)
            fh.write(bytes([last[0] ^ 0xFF]))


# ---------------------------------------------------------------------------------------------
# What a JPEG holds
# ---------------------------------------------------------------------------------------------
XMP_IDS = (b"http://ns.adobe.com/xap/1.0/\0", b"http://ns.adobe.com/xmp/extension/\0")


def outside_xmp_hash(data):
    """SHA-256 of every byte of a JPEG except its XMP blocks, including anything after the image."""
    try:
        if data[:2] != b"\xff\xd8":
            raise ValueError("no JPEG start")
        digest = hashlib.sha256(data[:2])
        i = 2
        while True:
            start = i
            while data[i] == 0xFF and data[i + 1] == 0xFF:
                i += 1
            if data[i] != 0xFF:
                raise ValueError("no marker")
            marker = data[i + 1]
            if marker == 0xD9:  # end of image: the rest of the file is kept as it is
                digest.update(data[start:])
                return digest.hexdigest()
            if marker == 0x01 or 0xD0 <= marker <= 0xD7:
                i += 2
                digest.update(data[start:i])
                continue
            end = i + 2 + int.from_bytes(data[i + 2:i + 4], "big")
            if end > len(data):
                raise ValueError("block runs past the end")
            if marker == 0xDA:  # image data runs to the next real marker
                j = end
                while True:
                    j = data.index(b"\xff", j)
                    following = data[j + 1]
                    if following == 0 or 0xD0 <= following <= 0xD7:
                        j += 2
                        continue
                    break
                digest.update(data[start:j])
                i = j
                continue
            body = data[i + 4:end]
            if not (marker == 0xE1 and body.startswith(XMP_IDS)):
                digest.update(data[start:end])
            i = end
    except (IndexError, ValueError) as err:
        raise Stop("not-a-jpeg", f"This file could not be read as a JPEG ({err}).")


def tool(cfg, args, stdin=None, stdout=subprocess.PIPE):
    try:
        return subprocess.run(cfg["exiftool"] + args, stdin=stdin if hasattr(stdin, "fileno") else None,
                              input=None if hasattr(stdin, "fileno") else stdin, stdout=stdout,
                              stderr=subprocess.PIPE, timeout=TOOL_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as err:
        raise Stop("tool-failed", f"The metadata tool did not run ({err}).")


def xmp_tags(cfg, data):
    r = tool(cfg, ["-j", "-a", "-G1", "-struct", "-XMP:all", "-"], stdin=data)
    try:
        return json.loads(r.stdout.decode("utf-8"))[0]
    except (ValueError, IndexError) as err:
        raise Stop("tool-failed", f"The photo's metadata could not be read ({err}).")


def rating_of(tags):
    """The standard field wins; older files may hold a rating under another XMP namespace."""
    value = tags.get("XMP-xmp:Rating")
    if value is None:
        value = next((v for k, v in sorted(tags.items()) if k.endswith(":Rating")), 0)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def comparable(tags, changed):
    return {k: v for k, v in tags.items() if k not in ALWAYS_REWRITTEN and k not in changed}


# ---------------------------------------------------------------------------------------------
# Checks before anything is written
# ---------------------------------------------------------------------------------------------
def gate(cfg, first_write=False):
    """Why photos may not be changed now, or None."""
    if cfg["requireMount"] and not os.path.ismount(cfg["mount"]):
        return "no-drive", "The photo drive is not mounted."
    if not cfg.get("writesEnabled") and not first_write:
        return "switched-off", "Saving to the photos is not switched on yet."
    try:
        with open(cfg["driveCheckFile"], encoding="utf-8") as fh:
            check = json.load(fh)
    except (OSError, ValueError):
        return "drive-check", "The photo drive has not passed its safety check yet."
    if not check.get("ok"):
        return "drive-check", "The photo drive's safety check found a problem."
    if time.time() - float(check.get("at", 0)) > cfg["driveCheckMaxAgeHours"] * 3600:
        return "drive-check", "The photo drive's safety check is out of date."
    return None


def checked_path(cfg, path):
    root = os.path.realpath(cfg["root"])
    real = os.path.realpath(path)
    if os.path.islink(path) or not real.startswith(root + os.sep):
        raise Stop("not-allowed", "Only photos inside the library can be changed.")
    if not real.lower().endswith(JPEG_EXT):
        raise Stop("not-allowed", "Only JPEG photos can be changed.")
    if not os.path.isfile(real):
        raise Stop("missing", "The photo was not found on the drive.")
    if os.path.getsize(real) > MAX_BYTES:
        raise Stop("not-allowed", "This file is too large to change safely.")
    if len(os.path.basename(real)) + 10 > 255:
        raise Stop("not-allowed", "This file's name is too long to change it safely.")
    return real


def take_lock(cfg):
    """One writer at a time, and never during the nightly scan (it holds the same lock)."""
    os.makedirs(os.path.dirname(cfg["lockFile"]), exist_ok=True)
    fh = open(cfg["lockFile"], "a")
    if fcntl:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as err:
            if err.errno in (errno.EWOULDBLOCK, errno.EACCES):
                fh.close()
                raise Stop("busy", "The nightly photo scan is running. Try again when it has finished.")
            raise
    return fh


def sync_dir(path):
    if os.name != "posix":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read_file(path):
    with open(path, "rb") as fh:
        return fh.read()


# ---------------------------------------------------------------------------------------------
# The change
# ---------------------------------------------------------------------------------------------
def set_field(cfg, path, field, value, first_write=False):
    spec = FIELDS[field]
    if value not in spec["values"]:
        raise Stop("not-allowed", f"{field} must be one of {sorted(spec['values'])}.")
    tag = spec["tag"]
    blocked = gate(cfg, first_write)
    if blocked:
        raise Stop(*blocked)
    photo = checked_path(cfg, path)
    folder, name = os.path.split(photo)
    temp, old = (os.path.join(folder, f".{name}.{ext}") for ext in (NEW, OLD))
    lock = take_lock(cfg)
    swapping = False

    def on_signal(_signum, _frame):
        if not swapping:  # before the swap, stop and tidy up; during it, finish first
            raise Stop("interrupted", "The change was interrupted; the photo is unchanged.")

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, on_signal)
    started = time.time()
    try:
        for leftover in (temp, old):
            if os.path.lexists(leftover):
                raise Stop("needs-attention", f"An interrupted change left {os.path.basename(leftover)} beside this photo.")
        before_stat = os.stat(photo)
        original = read_file(photo)
        original_core = outside_xmp_hash(original)
        original_tags = xmp_tags(cfg, original)
        previous = rating_of(original_tags)
        if tag in original_tags and float(original_tags[tag]) == value or (tag not in original_tags and previous == value):
            return {"ok": True, "changed": False, "path": photo, "rating": value, "previous": previous}
        if shutil.disk_usage(folder).free < 2 * len(original) + 50 * 1024 * 1024:
            raise Stop("no-space", "There is not enough free space on the photo drive.")

        # 1. the new version, beside the original
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        try:
            with os.fdopen(fd, "wb") as out, open(photo, "rb") as src:
                r = tool(cfg, ["-q", f"-{tag}={value}", "-"], stdin=src, stdout=out)
                out.flush()
                os.fsync(out.fileno())
            if r.returncode != 0:
                raise Stop("tool-failed", "The metadata tool reported an error: " + r.stderr.decode("utf-8", "replace").strip()[:200])
            os.utime(temp, ns=(before_stat.st_atime_ns, before_stat.st_mtime_ns))
            test_hook("after-temp", temp)

            # 2. prove it before the original is touched
            new = read_file(temp)
            if outside_xmp_hash(new) != original_core:
                raise Stop("verify-failed", "The new version differed outside the metadata, so it was discarded.")
            new_tags = xmp_tags(cfg, new)
            if rating_of(new_tags) != value or float(new_tags.get(tag, -999)) != value:
                raise Stop("verify-failed", "The new value did not read back, so it was discarded.")
            if comparable(new_tags, {tag}) != comparable(original_tags, {tag}):
                raise Stop("verify-failed", "Other metadata would have changed, so the new version was discarded.")
            new_hash = hashlib.sha256(new).hexdigest()
            now = os.stat(photo)
            if (now.st_size, now.st_mtime_ns) != (before_stat.st_size, before_stat.st_mtime_ns):
                raise Stop("changed-meanwhile", "The photo changed while it was being updated, so nothing was saved.")
            test_hook("before-swap", temp)

            # 3. swap: from here a signal cannot stop us half way
            swapping = True
            os.rename(photo, old)
            test_hook("after-move-old")
            try:
                os.rename(temp, photo)
                sync_dir(folder)
                test_hook("after-move-new")
                final = read_file(photo)
                if hashlib.sha256(final).hexdigest() != new_hash or rating_of(xmp_tags(cfg, final)) != value:
                    raise Stop("verify-failed", "The saved photo did not match, so the original was put back.")
            except (Stop, OSError) as err:
                restore(photo, temp, old, hashlib.sha256(original).hexdigest())
                sync_dir(folder)
                raise err if isinstance(err, Stop) else Stop("write-failed", f"The drive reported an error ({err}); the original was put back.")
            test_hook("after-verify")

            # 4. the verified photo is in place; the old version can go
            warning = None
            try:
                os.unlink(old)
                sync_dir(folder)
            except OSError as err:
                warning = f"Saved, but {os.path.basename(old)} could not be removed ({err})."
            test_hook("after-unlink")
            result = {"ok": True, "changed": True, "path": photo, "rating": value, "previous": previous, "seconds": round(time.time() - started, 2)}
            if warning:
                result["warning"] = warning
            return result
        finally:
            if not swapping and os.path.lexists(temp):
                os.unlink(temp)
    finally:
        lock.close()


def restore(photo, temp, old, original_hash):
    """Put the original back after a failed swap; refuse to guess if that cannot be proved."""
    try:
        if os.path.lexists(old):
            if os.path.lexists(photo):
                os.rename(photo, temp)
            os.rename(old, photo)
        if hashlib.sha256(read_file(photo)).hexdigest() != original_hash:
            raise OSError("the restored file does not match the original")
        if os.path.lexists(temp):
            os.unlink(temp)
    except OSError as err:
        raise Stop("needs-attention", f"The original could not be restored automatically ({err}). Nothing was deleted.")


def strays(cfg):
    found = []
    for folder, dirs, files in os.walk(cfg["root"]):
        for name in files:
            if name.startswith(".") and name.endswith((f".{NEW}", f".{OLD}")):
                found.append(os.path.join(folder, name))
    return sorted(found)


def main(argv):
    first_write = "--first-write" in argv
    args = [a for a in argv if a != "--first-write"]
    try:
        cfg = load_config()
        if args[:1] == ["status"] and len(args) == 1:
            blocked = gate(cfg)
            out = {"ok": True, "writable": not blocked, "code": blocked[0] if blocked else None, "reason": blocked[1] if blocked else None}
        elif args[:1] == ["read"] and len(args) == 2:
            photo = checked_path(cfg, args[1])
            out = {"ok": True, "path": photo, "rating": rating_of(xmp_tags(cfg, read_file(photo)))}
        elif args[:1] == ["set-rating"] and len(args) == 3 and args[2] in ("0", "1", "5"):
            out = set_field(cfg, args[1], "rating", int(args[2]), first_write)
        elif args[:1] == ["strays"] and len(args) == 1:
            found = strays(cfg)
            out = {"ok": True, "count": len(found), "files": found}
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except Stop as stop:
        out = {"ok": False, "code": stop.code, "message": stop.message}
    except OSError as err:
        out = {"ok": False, "code": "write-failed", "message": f"The drive reported an error ({err}). The photo is unchanged unless `strays` lists it."}
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
