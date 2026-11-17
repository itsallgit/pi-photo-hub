---
name: button-board
description: Use when the owner talks about the button board or knob ("the buttons don't work", "make the knob change the speed", "what does the middle key do?", "I plugged the board in"), wants to change what a key does, or programs a new board. Covers checking the photo-buttons service, finding what the board sends (learn), changing config/buttons.json, and testing with a virtual board. Read-only to check; a mapping change is a repo change deployed with update.sh.
---

# The button board

A small USB board (3 keys and a knob that also clicks) in front of the shelf. `photo-buttons.service` on the Pi reads it directly, takes it exclusively (its keys never reach Chromium), and turns each input into a photo API call (principle 12). The mapping is `config/buttons.json`; the service is `scripts/photo-buttons.py`. Facts: `docs/architecture.md`, "Slideshow layer", "Buttons". Requirements: R17 in `docs/slideshow-layer-build.md`.

**Agreed first map:** KEY1 back, KEY2 pause/play (long: screen off/on), KEY3 next (long: star the photo), knob left slower, knob right faster, knob press next overlay style. The board should be programmed (Windows tool, README "Button board") to send F13 to F18; its multimedia keys are mapped the same way in case it sends those.

## Check (read-only, the `pi-access` skill)

1. `systemctl is-active photo-buttons` and `journalctl -u photo-buttons -n 30 --no-pager`: "board found: ... taken exclusively" means it sees the board; each press logs a line with the API call.
2. Nothing in the journal when a key is pressed: the board sends keys that are not mapped, or it is not seen as USB. Find out with **learn** (below).

## Learn what the board sends

The service holds the board, so learn needs it stopped for a minute (a change to the Pi: tell the owner; it is restarted right after):
```
sudo systemctl stop photo-buttons; python3 ~/pi-photo-hub/scripts/photo-buttons.py --learn 60; sudo systemctl start photo-buttons
```
The owner presses each key and turns the knob; it prints key names (`KEY_F13`, `KEY_VOLUMEUP`, ...) and the USB ids. The owner cannot type on the Pi, but can press the board's keys.

## Change what a key does

Edit `config/buttons.json` in the repo (each key: `press` and optionally `long`, an API call `{ method, path, body? }`; any photo API endpoint, see `docs/architecture.md`). If the board's ids are known, set `device.vendor` and `device.product` (hex) so only it is taken. Check with `python scripts/photo-buttons.py --check` and the unit tests (`scripts/check.sh` runs `scripts/test/test_buttons.py`). Commit, push, deploy with the `apply-changes` skill (agreement gate; the update restarts the service).

## Test without the board

`sudo python3 ~/pi-photo-hub/scripts/test/buttons-virtual.py` creates a temporary virtual USB board, checks every input reaches the API and that Chromium gets nothing (F5 would reload the shelf page), puts back what it changed and removes the device. It switches the screen off and on once (KEY2 long) and moves the slideshow; say so to the owner first.

## Undo

A mapping change: revert the commit and deploy. To stop the board doing anything: `sudo systemctl stop photo-buttons` (until the next update or boot; to keep it off, a repo change).

## Do not

- Map a key to anything that is not a photo API call (no shell commands, no power: power stays SSH-only, `pi-power` skill).
- Run two copies of the service (only one can take the board).
- Ask the owner to type on the Pi.

## Links

`scripts/photo-buttons.py`, `config/buttons.json`, `systemd/photo-buttons.service`, `scripts/test/buttons-virtual.py`, README "Button board", `docs/architecture.md` "Slideshow layer".

## Last verified

2026-11-18: written with the service; tested on the Pi with the virtual board (see the build log in `docs/slideshow-layer-build.md`). The real board has not been plugged in yet (owner's checklist). Not cold-tested.
