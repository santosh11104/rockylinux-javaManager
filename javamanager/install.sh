#!/bin/bash 

# Ensure that te script runs with root privileges
if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root or with sudo."
    exit 1
fi
# Function to handle thre errors
handle_error() {
    echo "Error: $1"
    exit 1
}
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
sudo dnf install-y systemd
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

#step2.
echo "Creating /etc/wsl.conf..."
sudo bash -c 'cat <<EOF > /etc/wsl.conf
[boot]
systemd=true
EOF' || handle_error "Failed to create /etc/wsl.conf"


# 4. Copy mavee-updater.service file to /etc/systemd/system and set permissions
echo "Copying mavee-updater.service to /etc/systemd/system..."
sudo chmod +x /home/mavee-updater.service
sudo cp /home/mavee-updater.service /etc/systemd/system/ || handle_error "Failed to copy mavee-updater.service"
sudo chmod +x /etc/systemd/system/mavee-updater.service || handle_error "Failed to set permissions on mavee-updater.service"

# 5. Add cron job
echo "Adding cron job..."
(crontab -l 2>/dev/null; echo "*/2 * * * * /root/.nvm/versions/node/v22.14.0/bin/node /home/javamanager/bin/mavee_updater_cli.js upgrade >> /var/log/mavee-updater-cron.log 2>&1") | crontab - || handle_error "Failed to add cron job"

# Step 7: Run npm install in /home/javamanager
echo "Running npm install in /home/javamanager..."
cd /home/javamanager || handle_error "Failed to change directory to /home/javamanager"
npm install || handle_error "Failed to run npm install"

echo "Setup complete!"
# Restart WSL2 using PowerShell
echo "Restarting WSL2..."
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "wsl --shutdown"


