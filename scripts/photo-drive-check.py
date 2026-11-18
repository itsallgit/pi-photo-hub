#!/usr/bin/env python3
"""photo-drive-check.py - READ-ONLY consistency check of the exFAT photo drive (hard rule 1).

Needs root to read the device. It opens the device read-only, reads the file system's own records
and changes nothing; it is not a repair tool and does not need the drive unmounted. A photo may be
changed only while this check has passed recently (scripts/photo-metadata.py).

    sudo python3 photo-drive-check.py [--device /dev/sda1] [--out FILE] [--lock FILE]

It checks that the boot records are valid, that every cluster a file uses is marked used (a new file
could otherwise be written over it), and that no cluster belongs to two files. It does not read the
photos' contents or test for bad sectors. Exit 0 passed, 1 problems found, 2 could not run, 3 skipped (lock busy; --out is left as it was).
"""
import array
import json
import os
import struct
import sys
import time

try:
    import fcntl
except ImportError:
    fcntl = None

STRAY_ENDINGS = (".pph-new", ".pph-old")
FATAL = ("outOfRange", "chainBroken", "chainShort", "entryChecksum", "entryMalformed", "sizeInvalid")


class Volume:
    def __init__(self, device):
        self.fd = os.open(device, os.O_RDONLY)
        b = self.read(0, 512)
        if b[3:11] != b"EXFAT   ":
            raise ValueError("this is not an exFAT volume")
        self.fat_offset, self.fat_length, self.heap, self.count, self.root = struct.unpack_from("<IIIII", b, 80)
        self.flags = struct.unpack_from("<H", b, 106)[0]
        self.bps = 1 << b[108]
        self.cluster = self.bps << b[109]
        raw = self.read(self.fat_offset * self.bps, min(self.fat_length * self.bps, (self.count + 2) * 4))
        self.fat = array.array("I")
        self.fat.frombytes(raw)
        if sys.byteorder != "little" or len(self.fat) != self.count + 2:
            raise ValueError("the cluster table has an unexpected size")

    def read(self, offset, size):
        return os.pread(self.fd, size, offset)

    def clusters(self, numbers, limit=None):
        data = bytearray()
        for c in numbers:
            data += self.read(self.heap * self.bps + (c - 2) * self.cluster, self.cluster)
        return bytes(data if limit is None else data[:limit])

    def boot_ok(self, first_sector):
        region = self.read(first_sector * self.bps, 12 * self.bps)
        total = 0
        for i, x in enumerate(region[:11 * self.bps]):
            if i not in (106, 107, 112):
                total = ((((total >> 1) | (total << 31)) & 0xFFFFFFFF) + x) & 0xFFFFFFFF
        return all(struct.unpack_from("<I", region, 11 * self.bps + k)[0] == total for k in range(0, self.bps, 4))


