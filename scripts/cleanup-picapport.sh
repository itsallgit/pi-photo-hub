#!/bin/bash
NAME="picapport"
PIDFILE="/var/run/$NAME.pid"
echo "[CLEANUP] Stopping $NAME..."
if [ -x /etc/init.d/$NAME ]; then
  /etc/init.d/$NAME stop
fi
if pgrep -f "picapport-headless.jar" >/dev/null 2>&1; then
  echo "[CLEANUP] Killing stray Picapport process..."
  pkill -f "picapport-headless.jar"
fi
echo "[CLEANUP] Done."