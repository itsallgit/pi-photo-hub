# Network

Verified facts only. Anything unverified is an open question in the [backlog](backlog.md).

## Layout (as described by the owner)

```
Internet -- Vodafone router -- Deco mesh -- Pi (ethernet)
                                   \------- owner's PC
```

- The Vodafone router has only the Deco connected to it.
- The Deco connects to the Pi by ethernet.
- Whether the Vodafone router is in bridge/modem mode or routing is **not known** (open question).

## Addressing (observed 2026-11-15)

| Item | Value |
|---|---|
| Subnet | `192.168.68.0/22` (netmask 255.255.252.0) |
| Default gateway (seen from the Pi) | `192.168.68.1` |
| Pi address | `192.168.68.55` on `eth0`, assigned by **DHCP** (NetworkManager profile `Wired connection 1`, method auto) |
| Pi DNS servers | `8.8.8.8`, `8.8.4.4` (where these come from is not known) |
| Pi hostname | `pi`, advertised by avahi (mDNS) as `pi.local` |
| Pi MAC (eth0) | Vendor prefix `e4:5f:01` (Raspberry Pi). The full address is deliberately not recorded here because this repo is public; see the Deco app client list or `arp -a`. |
| Static IP / reservation | **None** on the Pi, and none in the Deco app. This is a backlog to-do. |

The Pi's IP can change. Prefer the name `pi.local`; it resolved from the owner's Windows PC on 2026-11-15.

## Finding the Pi

1. `pi.local` (works if mDNS works on the machine you are on).
2. The Deco app's client list.
3. `powershell -File scripts\find-pi.ps1` (PowerShell 5.1 or 7): sweeps the PC's subnet for hosts with SSH open. The Pi's MAC starts `e4:5f:01` (also `b8:27:eb`, `dc:a6:32`, `d8:3a:dd`, `2c:cf:67` for other Pi models) in `arp -a`.

## SSH host keys (to verify the Pi before trusting it)

Host-key fingerprints are public by design: they let a new PC confirm it is talking to the right machine, and do not let anyone impersonate it. Recorded 2026-11-15 from the Pi:

| Type | Fingerprint |
|---|---|
| ED25519 | `SHA256:tfJcKjvj0N9QGe5FSasGUmShQw9Vucya9S75UkyyAFs` |
| ECDSA | `SHA256:ohbUwRPSbK3MkDMxBzFHyiFTRraY724aeQvdpPrehiU` |
| RSA | `SHA256:JOrCQVof6LctzB7DQwg7KcBASlqdGkwo67Mj61Ciow0` |

Compare with `ssh-keyscan -T 10 pi.local | ssh-keygen -lf -`. **These change if the Pi's SD card is re-flashed**; if they differ, find out why before trusting the new keys, and update this table once confirmed.

## Ports on the Pi

| Port | Service |
|---|---|
| 22 | SSH |
| 3000 | `photo-api` (Node/Express, no authentication, LAN only) |
| 8080 | Picapport web UI and slideshow |

## Open items

Tracked in the [backlog](backlog.md): reserve the Pi's address in the Deco app; confirm the Vodafone router mode; document the Deco mode (router or access point).
