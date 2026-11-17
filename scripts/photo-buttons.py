#!/usr/bin/env python3
"""photo-buttons.py - the button board service (slideshow layer R17, backlog L1).

Reads the 3-key + knob USB board directly (python3-evdev), takes it exclusively (EVIOCGRAB), so its
keys never reach Chromium, and turns each input into a photo API call (principle 12: the API is the
only control route). The mapping is config/buttons.json in the repo.

    photo-buttons.py                  run the service (systemd: photo-buttons.service)
    photo-buttons.py --learn [SECS]   show the input devices and print every key they send
                                      (stop the service first: sudo systemctl stop photo-buttons)
    photo-buttons.py --check          check config/buttons.json and exit

Which device: the one named in the config (USB vendor/product ids, or a name), else every USB input
device that can send at least one mapped key. Short and long presses: a key with a "long" action
fires its "press" action on release if it was held less than long_press_ms, else the "long" action
as soon as the time is reached; a key without one fires on press. Auto-repeat is ignored.
Devices are looked for again every few seconds, so the board can be plugged in at any time.
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.environ.get("BUTTONS_CONFIG", os.path.join(HERE, "..", "config", "buttons.json"))


def log(msg):
    print(msg, flush=True)


def load_config(path=CONFIG):
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    errors = []
    for key, m in cfg.get("map", {}).items():
        if not key.startswith("KEY_") and not key.startswith("BTN_"):
            errors.append(f"{key}: key names look like KEY_F13 (see --learn)")
        for kind in ("press", "long"):
            a = m.get(kind)
            if a is None:
                continue
            if not isinstance(a, dict) or a.get("method", "POST") not in ("GET", "POST", "PATCH", "PUT", "DELETE") or not str(a.get("path", "")).startswith("/api/"):
                errors.append(f"{key}.{kind}: needs {{\"method\": \"POST\", \"path\": \"/api/...\", \"body\"?: {{...}}}}")
        if "press" not in m and "long" not in m:
            errors.append(f"{key}: needs press and/or long")
    if errors:
        raise ValueError("config/buttons.json: " + "; ".join(errors))
    return cfg


class Mapper:
    """Turns key events (name, value 1 down / 0 up / 2 repeat, time in s) into actions."""

    def __init__(self, cfg):
        self.map = cfg.get("map", {})
        self.long_s = cfg.get("long_press_ms", 700) / 1000.0
        self.down = {}  # key -> (time pressed, long fired)

    def keys(self):
        return set(self.map)

    def event(self, key, value, t):
        m = self.map.get(key)
        if m is None or value == 2:
            return []
        if value == 1:
            if "long" not in m:
                return [m["press"]]
            self.down[key] = [t, False]
            return []
        if value == 0 and key in self.down:
            pressed, fired = self.down.pop(key)
            if fired:
                return []
            if t - pressed >= self.long_s:
                return [m["long"]]
            return [m["press"]] if "press" in m else []
        return []

    def tick(self, t):
        """Call often: fires long presses while the key is still held."""
        out = []
        for key, st in self.down.items():
            if not st[1] and t - st[0] >= self.long_s:
                st[1] = True
                out.append(self.map[key]["long"])
        return out


def call(api, action):
    body = action.get("body")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(api + action["path"], data=data, method=action.get("method", "POST"),
                                 headers={"content-type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except Exception as e:  # the API may be restarting; a button press is not worth retrying
        log(f"API call {action.get('method', 'POST')} {action['path']} failed: {e}")
        return None


def find_devices(evdev, cfg, keycodes):
    want = cfg.get("device") or {}
    found = []
    for path in evdev.list_devices():
        try:
            d = evdev.InputDevice(path)
        except OSError:
            continue
        info = d.info
        if want.get("vendor") and want.get("product"):
            ok = info.vendor == int(str(want["vendor"]), 16) and info.product == int(str(want["product"]), 16)
        elif want.get("name"):
            ok = want["name"].lower() in d.name.lower()
        else:
            caps = set(d.capabilities().get(evdev.ecodes.EV_KEY, []))
            ok = "usb" in (d.phys or "") and bool(caps & keycodes)
        if ok:
            found.append(d)
        else:
            d.close()
    return found


def run(cfg):
    import evdev  # python3-evdev (config/packages.txt)
    from select import select
    api = os.environ.get("PHOTO_API", cfg.get("api", "http://localhost:3000"))
    mapper = Mapper(cfg)
    keycodes = {evdev.ecodes.ecodes[k] for k in mapper.keys() if k in evdev.ecodes.ecodes}
    devices = {}
    last_scan = 0
    log(f"photo-buttons: {len(mapper.keys())} inputs mapped, long press {mapper.long_s:.1f} s, API {api}")
    while True:
        now = time.monotonic()
        if now - last_scan > 5:
            last_scan = now
            for d in find_devices(evdev, cfg, keycodes):
                if d.path in devices:
                    d.close()
                    continue
                try:
                    d.grab()  # exclusive: Chromium (and anything else) gets nothing from the board
                    devices[d.path] = d
                    log(f"board found: {d.name} ({d.path}, USB {d.info.vendor:04x}:{d.info.product:04x}), taken exclusively")
                except OSError as e:
                    log(f"cannot take {d.name} ({d.path}): {e}")
                    d.close()
        r = select(list(devices.values()), [], [], 0.05)[0] if devices else (time.sleep(0.2) or [])
        for d in r:
            try:
                for ev in d.read():
                    if ev.type != evdev.ecodes.EV_KEY:
                        continue
                    names = evdev.ecodes.KEY.get(ev.code) or evdev.ecodes.BTN.get(ev.code)
                    for name in names if isinstance(names, list) else [names]:
                        for action in mapper.event(name, ev.value, time.monotonic()):
                            log(f"{name}: {action.get('method', 'POST')} {action['path']}")
                            call(api, action)
            except OSError:
                log(f"board gone: {d.path}")
                devices.pop(d.path, None)
        for action in mapper.tick(time.monotonic()):
            log(f"long press: {action.get('method', 'POST')} {action['path']}")
            call(api, action)


def learn(seconds):
    import evdev
    from select import select
    devs = []
    log("Input devices:")
    for path in evdev.list_devices():
        d = evdev.InputDevice(path)
        log(f"  {path}: {d.name!r} USB {d.info.vendor:04x}:{d.info.product:04x} phys {d.phys!r}")
        try:
            d.grab()
            devs.append(d)
        except OSError as e:
            log(f"    (busy, not read: {e}; is photo-buttons running?)")
    log(f"Press each key and turn the knob; printing for {seconds} s. Put the names into config/buttons.json.")
    end = time.time() + seconds
    while time.time() < end:
        for d in select(devs, [], [], 0.5)[0]:
            for ev in d.read():
                if ev.type == evdev.ecodes.EV_KEY and ev.value in (0, 1):
                    name = evdev.ecodes.KEY.get(ev.code) or evdev.ecodes.BTN.get(ev.code)
                    log(f"  {d.name}: {name} {'down' if ev.value else 'up'}  (device ids: vendor {d.info.vendor:04x} product {d.info.product:04x})")
    for d in devs:
        d.ungrab()


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__)
        return
    cfg = load_config()
    if args and args[0] == "--check":
        print(f"ok: {len(cfg['map'])} inputs mapped")
        return
    if args and args[0] == "--learn":
        learn(int(args[1]) if len(args) > 1 else 60)
        return
    run(cfg)


if __name__ == "__main__":
    main()
