#!/bin/bash
# bootstrap.sh - Main setup script for pi-photo-hub

set -e  # exit immediately if a command fails

# -----------------------------
# Log file
# -----------------------------
LOGFILE="/var/log/pi-photo-hub/bootstrap.log"
sudo mkdir -p $(dirname "$LOGFILE")
sudo touch "$LOGFILE"
sudo chown $USER:$USER "$LOGFILE"
exec > >(tee -a "$LOGFILE") 2>&1

# -----------------------------
# Helpers
# -----------------------------
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

banner "Pi Photo Hub Bootstrap Starting - $(date)"

# -----------------------------
# Parse arguments
# -----------------------------
USE_LATEST=false
for arg in "$@"; do
  if [ "$arg" == "--latest" ]; then
    USE_LATEST=true
  fi
done

# Load configs
source "$(dirname "$0")/config/versions.conf"
echo "[INFO] USE_LATEST=$USE_LATEST"
echo "[INFO] JAVA_VERSION=$JAVA_VERSION"
echo "[INFO] NODE_VERSION=$NODE_VERSION"

# -----------------------------
# Update system
# -----------------------------
banner "Updating System"
export DEBIAN_FRONTEND=noninteractive
run_with_spinner "sudo apt update -y && sudo apt full-upgrade -y" "Updating packages"

# -----------------------------
# Install essentials
# -----------------------------
banner "Installing Essentials"
run_with_spinner "sudo apt install -y curl unzip chromium-browser" "Installing essentials"

# -----------------------------
# Java
# -----------------------------
banner "Installing Java"
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y openjdk-17-jre" "Installing latest Java (OpenJDK 17)"
else
  JAVA_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-${JAVA_VERSION}%2B8/OpenJDK17U-jre_aarch64_linux_hotspot_${JAVA_VERSION}_8.tar.gz"
  run_with_spinner "curl -L -o /tmp/openjdk.tar.gz \"$JAVA_URL\"" "Downloading Java $JAVA_VERSION"
  sudo mkdir -p /opt/java
  run_with_spinner "sudo tar -xzf /tmp/openjdk.tar.gz -C /opt/java --strip-components=1" "Extracting Java"
fi
echo "export PATH=/opt/java/bin:\$PATH" | sudo tee /etc/profile.d/jdk.sh
source /etc/profile.d/jdk.sh

# -----------------------------
# Node.js
# -----------------------------
banner "Installing Node.js"
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y nodejs npm" "Installing latest Node.js"
else
  run_with_spinner "curl -L -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" "Downloading Node.js $NODE_VERSION"
  sudo mkdir -p /opt/node
  run_with_spinner "sudo tar -xf /tmp/node.tar.xz -C /opt/node --strip-components=1" "Extracting Node.js"
fi
echo "export PATH=/opt/node/bin:\$PATH" | sudo tee /etc/profile.d/node.sh
source /etc/profile.d/node.sh

# -----------------------------
# Fix ownership
# -----------------------------
banner "Fixing Folder Ownership"
sudo chown -R pi:pi /home/pi/pi-photo-hub

# -----------------------------
# Ensure Picapport home & logs folder exist
# -----------------------------
banner "Setting up Picapport folders"
PICAPP_HOME="/home/pi/.picapport"
sudo mkdir -p "$PICAPP_HOME/logfiles" "$PICAPP_HOME/users" "$PICAPP_HOME/plugins" "$PICAPP_HOME/thesaurus" "$PICAPP_HOME/designs"
sudo chown -R pi:pi "$PICAPP_HOME"

# Copy picapport.properties, always overwrite
sudo cp "$PROPS_SRC" "$PROPS_DEST"
sudo chown pi:pi "$PROPS_DEST"
echo "[INFO] picapport.properties updated from repo"

# -----------------------------
# Mount HDD service
# -----------------------------
banner "Setting up HDD Automount"
sudo cp "$(dirname "$0")/systemd/mount-hdd.service" /etc/systemd/system/
chmod +x "$(dirname "$0")/scripts/mount-hdd.sh"
sudo systemctl daemon-reload
sudo systemctl enable mount-hdd.service
sudo systemctl start mount-hdd.service

# -----------------------------
# Picapport service
# -----------------------------
banner "Setting up Picapport Service"
sudo cp "$(dirname "$0")/systemd/picapport.service.template" /etc/systemd/system/picapport.service
sudo systemctl daemon-reload
sudo systemctl enable picapport.service

# -----------------------------
# Chromium GUI service for Picapport slideshow
# -----------------------------
banner "Setting up Chromium GUI service for Picapport Slideshow"
sudo cp "$(dirname "$0")/systemd/picapport-chromium.service.template" /etc/systemd/system/picapport-chromium.service
sudo systemctl daemon-reload
sudo systemctl enable picapport-chromium.service

# -----------------------------
# Photo API service
# -----------------------------
banner "Setting up Photo API Service"
pushd "$(dirname "$0")/api"
run_with_spinner "npm install" "Installing API dependencies"
mkdir -p logs
chown -R pi:pi logs
popd
sudo cp "$(dirname "$0")/systemd/photo-api.service.template" /etc/systemd/system/photo-api.service
sudo systemctl daemon-reload
sudo systemctl enable photo-api.service

# -----------------------------
# Done
# -----------------------------
banner "Bootstrap Complete"
echo "[INFO] All components installed successfully!"
echo "[INFO] Log file available at: $LOGFILE"

banner "GOODBYE - Pi will reboot in 5 seconds"
sleep 5
sudo reboot
