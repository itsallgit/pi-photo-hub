#!/bin/bash
# bootstrap.sh - Complete setup for pi-photo-hub (PicApport headless + init.d + API + mounting)

set -euo pipefail

# ---------- Config ----------
LOGFILE="/var/log/pi-photo-hub/bootstrap.log"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PICAPPORT_REPO_JAR="$REPO_ROOT/picapport/picapport-headless.jar"   # ensure jar placed in repo
PICAPPORT_INSTALL_DIR="/opt/picapport"
INITD_SRC="$REPO_ROOT/initd/picapport"
CR_CHROMIUM_TEMPLATE_SRC="$REPO_ROOT/systemd/picapport-chromium.service.template"
MOUNT_SERVICE_SRC="$REPO_ROOT/systemd/mount-hdd.service"
MOUNT_SCRIPT_SRC="$REPO_ROOT/scripts/mount-hdd.sh"
PHOTO_API_SERVICE_SRC="$REPO_ROOT/systemd/photo-api.service.template"
PICAPPORT_PROPS_SRC="$REPO_ROOT/config/picapport.properties"

# Default settings (overridable by --latest)
USE_LATEST=false

# ---------- Logging setup ----------
sudo mkdir -p "$(dirname "$LOGFILE")"
sudo touch "$LOGFILE"
sudo chown "$USER:$USER" "$LOGFILE"
exec > >(tee -a "$LOGFILE") 2>&1

# ---------- Helpers ----------
CURRENT_STEP=0
banner() {
  CURRENT_STEP=$((CURRENT_STEP+1))
  echo ""
  echo "============================================================"
  echo ">>> STEP $CURRENT_STEP"
  echo ">>> $1"
  echo "============================================================"
  echo ""
}

run_with_spinner() {
  local cmd="$1"
  local msg="$2"
  echo -n "[INFO] $msg... "
  bash -c "$cmd" &> >(tee -a "$LOGFILE") &
  local pid=$!
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 $pid 2>/dev/null; do
    i=$(( (i+1) %10 ))
    printf "\b${spin:$i:1}"
    sleep 0.1
  done
  wait $pid
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    printf "\b[OK]\n"
  else
    printf "\b[FAIL]\n"
    exit $exit_code
  fi
}

# ---------- Start ----------
banner "Pi Photo Hub Bootstrap Starting - $(date)"

# ---------- Parse args ----------
for arg in "$@"; do
  if [ "$arg" == "--latest" ]; then
    USE_LATEST=true
  fi
done
echo "[INFO] USE_LATEST=$USE_LATEST"

# ---------- Source versions config if present ----------
if [ -f "$REPO_ROOT/config/versions.conf" ]; then
  # keep but optional
  source "$REPO_ROOT/config/versions.conf"
  echo "[INFO] Loaded versions.conf: JAVA_VERSION=${JAVA_VERSION:-unset}, NODE_VERSION=${NODE_VERSION:-unset}"
fi

# ---------- System update ----------
banner "Updating System"
export DEBIAN_FRONTEND=noninteractive
run_with_spinner "sudo apt update -y && sudo apt full-upgrade -y" "Updating packages"

# ---------- Essentials ----------
banner "Installing Essentials"
run_with_spinner "sudo apt install -y curl unzip cron screen x11-xserver-utils" "Installing essentials"
# chromium-browser is installed later in chrome service if needed; keep it installed earlier
run_with_spinner "sudo apt install -y chromium-browser" "Installing Chromium browser"

# ---------- Install JRE ----------
banner "Installing Java Runtime Environment (JRE)"
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y openjdk-17-jre-headless" "Installing latest OpenJDK JRE (headless)"
  JAVA_BIN="$(command -v java || true)"
else
  # pinned JRE URL (Temurin/Adoptium JRE)
  JAVA_PKG_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-${JAVA_VERSION}%2B8/OpenJDK17U-jre_aarch64_linux_hotspot_${JAVA_VERSION}_8.tar.gz"
  run_with_spinner "curl -L -o /tmp/openjre.tar.gz \"$JAVA_PKG_URL\"" "Downloading pinned JRE ${JAVA_VERSION}"
  sudo mkdir -p /opt/java
  run_with_spinner "sudo tar -xzf /tmp/openjre.tar.gz -C /opt/java --strip-components=1" "Extracting pinned JRE"
  # Create a stable symlink so scripts use /usr/local/bin/java
  if [ -x /opt/java/bin/java ]; then
    sudo ln -sf /opt/java/bin/java /usr/local/bin/java
    JAVA_BIN="/usr/local/bin/java"
  else
    echo "[WARN] /opt/java/bin/java not found after extract"
    JAVA_BIN="$(command -v java || true)"
  fi
fi

# Ensure java is available
if [ -z "${JAVA_BIN:-}" ]; then
  JAVA_BIN="$(command -v java || true)"
fi
if [ -z "$JAVA_BIN" ]; then
  echo "[ERROR] java not found after install. Exiting."
  exit 1
fi
echo "[INFO] Using java at: $JAVA_BIN"

# ---------- Node.js (API) ----------
banner "Installing Node.js"
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y nodejs npm" "Installing latest Node.js"
else
  if [ -n "${NODE_VERSION:-}" ]; then
    run_with_spinner "curl -L -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" "Downloading Node.js ${NODE_VERSION}"
    sudo mkdir -p /opt/node
    run_with_spinner "sudo tar -xf /tmp/node.tar.xz -C /opt/node --strip-components=1" "Extracting Node.js"
    sudo ln -sf /opt/node/bin/node /usr/local/bin/node
    sudo ln -sf /opt/node/bin/npm /usr/local/bin/npm
  else
    run_with_spinner "sudo apt install -y nodejs npm" "Installing Node.js from apt (no pinned version)"
  fi
