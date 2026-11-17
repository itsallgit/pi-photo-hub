#!/usr/bin/env python3
"""buttons-virtual.py - test the running photo-buttons service on the Pi with a temporary virtual
board (slideshow layer M5.2). Needs root for /dev/uinput:

    sudo python3 ~/pi-photo-hub/scripts/test/buttons-virtual.py

It creates a virtual USB keyboard that sends F13..F18 (as the programmed board will), waits until
the service has taken it, presses each input and checks the photo API reacted, puts back what it
changed (position, pause, interval, overlay style, screen), sends F5 to prove Chromium gets nothing
(a reload would reconnect the shelf's event stream), and removes the device. Changes nothing else.
"""
import json
import subprocess
import sys
import time
import urllib.request

import evdev
from evdev import UInput, ecodes as e

API = "http://localhost:3000"


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"content-type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def until(fn, what, secs=10):
    end = time.time() + secs
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.2)
    raise AssertionError(f"timed out: {what}")


def journal_since(t0):
    return subprocess.run(["journalctl", "-u", "photo-buttons", "--since", t0, "--no-pager", "-o", "cat"], capture_output=True, text=True).stdout


def main():
    fails = 0

    def check(name, fn):
        nonlocal fails
        try:
            note = fn()
            print(f"ok   {name}{': ' + note if note else ''}", flush=True)
        except Exception as ex:  # report and carry on
            fails += 1
            print(f"FAIL {name}: {ex}", flush=True)

    t0 = time.strftime("%Y-%m-%d %H:%M:%S")
    start = api("GET", "/api/player")
    keep = {"position": start["position"], "paused": start["paused"], "interval": start["settings"]["interval"], "overlayStyle": start["settings"]["overlayStyle"]}
    shelf = [v for v in api("GET", "/api/status")["viewers"] if v["role"] == "shelf"]
    keys = [e.KEY_F13, e.KEY_F14, e.KEY_F15, e.KEY_F16, e.KEY_F17, e.KEY_F18, e.KEY_F5]
    ui = UInput({e.EV_KEY: keys}, name="pi-photo-hub test board", vendor=0x1209, product=0x0001, phys="usb-pi-photo-hub-test/input0")

    def press(code, hold=0.05):
        ui.write(e.EV_KEY, code, 1); ui.syn()
        time.sleep(hold)
        ui.write(e.EV_KEY, code, 0); ui.syn()
        time.sleep(0.4)

    try:
        check("the service takes the board exclusively", lambda: until(lambda: "pi-photo-hub test board" in journal_since(t0) and "taken exclusively" in journal_since(t0), "the service to find the board", 15) and None)

        def nxt():
            p = api("GET", "/api/player")["position"]
            press(e.KEY_F15)
            until(lambda: api("GET", "/api/player")["position"] == (p + 1) % api("GET", "/api/player")["count"], "next")
            press(e.KEY_F13)
            until(lambda: api("GET", "/api/player")["position"] == p, "back")
        check("KEY3 next, KEY1 back", nxt)

        def pause():
            press(e.KEY_F14)
            until(lambda: api("GET", "/api/player")["paused"], "paused")
            press(e.KEY_F14)
            until(lambda: not api("GET", "/api/player")["paused"], "playing again")
        check("KEY2 short: pause, play", pause)

        def knob():
            i = api("GET", "/api/player")["settings"]["interval"]
            press(e.KEY_F16)
            slower = until(lambda: api("GET", "/api/player")["settings"]["interval"] > i and api("GET", "/api/player")["settings"]["interval"], "slower")
            press(e.KEY_F18)
            until(lambda: api("GET", "/api/player")["settings"]["interval"] < slower, "faster")
            s = api("GET", "/api/player")["settings"]["overlayStyle"]
            press(e.KEY_F17)
            until(lambda: api("GET", "/api/player")["settings"]["overlayStyle"] != s, "overlay style")
            return f"interval {i} -> {slower} -> back; overlay style {s} -> next"
        check("knob left slower, right faster, press overlay style", knob)

        def long_press():
            before = api("GET", "/api/screen")["wantedOff"]
            press(e.KEY_F14, hold=1.0)
            until(lambda: api("GET", "/api/screen")["wantedOff"] != before, "the screen toggled")
            time.sleep(2)
            press(e.KEY_F14, hold=1.0)
            until(lambda: api("GET", "/api/screen")["wantedOff"] == before, "the screen back")
            return "screen off, then on"
        check("KEY2 long: screen off and on", long_press)

        def chromium_blind():
            press(e.KEY_F5)
            time.sleep(4)
            now = [v for v in api("GET", "/api/status")["viewers"] if v["role"] == "shelf"]
            assert now == shelf, f"shelf viewer changed (Chromium reloaded?): {shelf} -> {now}"
            return f"shelf viewer connected since {now[0]['since'] if now else '?'}, unchanged"
        check("Chromium gets nothing (F5 would reload the shelf page)", chromium_blind)
    finally:
        ui.close()
        api("PATCH", "/api/player/settings", {"interval": keep["interval"], "overlayStyle": keep["overlayStyle"]})
        if keep["paused"]:
            api("POST", "/api/player/pause")
        print("virtual board removed; settings put back", flush=True)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
