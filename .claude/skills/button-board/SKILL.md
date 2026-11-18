---
name: button-board
description: Use when the owner talks about the button board or knob ("the buttons don't work", "make the knob change the speed", "what does the middle key do?", "I plugged the board in"), wants to change what a key does, or programs a new board. Covers checking the photo-buttons service, finding what the board sends (learn), programming the board from the Pi, changing config/buttons.json, and testing with a virtual board. Read-only to check; a mapping change is a repo change deployed with update.sh.
---

# The button board

A small USB board (3 keys and a knob that also clicks) in front of the shelf. `photo-buttons.service` on the Pi reads it directly, takes it exclusively (its keys never reach Chromium), and turns each input into a photo API call (principle 12). The mapping is `config/buttons.json`; the service is `scripts/photo-buttons.py`. Facts: `docs/architecture.md`, "Slideshow layer", "Buttons". Requirements: R17 in `docs/slideshow-layer-build.md`.

**Agreed first map:** KEY1 back, KEY2 pause/play (long: screen off/on), KEY3 next (long: star on or off), knob left slower, knob right faster, knob press next overlay style. Every screen shows a brief toast for the knob's new speed and for KEY3's star on or off, a starred photo shows a small gold star, and back and next snap to the photo. The board is programmed to send F13 to F18 (`config/button-board.yaml`, "Program the board" below); its multimedia keys are mapped the same way in case a board sends those.

## Check (read-only, the `pi-access` skill)

1. `systemctl is-active photo-buttons` and `journalctl -u photo-buttons -n 30 --no-pager`: "board found: ... taken exclusively" means it sees the board; each press logs a line with the API call.
2. Nothing in the journal when a key is pressed: the board sends keys that are not mapped, or it is not seen as USB. Find out with **learn** (below). A new or factory-state board is the usual cause: ours sent the letter C from all six inputs until it was programmed.

## Learn what the board sends

The service holds the board, so learn needs it stopped for a minute (a change to the Pi: tell the owner; it is restarted right after):
```
sudo systemctl stop photo-buttons; python3 ~/pi-photo-hub/scripts/photo-buttons.py --learn 60; sudo systemctl start photo-buttons
```
The owner presses each key and turns the knob; it prints key names (`KEY_F13`, `KEY_VOLUMEUP`, ...) and the USB ids. The owner cannot type on the Pi, but can press the board's keys.

Without stopping the service: `/dev/hidraw0` to `2` still receive the board's raw reports while the service holds it (read them with `sudo`, read-only). A key report is `01 00 00 <HID usage> ...`: `06` is C, `68` to `6d` are F13 to F18.

## Program the board (from the Pi, no PC needed)

Needed once per board; the setting is stored in the board. It is a change to the board, so tell the owner. The slideshow and `photo-buttons` keep running: programming uses the board's separate interface (USB interface 1, endpoint 2). The tool is [ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool) (MIT), used from a temporary folder and not installed:
```
T=$(mktemp -d); cd "$T"
curl -fsSL -o tool.tar.gz https://github.com/kriomant/ch57x-keyboard-tool/releases/download/v1.7.0/ch57x-keyboard-tool-aarch64-unknown-linux-gnu.tar.gz
echo "565958f1732d064905a96bc1b0daabd03f7e5baf1fcca76f834bc2b3efe266ab  tool.tar.gz" | sha256sum -c
tar -xzf tool.tar.gz
./ch57x-keyboard-tool validate ~/pi-photo-hub/config/button-board.yaml
sudo ./ch57x-keyboard-tool upload ~/pi-photo-hub/config/button-board.yaml
cd; rm -rf "$T"
```
The board cannot report its settings back, so have the owner press every input and read the service's journal. To change what the board sends, edit `config/button-board.yaml` and upload again; the factory state was `c` on all six inputs. The Windows alternative is in the README.

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

`scripts/photo-buttons.py`, `config/buttons.json`, `config/button-board.yaml`, `systemd/photo-buttons.service`, `scripts/test/buttons-virtual.py`, README "Button board", `docs/architecture.md` "Slideshow layer".

## Last verified

2026-11-18: written with the service; tested on the Pi with the virtual board (see the build log in `docs/slideshow-layer-build.md`). Same day, the real board: programmed from the Pi with tool v1.7.0, and KEY1, KEY2, KEY3, knob left, right and press each reached the service as F13 to F18 and called the API, and the owner confirmed every operation works, including holding KEY2 for screen off and on. Not cold-tested.