fi
echo "[INFO] node: $(command -v node || echo 'not found')"

# ---------- Fix repo ownership ----------
banner "Fixing Folder Ownership"
sudo chown -R pi:pi "$REPO_ROOT" || true

# ---------- Mount HDD service (systemd) ----------
banner "Setting up HDD Automount (systemd unit & script)"
if [ -f "$MOUNT_SERVICE_SRC" ]; then
  sudo cp "$MOUNT_SERVICE_SRC" /etc/systemd/system/mount-hdd.service
  sudo chmod +x "$MOUNT_SCRIPT_SRC"
  sudo systemctl daemon-reload
  sudo systemctl enable mount-hdd.service
  # start so subsequent steps can see mount
  sudo systemctl start mount-hdd.service || true
else
  echo "[WARN] Mount service source missing: $MOUNT_SERVICE_SRC"
fi

# ---------- Picapport installation ----------
banner "Installing Picapport headless"
if [ ! -f "$PICAPPORT_REPO_JAR" ]; then
  echo "[ERROR] Expected picapport-headless.jar at $PICAPPORT_REPO_JAR (place it there and re-run). Exiting."
  exit 1
fi

sudo mkdir -p "$PICAPPORT_INSTALL_DIR"
sudo cp "$PICAPPORT_REPO_JAR" "$PICAPPORT_INSTALL_DIR/"
sudo chown -R pi:pi "$PICAPPORT_INSTALL_DIR"

# ---------- Start script for Picapport ----------
banner "Creating Picapport start script"
START_SCRIPT="$PICAPPORT_INSTALL_DIR/start-picapport.sh"
sudo tee "$START_SCRIPT" > /dev/null <<EOF
#!/bin/bash
# start-picapport.sh - launches PicAppport headless
export PATH=/opt/java/bin:\$PATH
# use explicit java path
JAVA_BIN="\$(command -v java || echo /usr/local/bin/java)"
exec "\$JAVA_BIN" -Xms512m -Xmx1024m -Duser.home=$PICAPPORT_INSTALL_DIR -jar $PICAPPORT_INSTALL_DIR/picapport-headless.jar
EOF
sudo chmod +x "$START_SCRIPT"
sudo chown pi:pi "$START_SCRIPT"

# Create Picapport home and copy properties (always overwrite)
banner "Configuring Picapport properties & directories"
PICAPP_HOME="/home/pi/.picapport"
sudo mkdir -p "$PICAPP_HOME"
sudo cp -f "$PICAPPORT_PROPS_SRC" "$PICAPP_HOME/picapport.properties"
sudo chown -R pi:pi "$PICAPP_HOME"
echo "[INFO] picapport.properties copied to $PICAPP_HOME/picapport.properties"

# ---------- Init.d daemon - install and enable ----------
banner "Installing init.d service for Picapport"
if [ -f "$INITD_SRC" ]; then
  sudo cp "$INITD_SRC" /etc/init.d/picapport
  sudo chmod +x /etc/init.d/picapport
  # Ensure init.d script uses correct paths (we'll adjust in-place)
  sudo sed -i "s|/opt/picapport/start-picapport.sh|$START_SCRIPT|g" /etc/init.d/picapport || true
  sudo update-rc.d picapport defaults
  # start now
  sudo /etc/init.d/picapport stop || true
  sudo /etc/init.d/picapport start || true
else
  echo "[WARN] init.d source missing: $INITD_SRC"
fi

# ---------- Chromium GUI service for Picapport slideshow ----------
banner "Installing Chromium GUI systemd service template (opens slideshow on boot)"
if [ -f "$CR_CHROMIUM_TEMPLATE_SRC" ]; then
  sudo cp "$CR_CHROMIUM_TEMPLATE_SRC" /etc/systemd/system/picapport-chromium.service
  sudo sed -i "s|__REPO_ROOT__|$REPO_ROOT|g" /etc/systemd/system/picapport-chromium.service || true
  sudo systemctl daemon-reload
  sudo systemctl enable picapport-chromium.service || true
else
  echo "[WARN] Chromium systemd template missing: $CR_CHROMIUM_TEMPLATE_SRC"
fi

# ---------- Photo API service (systemd) ----------
banner "Installing Photo API systemd service"
if [ -d "$REPO_ROOT/api" ]; then
  pushd "$REPO_ROOT/api" >/dev/null
  run_with_spinner "npm install --no-audit --no-fund" "Installing API dependencies"
  mkdir -p logs
  sudo chown -R pi:pi logs
  popd >/dev/null
fi
if [ -f "$PHOTO_API_SERVICE_SRC" ]; then
  sudo cp "$PHOTO_API_SERVICE_SRC" /etc/systemd/system/photo-api.service
  sudo systemctl daemon-reload
  sudo systemctl enable photo-api.service
else
  echo "[WARN] Photo API systemd template missing: $PHOTO_API_SERVICE_SRC"
fi

# ---------- Finalize ----------
banner "Bootstrap Complete"
echo "[INFO] All components installed (or were present)."
echo "[INFO] Log file is at $LOGFILE"
echo ""
echo "You may now verify services:"
echo "  sudo /etc/init.d/picapport status"
echo "  sudo systemctl status mount-hdd.service"
echo "  sudo systemctl status photo-api.service"
echo "  sudo systemctl status picapport-chromium.service"
echo ""
echo "If everything looks good, rebooting in 8 seconds..."
sleep 8
sudo reboot
