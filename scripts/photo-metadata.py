#!/usr/bin/env python3
"""photo-metadata.py - the project's ONE way to change a photo file (hard rule 1, principle 11).

It changes embedded XMP metadata of a JPEG in the library and nothing else: never the pixels, never
another metadata block, never a file's name or place. Only the fields listed in FIELDS can be set;
adding a field (tags, for example) means extending FIELDS and its tests.

    photo-metadata.py status                       may photos be changed right now?
    photo-metadata.py read PATH                    the rating stored in a photo
    photo-metadata.py set-rating PATH 0|1|5        0 no rating, 1 skipped, 5 favourite
    photo-metadata.py strays                       leftover work files after an interruption
    photo-metadata.py recover PATH                 finish cleaning up after an interruption (asked for
                                                   by a person: the `photo-metadata` skill, "Recovery")

    --first-write  (set-rating) ignores only the "writesEnabled" switch, for the owner's agreed
                   first test photo. Every other check still applies.

Prints one JSON object. Exit 0 when it worked, 1 when it did not; on failure the photo is as it was.

How a change is made. The photo's own file is kept, so its created and modified dates stay as they
were (a replacement file would get a new created date, which cannot be set back on Linux):
 1. The new version is written beside the photo to ".NAME.pph-new". The photo is not touched.
 2. It is checked: the new value reads back, every byte outside the XMP blocks is identical
    (pixels, EXIF, the data phones add after the image), and every other XMP value is the same.
 3. A full copy of the photo is written to ".NAME.pph-old" and checked.
 4. The verified contents are written into the photo's existing file, and its modified date restored.
 5. The photo is checked again, dates included. If that fails, the original is written back.
 6. Both work files are removed.
A complete copy exists at every moment. After a power cut, `strays` lists what is left; nothing is
removed automatically, and that photo refuses changes until `recover` has been run for it.
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


def test_hook(point, target=None):
    """Fault injection for the tests; does nothing unless a test sets these variables."""
    if os.environ.get("PHOTO_METADATA_TEST_CRASH") == point:
        os._exit(99)
    if target and os.environ.get("PHOTO_METADATA_TEST_CORRUPT") == point:
        with open(target, "r+b") as fh:
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


def sha(data):
    return hashlib.sha256(data).hexdigest()


def created_time(path):
    """The file's created date as the file system reports it, or None if it does not."""
    value = getattr(os.stat(path), "st_birthtime", None)
    if value is None and os.name == "posix":
        try:
            value = int(subprocess.run(["stat", "-c", "%W", path], capture_output=True, text=True, check=True).stdout.strip())
        except (OSError, ValueError, subprocess.CalledProcessError):
            return None
    return value or None


def write_new_file(path, data, times_ns):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "wb") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    os.utime(path, ns=times_ns)


def rewrite_in_place(path, data, times_ns):
    """Put data into the existing file, so the file keeps its identity and created date."""
    with open(path, "r+b") as fh:
        half = len(data) // 2
        fh.write(data[:half])
        fh.flush()
        test_hook("mid-rewrite")
        fh.write(data[half:])
        fh.truncate()
        fh.flush()
        os.fsync(fh.fileno())
    os.utime(path, ns=times_ns)
    with open(path, "r+b") as fh:  # the restored date reaches the disk too
        os.fsync(fh.fileno())


def dates_of(path):
    return os.stat(path).st_mtime_ns, created_time(path)


# ---------------------------------------------------------------------------------------------
# The change
# ---------------------------------------------------------------------------------------------
def work_files(photo):
    folder, name = os.path.split(photo)
    return folder, os.path.join(folder, f".{name}.{NEW}"), os.path.join(folder, f".{name}.{OLD}")


