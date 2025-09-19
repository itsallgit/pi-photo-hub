#!/bin/bash
# bootstrap.sh - Main setup script for pi-photo-hub

set -e  # exit immediately if a command fails

# -----------------------------
# Logging
# -----------------------------
LOGDIR="/var/log/pi-photo-hub"
LOGFILE="$LOGDIR/bootstrap.log"

# Ensure log directory exists and is writable
sudo mkdir -p "$LOGDIR"
sudo touch "$LOGFILE"
sudo chmod 666 "$LOGFILE"

# Redirect stdout/stderr to log file *and* console
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

# Spinner function
run_with_spinner() {
  local cmd="$1"
  local msg="$2"

  echo -n "[INFO] $msg... "
  bash -c "$cmd" &>>"$LOGFILE" &
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
# STEP: System update
# -----------------------------
banner "Updating System"
export DEBIAN_FRONTEND=noninteractive
run_with_spinner "sudo apt update -y && sudo apt full-upgrade -y" "Updating packages"

# -----------------------------
# STEP: Essentials
# -----------------------------
banner "Installing Essentials"
run_with_spinner "sudo apt install -y curl unzip chromium-browser" "Installing essentials"

# -----------------------------
# STEP: Java
# -----------------------------
banner "Installing Java"
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y openjdk-17-jre" "Installing latest Java (OpenJDK 17)"
  JAVA_BIN=$(command -v java)
else
  JAVA_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-${JAVA_VERSION}%2B8/OpenJDK17U-jre_aarch64_linux_hotspot_${JAVA_VERSION}_8.tar.gz"
  run_with_spinner "curl -L -o /tmp/openjdk.tar.gz \"$JAVA_URL\"" "Downloading Java $JAVA_VERSION"
  sudo mkdir -p /opt/java
  run_with_spinner "sudo tar -xzf /tmp/openjdk.tar.gz -C /opt/java --strip-components=1" "Extracting Java"
  JAVA_BIN="/opt/java/bin/java"
fi
echo "[INFO] Java binary at $JAVA_BIN"

# -----------------------------
# STEP: Node.js
# -----------------------------
banner "Installing Node.js"
NODE_BIN=""
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y nodejs npm" "Installing latest Node.js"
  NODE_BIN=$(command -v node || true)
else
  run_with_spinner "curl -L -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" "Downloading Node.js $NODE_VERSION"
  run_with_spinner "sudo mkdir -p /opt/node && sudo tar -xf /tmp/node.tar.xz -C /opt/node --strip-components=1" "Extracting Node.js"
  NODE_BIN="/opt/node/bin/node"
  echo "export PATH=/opt/node/bin:\$PATH" | sudo tee /etc/profile.d/node.sh
  export PATH="/opt/node/bin:$PATH"
fi

echo "[INFO] Using Node binary at: $NODE_BIN"

# -----------------------------
# STEP: Picapport service
# -----------------------------
banner "Setting up Picapport Service"
sudo sed "s|__JAVA_BIN__|$JAVA_BIN|g" "$(dirname "$0")/systemd/picapport.service.template" | sudo tee /etc/systemd/system/picapport.service > /dev/null
run_with_spinner "sudo systemctl daemon-reload && sudo systemctl enable picapport.service" "Configuring Picapport service"

# -----------------------------
# STEP: API service
# -----------------------------
banner "Setting up Photo API Service"
pushd "$(dirname "$0")/api"

# Force npm to use correct binary path
if [ -x "/opt/node/bin/npm" ]; then
  run_with_spinner "/opt/node/bin/npm install" "Installing API dependencies"
else
  run_with_spinner "npm install" "Installing API dependencies"
fi

popd

sudo cp "$(dirname "$0")/systemd/photo-api.service.template" /etc/systemd/system/photo-api.service
# Inject correct Node path into systemd unit
sudo sed -i "s|__NODE_BIN__|$NODE_BIN|g" /etc/systemd/system/photo-api.service
run_with_spinner "sudo systemctl daemon-reload && sudo systemctl enable photo-api.service" "Configuring API service"

# -----------------------------
# STEP: HDD automount
# -----------------------------
banner "Setting up HDD Automount"
sudo cp "$(dirname "$0")/systemd/mount-hdd.service" /etc/systemd/system/
run_with_spinner "sudo systemctl enable mount-hdd.service" "Enabling HDD automount"

# -----------------------------
# Done
# -----------------------------
banner "Bootstrap Complete"
echo "[INFO] All components installed successfully!"
echo "[INFO] Log file available at: $LOGFILE"

banner "GOODBYE - Pi will reboot in 5 seconds"
sleep 5
sudo reboot
