#!/bin/bash
# whats-running.sh - READ-ONLY: what the Pi is doing right now. Run on the Pi (pi-access skill).
# Use it before anything disruptive (a reboot, a shutdown, an update): it shows the services, the
# slideshow, project jobs running at this moment, the scheduled jobs and the last vocabulary refresh.
echo "== services"
for s in mount-hdd picapport-wrapper photo-api; do printf '%s: %s\n' "$s" "$(systemctl is-active "$s")"; done
echo "== slideshow"
curl -s -m 5 localhost:3000/api/status | grep -oE '"(label|sort|interval)":("[^"]*"|[0-9]+|null)|"on":(true|false|null)|"wantedOff":(true|false)' | paste -sd' ' || echo "photo API not answering"
echo "== project jobs running now (none listed = none)"
pgrep -af 'refresh-vocabulary|metadata-survey|exiftool|picapport-db\.sh|update\.sh|metadata-testset' | grep -v -e pgrep -e whats-running | cut -c1-140
echo "== scheduled jobs (cron, user pi)"
crontab -l 2>/dev/null | grep 'pi-photo-hub' | sed -e 's| /bin/bash | |' -e 's| >/dev/null 2>&1||'
echo "== last vocabulary refresh (~/metadata-survey/refresh.log)"
tail -n 2 "$HOME/metadata-survey/refresh.log" 2>/dev/null || echo "never run"
