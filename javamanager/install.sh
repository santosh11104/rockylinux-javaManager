#!/bin/bash

# Ensure that the script runs with root privileges
if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root or with sudo."
    exit 1
fi

# Function to handle errors
handle_error() {
    echo "Error: $1"
    exit 1
}

# Automatically detect the current directory
TARGET_DIR=$(pwd)

echo "Using target directory: $TARGET_DIR"

echo "Updating system..."
dnf update -y && dnf upgrade -y

echo "Installing essential packages: sudo, tar, zip, wget, curl"
dnf install -y tar zip curl 
dnf install -y dnf-plugins-core wget curl tar git
dnf install sudo -y
sudo dnf install wget -y
sudo dnf install systemd -y
sudo dnf install -y ncurses
sudo dnf install -y findutils
sudo dnf install -y cronie
sudo dnf install -y systemd
sudo dnf install -y procps-ng

echo "Downloading and installing NVM..."
export NVM_VERSION="0.39.5"  # Latest stable version
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v${NVM_VERSION}/install.sh | bash

echo "Adding NVM to profile..."
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc

# Explicitly loading NVM 
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

echo "Verifying NVM installation..."
nvm --version || echo "NVM installation failed."

echo "Installing Node.js using NVM..."
nvm install 22  # Installs Node.js 22 (latest stable)
nvm use 22
echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# Step 2: Create /etc/wsl.conf
echo "Creating /etc/wsl.conf..."
sudo bash -c 'cat <<EOF > /etc/wsl.conf
[boot]
systemd=true
EOF' || handle_error "Failed to create /etc/wsl.conf"

# Step 4: Replace placeholders in mavee-updater.service and copy it to /etc/systemd/system
SERVICE_FILE="$TARGET_DIR/mavee-updater.service"
if [ ! -f "$SERVICE_FILE" ]; then
    handle_error "File $SERVICE_FILE does not exist. Please ensure it is present in $TARGET_DIR."
fi

echo "Replacing placeholders in mavee-updater.service..."
sed -i "s|{{TARGET_DIR}}|$TARGET_DIR|g" "$SERVICE_FILE" || handle_error "Failed to replace placeholders in mavee-updater.service"

echo "Copying mavee-updater.service to /etc/systemd/system..."
sudo chmod +x "$SERVICE_FILE"
sudo cp "$SERVICE_FILE" /etc/systemd/system/ || handle_error "Failed to copy mavee-updater.service"
sudo chmod +x /etc/systemd/system/mavee-updater.service || handle_error "Failed to set permissions on mavee-updater.service"

# Step 5: Add cron job
echo "Adding cron job..."
(crontab -l 2>/dev/null; echo "*/2 * * * * /root/.nvm/versions/node/v22.14.0/bin/node $TARGET_DIR/bin/mavee_updater_cli.js upgrade >> /var/log/mavee-updater-cron.log 2>&1") | crontab - || handle_error "Failed to add cron job"

# Step 7: Run npm install in the target directory
echo "Running npm install in $TARGET_DIR..."
cd "$TARGET_DIR" || handle_error "Failed to change directory to $TARGET_DIR"
npm install --no-save || handle_error "Failed to run npm install"

echo "Setup complete!"

# Restart WSL2 using PowerShell
echo "Restarting WSL2..."
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "wsl --shutdown"