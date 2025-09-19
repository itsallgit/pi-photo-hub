#!/bin/bash
# bootstrap.sh - Main setup script for pi-photo-hub

set -e  # exit immediately if a command fails

# Log file
LOGFILE="/var/log/pi-photo-hub/bootstrap.log"
mkdir -p $(dirname "$LOGFILE")
exec > >(tee -a "$LOGFILE") 2>&1

# Steps tracker
TOTAL_STEPS=7
CURRENT_STEP=0

banner() {
  CURRENT_STEP=$((CURRENT_STEP+1))
  echo ""
  echo "============================================================"
  echo ">>> STEP $CURRENT_STEP of $TOTAL_STEPS"
  echo ">>> $1"
  echo "============================================================"
  echo ""
}

# Spinner function
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

# Parse arguments
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

banner "Updating System"
export DEBIAN_FRONTEND=noninteractive
run_with_spinner "sudo apt update -y && sudo apt full-upgrade -y" "Updating packages"

banner "Installing Essentials"
run_with_spinner "sudo apt install -y curl unzip chromium-browser" "Installing essentials"

banner "Installing Java"
if [ "$USE_LATEST" = true ]; then
  log "Installing latest Java (OpenJDK 17 from apt)" "INFO"
  sudo apt install -y openjdk-17-jre
else
  log "Installing pinned Java version $JAVA_VERSION" "INFO"

  JAVA_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-${JAVA_VERSION}%2B8/OpenJDK17U-jre_aarch64_linux_hotspot_${JAVA_VERSION}_8.tar.gz"

  log "Downloading Java $JAVA_VERSION..." "INFO"
  curl -L -o /tmp/openjdk.tar.gz "$JAVA_URL"

  log "Extracting Java..." "INFO"
  sudo mkdir -p /opt/java
  sudo tar -xzf /tmp/openjdk.tar.gz -C /opt/java --strip-components=1

  echo "export PATH=/opt/java/bin:\$PATH" | sudo tee /etc/profile.d/jdk.sh
  source /etc/profile.d/jdk.sh
fi

banner "Installing Node.js"
if [ "$USE_LATEST" = true ]; then
  run_with_spinner "sudo apt install -y nodejs npm" "Installing latest Node.js"
else
  run_with_spinner "curl -L -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" "Downloading Node.js $NODE_VERSION"
  run_with_spinner "sudo mkdir -p /opt/node && sudo tar -xf /tmp/node.tar.xz -C /opt/node --strip-components=1" "Extracting Node.js"
  echo "export PATH=/opt/node/bin:\$PATH" | sudo tee /etc/profile.d/node.sh
  source /etc/profile.d/node.sh
fi

banner "Setting up Picapport Service"
sudo cp "$(dirname "$0")/systemd/picapport.service" /etc/systemd/system/
run_with_spinner "sudo systemctl daemon-reload && sudo systemctl enable picapport.service" "Configuring Picapport service"

banner "Setting up Photo API Service"
pushd "$(dirname "$0")/api"
run_with_spinner "npm install" "Installing API dependencies"
popd
sudo cp "$(dirname "$0")/systemd/photo-api.service" /etc/systemd/system/
run_with_spinner "sudo systemctl daemon-reload && sudo systemctl enable photo-api.service" "Configuring API service"

banner "Setting up HDD Automount"
sudo cp "$(dirname "$0")/systemd/mount-hdd.service" /etc/systemd/system/
run_with_spinner "sudo systemctl enable mount-hdd.service" "Enabling HDD automount"

banner "Bootstrap Complete"
echo "[INFO] All components installed successfully!"
echo "[INFO] Log file available at: $LOGFILE"

banner "GOODBYE - Pi will reboot in 5 seconds"
sleep 5
sudo reboot
