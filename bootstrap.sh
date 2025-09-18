#!/bin/bash
# bootstrap.sh - Main setup script for pi-photo-hub

LOGFILE="/var/log/pi-photo-hub/bootstrap.log"
mkdir -p $(dirname "$LOGFILE")
exec > >(tee -a "$LOGFILE") 2>&1

echo "[INFO] Starting bootstrap process at $(date)"

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

# Update system
sudo apt update && sudo apt full-upgrade -y

# Install essentials
sudo apt install -y curl unzip chromium-browser

# Install Java
if [ "$USE_LATEST" = true ]; then
  echo "[INFO] Installing latest Java (OpenJDK 17 from apt)"
  sudo apt install -y openjdk-17-jre
else
  echo "[INFO] Installing pinned Java version $JAVA_VERSION"
  curl -L -o /tmp/openjdk.tar.gz "https://download.java.net/java/GA/jdk${JAVA_VERSION}/binaries/openjdk-${JAVA_VERSION}_linux-aarch64_bin.tar.gz"
  sudo mkdir -p /opt/java
  sudo tar -xzf /tmp/openjdk.tar.gz -C /opt/java
  echo "export PATH=/opt/java/jdk-${JAVA_VERSION}/bin:$PATH" | sudo tee /etc/profile.d/jdk.sh
  source /etc/profile.d/jdk.sh
fi

# Install Node.js
if [ "$USE_LATEST" = true ]; then
  echo "[INFO] Installing latest Node.js (from apt)"
  sudo apt install -y nodejs npm
else
  echo "[INFO] Installing pinned Node.js version $NODE_VERSION"
  curl -L -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz"
  sudo mkdir -p /opt/node
  sudo tar -xf /tmp/node.tar.xz -C /opt/node --strip-components=1
  echo "export PATH=/opt/node/bin:$PATH" | sudo tee /etc/profile.d/node.sh
  source /etc/profile.d/node.sh
fi

# Setup Picapport systemd service
sudo cp "$(dirname "$0")/systemd/picapport.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable picapport.service

# Setup API service
pushd "$(dirname "$0")/api"
npm install
popd
sudo cp "$(dirname "$0")/systemd/photo-api.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable photo-api.service

# Setup HDD automount
sudo cp "$(dirname "$0")/systemd/mount-hdd.service" /etc/systemd/system/
sudo systemctl enable mount-hdd.service

# Reboot after setup
echo "[INFO] Bootstrap complete. Rebooting now..."
sudo reboot