def set_field(cfg, path, field, value, first_write=False):
    spec = FIELDS[field]
    if value not in spec["values"]:
        raise Stop("not-allowed", f"{field} must be one of {sorted(spec['values'])}.")
    tag = spec["tag"]
    blocked = gate(cfg, first_write)
    if blocked:
        raise Stop(*blocked)
    photo = checked_path(cfg, path)
    folder, temp, old = work_files(photo)
    lock = take_lock(cfg)
    rewriting = False
    made = []  # only work files this run created are ever cleaned up by it

    def on_signal(_signum, _frame):
        if not rewriting:  # before the rewrite, stop and tidy up; during it, finish first
            raise Stop("interrupted", "The change was interrupted; the photo is unchanged.")

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, on_signal)
    started = time.time()
    try:
        for leftover in (temp, old):
            if os.path.lexists(leftover):
                raise Stop("needs-attention", f"An interrupted change left {os.path.basename(leftover)} beside this photo.")
        before = os.stat(photo)
        times = (before.st_atime_ns, before.st_mtime_ns)
        dates = dates_of(photo)
        original = read_file(photo)
        original_hash = sha(original)
        original_core = outside_xmp_hash(original)
        original_tags = xmp_tags(cfg, original)
        previous = rating_of(original_tags)
        if tag in original_tags and float(original_tags[tag]) == value or (tag not in original_tags and previous == value):
            return {"ok": True, "changed": False, "path": photo, "rating": value, "previous": previous}
        if shutil.disk_usage(folder).free < 3 * len(original) + 50 * 1024 * 1024:
            raise Stop("no-space", "There is not enough free space on the photo drive.")

        # 1. the new version, beside the photo
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        made.append(temp)
        with os.fdopen(fd, "wb") as out, open(photo, "rb") as src:
            r = tool(cfg, ["-q", f"-{tag}={value}", "-"], stdin=src, stdout=out)
            out.flush()
            os.fsync(out.fileno())
        if r.returncode != 0:
            raise Stop("tool-failed", "The metadata tool reported an error: " + r.stderr.decode("utf-8", "replace").strip()[:200])
        test_hook("after-temp", temp)

        # 2. prove it before the photo is touched
        new = read_file(temp)
        if outside_xmp_hash(new) != original_core:
            raise Stop("verify-failed", "The new version differed outside the metadata, so it was discarded.")
        new_tags = xmp_tags(cfg, new)
        if rating_of(new_tags) != value or float(new_tags.get(tag, -999)) != value:
            raise Stop("verify-failed", "The new value did not read back, so it was discarded.")
        if comparable(new_tags, {tag}) != comparable(original_tags, {tag}):
            raise Stop("verify-failed", "Other metadata would have changed, so the new version was discarded.")
        new_hash = sha(new)
        test_hook("before-backup")

        # 3. a complete, checked copy of the photo
        made.append(old)
        write_new_file(old, original, times)
        sync_dir(folder)
        test_hook("backup-written", old)
        now = os.stat(photo)
        if sha(read_file(old)) != original_hash or sha(read_file(photo)) != original_hash or (now.st_size, now.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            raise Stop("verify-failed", "The safety copy did not match the photo, so nothing was changed.")
        test_hook("after-backup")

        # 4. and 5. the photo's own file: from here a signal cannot stop us half way
        rewriting = True
        try:
            rewrite_in_place(photo, new, times)
            test_hook("after-rewrite", photo)
            if sha(read_file(photo)) != new_hash or rating_of(xmp_tags(cfg, read_file(photo))) != value:
                raise Stop("verify-failed", "The saved photo did not match, so the original was written back.")
            if dates_of(photo) != dates:
                raise Stop("verify-failed", "The photo's dates would have changed, so the original was written back.")
        except (Stop, OSError) as err:
            restore(photo, old, original_hash, times)
            rewriting = False  # the original is back and proved: the work files can go
            raise err if isinstance(err, Stop) else Stop("write-failed", f"The drive reported an error ({err}); the original was written back.")
        test_hook("after-verify")

        # 6. the verified photo is in place; the work files can go
        warning = None
        try:
            os.unlink(temp)
            os.unlink(old)
            sync_dir(folder)
        except OSError as err:
            warning = f"Saved, but a work file could not be removed ({err})."
        test_hook("after-unlink")
        result = {"ok": True, "changed": True, "path": photo, "rating": value, "previous": previous, "seconds": round(time.time() - started, 2)}
        if warning:
            result["warning"] = warning
        return result
    finally:
        if not rewriting:
            for leftover in made:
                if os.path.lexists(leftover):
                    os.unlink(leftover)
            sync_dir(folder)
        lock.close()


def restore(photo, old, original_hash, times):
    """Write the original back into the photo's file; refuse to guess if that cannot be proved."""
    try:
        data = read_file(old)
        if sha(data) != original_hash:
            raise OSError("the safety copy does not match the original")
        rewrite_in_place(photo, data, times)
        if sha(read_file(photo)) != original_hash:
            raise OSError("the restored file does not match the original")
    except OSError as err:
        raise Stop("needs-attention", f"The original could not be restored automatically ({err}). Nothing was deleted.")


def recover(cfg, path):
    """After an interruption: leave the photo complete, then remove its work files."""
    if cfg["requireMount"] and not os.path.ismount(cfg["mount"]):
        raise Stop("no-drive", "The photo drive is not mounted.")
    photo = checked_path(cfg, path)
    folder, temp, old = work_files(photo)
    lock = take_lock(cfg)
    try:
        has_new, has_old = os.path.lexists(temp), os.path.lexists(old)
        if not has_new and not has_old:
            return {"ok": True, "path": photo, "action": "nothing to recover"}
        current = read_file(photo)
        if has_old:
            saved = read_file(old)
            core = outside_xmp_hash(saved)  # stops here if the safety copy is not a whole JPEG
            new = read_file(temp) if has_new else None
            if sha(current) == sha(saved):
                action = "the original was intact"
            elif new is not None and sha(current) == sha(new) and outside_xmp_hash(new) == core:
                action = "the new version was complete"
            else:
                stat = os.stat(old)
                rewrite_in_place(photo, saved, (stat.st_atime_ns, stat.st_mtime_ns))
                if sha(read_file(photo)) != sha(saved):
                    raise Stop("needs-attention", "The original could not be written back. Nothing was deleted.")
                action = "the original was written back"
        else:
            outside_xmp_hash(current)  # the photo itself must be whole before its new version goes
            action = "the original was intact"
        for leftover in (temp, old):
            if os.path.lexists(leftover):
                os.unlink(leftover)
        sync_dir(folder)
        return {"ok": True, "path": photo, "action": action, "rating": rating_of(xmp_tags(cfg, read_file(photo)))}
    finally:
        lock.close()


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
        elif args[:1] == ["recover"] and len(args) == 2:
            out = recover(cfg, args[1])
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