def check(device):
    started = time.time()
    v = Volume(device)
    problems = {}
    samples = {}

    def note(kind, where, amount=1):
        problems[kind] = problems.get(kind, 0) + amount
        samples.setdefault(kind, [])
        if len(samples[kind]) < 5:
            samples[kind].append(where)

    def chain(first, length, contiguous, who):
        need = (length + v.cluster - 1) // v.cluster
        if first == 0 or need == 0:
            return []
        if contiguous:
            if first < 2 or first + need - 1 > v.count + 1:
                note("outOfRange", who)
                return []
            return range(first, first + need)
        out, c = [], first
        while True:
            if c < 2 or c > v.count + 1:
                note("chainBroken", who)
                return out
            out.append(c)
            if len(out) > v.count:
                note("chainBroken", who)
                return out
            c = v.fat[c]
            if c == 0xFFFFFFFF:
                break
            if c == 0xFFFFFFF7:
                note("chainBroken", who)
                return out
        if len(out) < need:
            note("chainShort", who)
        elif len(out) > need:
            note("chainLong", who)
        return out

    claimed = bytearray(v.count)
    bitmap = b""
    used = 0

    def claim(numbers, who):
        nonlocal used
        free = twice = 0
        for c in numbers:
            i = c - 2
            if claimed[i]:
                twice += 1
            else:
                claimed[i] = 1
                used += 1
            if not bitmap[i >> 3] >> (i & 7) & 1:
                free += 1
        if free:
            note("usedButMarkedFree", who, free)
        if twice:
            note("claimedTwice", who, twice)

    root_clusters, c = [], v.root
    while 2 <= c <= v.count + 1 and len(root_clusters) < v.count:
        root_clusters.append(c)
        c = v.fat[c]
        if c == 0xFFFFFFFF:
            break
    root = v.clusters(root_clusters)
    bitmap_entry = upcase_entry = None
    for i in range(0, len(root), 32):
        kind = root[i]
        if kind == 0:
            break
        if kind == 0x81 and not root[i + 1] & 1 and bitmap_entry is None:
            bitmap_entry = struct.unpack_from("<IQ", root, i + 20)
        elif kind == 0x82:
            upcase_entry = struct.unpack_from("<IQ", root, i + 20)
    if not bitmap_entry:
        raise ValueError("the volume has no allocation bitmap")
    bitmap_clusters = chain(bitmap_entry[0], bitmap_entry[1], False, "$bitmap")
    bitmap = v.clusters(bitmap_clusters, bitmap_entry[1])
    if len(bitmap) < (v.count + 7) // 8:
        raise ValueError("the allocation bitmap is too short")
    claim(root_clusters, "$root")
    claim(bitmap_clusters, "$bitmap")
    if upcase_entry:
        claim(chain(upcase_entry[0], upcase_entry[1], False, "$upcase"), "$upcase")

    files = folders = jpegs = 0
    strays = []
    stack = [("", root)]
    while stack:
        path, d = stack.pop()
        i = 0
        while i + 32 <= len(d):
            kind = d[i]
            if kind == 0:
                break
            if kind != 0x85:
                i += 32
                continue
            count = d[i + 1]
            end = i + 32 * (count + 1)
            if count < 2 or end > len(d) or d[i + 32] != 0xC0:
                note("entryMalformed", path or "/")
                i += 32
                continue
            total = 0
            for k, x in enumerate(d[i:end]):
                if k not in (2, 3):
                    total = (((total >> 1) | (total << 15)) & 0xFFFF) + x & 0xFFFF
            attributes = struct.unpack_from("<H", d, i + 4)[0]
            stream = i + 32
            flags, name_length = d[stream + 1], d[stream + 3]
            valid = struct.unpack_from("<Q", d, stream + 8)[0]
            first, size = struct.unpack_from("<IQ", d, stream + 20)
            name_bytes = b"".join(d[j + 2:j + 32] for j in range(i + 64, end, 32) if d[j] == 0xC1)
            name = name_bytes[:name_length * 2].decode("utf-16-le", "replace")
            where = f"{path}/{name}"
            if total != struct.unpack_from("<H", d, i + 2)[0]:
                note("entryChecksum", where)
            if valid > size:
                note("sizeInvalid", where)
            numbers = chain(first, size, bool(flags & 2), where) if flags & 1 else []
            claim(numbers, where)
            if attributes & 0x10:
                folders += 1
                stack.append((where, v.clusters(numbers, size)))
            else:
                files += 1
                low = name.lower()
                jpegs += low.endswith((".jpg", ".jpeg"))
                if name.startswith(".") and low.endswith(STRAY_ENDINGS):
                    strays.append(where)
            i = end
    marked = (int.from_bytes(bitmap[:(v.count + 7) // 8], "little") & ((1 << v.count) - 1)).bit_count()
    if not v.boot_ok(0):
        note("bootRecord", "main")
    if not v.boot_ok(12):
        note("bootRecord", "backup")
    if v.flags & 4:
        note("mediaFailureFlag", "volume flags")
    bad = [k for k in problems if k in FATAL + ("usedButMarkedFree", "claimedTwice", "bootRecord", "mediaFailureFlag")]
    os.close(v.fd)
    return {
        "ok": not bad,
        "at": int(time.time()),
        "seconds": round(time.time() - started, 1),
        "device": device,
        "folders": folders,
        "files": files,
        "jpegs": jpegs,
        "clustersUsedByFiles": used,
        "clustersMarkedUsed": marked,
        "clustersMarkedButUnowned": marked - used,
        "dirtyFlag": bool(v.flags & 2),
        "problems": problems,
        "failedChecks": sorted(bad),
        "samples": samples,
        "strays": strays,
    }


def main(argv):
    def option(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    device, out, lock = option("--device", "/dev/sda1"), option("--out"), option("--lock")
    holder = None
    try:
        if lock and fcntl:  # no photo is being changed while the records are read
            holder = open(lock, "a")
            for attempt in range(30):
                try:
                    fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if attempt == 29:  # the nightly scan runs; it does this check itself afterwards
                        print(json.dumps({"ok": False, "skipped": "the lock is busy"}))
                        return 3
                    time.sleep(1)
        result = check(device)
    except (OSError, ValueError, IndexError, struct.error) as err:
        result = {"ok": False, "at": int(time.time()), "device": device, "failedChecks": ["couldNotRun"], "error": str(err)}
    if out:
        temp = f"{out}.tmp-{os.getpid()}"
        with open(temp, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        os.chmod(temp, 0o644)
        os.replace(temp, out)
    print(json.dumps(result, ensure_ascii=False))
    if holder:
        holder.close()
    if "error" in result:
        return 2
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
