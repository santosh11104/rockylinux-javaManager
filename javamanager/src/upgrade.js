/**
 * Runs a shell command and returns the output.
 *
 * @param {string} command - The shell command to execute.
 * @returns {Promise<string>} - The trimmed output of the command.
 * @throws {Error} - If the command fails to execute.
 */
async function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Command failed: ${command}`);
        console.error(`Error: ${stderr}`);
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "mavee_config_upgrade.json");

async function readUpgradeConfiguration() {
  try {
    if (!fs.existsSync(configPath)) {
      throw new Error("🚨 Upgrade configuration file not found.");
    }

    const configData = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData);

    return {
      javaVersion: config.mave.dependencies.java.version,
      javaUrl: config.mave.dependencies.java.packageUrlUnix,
      tomcatVersion: config.mave.dependencies.tomcat.version,
      tomcatUrl: config.mave.dependencies.tomcat.packageUrlUnix,
    };
  } catch (error) {
    console.error("❌ Failed to read upgrade configuration:", error);
    throw error;
  }
}

/**
 * Retrieves the current versions of Java and Tomcat installed on the system.
 *
 * This function uses the `runCommand` utility to execute shell commands and extract the
 * current versions of Java and Tomcat from the directory names in the `/opt` directory.
 *
 * @returns {Promise<{ currentJavaVersion: string, currentTomcatVersion: string }>} - An object containing the current versions of Java and Tomcat.
 */
async function getCurrentVersions() {
  let currentJavaVersion = null;
  let currentTomcatVersion = null;

  try {
    // Extract the current Java version from the directory name in `/opt`
    currentJavaVersion = await runCommand(
      `ls /opt | grep 'openjdk-' | sed 's/openjdk-//' | head -n 1`
    );
  } catch (error) {
    console.warn("⚠️ No existing Java installation found.");
  }

  try {
    // Extract the current Tomcat version from the directory name in `/opt`
    currentTomcatVersion = await runCommand(
      `ls /opt | grep 'tomcat-' | sed 's/tomcat-//' | head -n 1`
    );
  } catch (error) {
    console.warn("⚠️ No existing Tomcat installation found.");
  }

  return { currentJavaVersion, currentTomcatVersion };
}

async function validateUpgradeConditions(javaVersion, tomcatVersion) {
  const { currentJavaVersion, currentTomcatVersion } =
    await getCurrentVersions();

  if (
    javaVersion === currentJavaVersion &&
    tomcatVersion === currentTomcatVersion
  ) {
    console.error(
      `🚨 Upgrade aborted: Java ${javaVersion} and Tomcat ${tomcatVersion} are already installed.`
    );
    process.exit(1); // Stop execution
  }

  if (javaVersion === currentJavaVersion) {
    console.error(
      `🚨 Upgrade aborted: Java ${javaVersion} is already installed.`
    );
    process.exit(1);
  }

  if (tomcatVersion === currentTomcatVersion) {
    console.error(
      `🚨 Upgrade aborted: Tomcat ${tomcatVersion} is already installed.`
    );
    process.exit(1);
  }
}

/**
 * Creates a backup of the specified source directory to the destination directory.
 * If a backup already exists at the destination, it will be removed before creating the new backup.
 *
 * @param {string} source - The path to the directory to be backed up.
 * @param {string} destination - The path to the backup directory.
 * @returns {Promise<void>} - A Promise that resolves when the backup is complete.
 */
async function createBackup(source, destination) {
  try {
    if (fs.existsSync(destination)) {
      console.log(
        `📂 Backup already exists at ${destination}, removing old backup...`
      );
      await runCommand(`sudo rm -rf ${destination}`);
    }
    console.log(`📂 Creating backup: ${source} -> ${destination}`);
    await runCommand(`sudo cp -r ${source} ${destination}`);
  } catch (error) {
    console.error(`❌ Backup creation failed: ${error}`);
    throw error;
  }
}

/**
 * Ensures that the 'tomcat' group and user exist.
 * If they do not exist, they are created.
 */
async function ensureTomcatUserAndGroup() {
  try {
    // Check if the 'tomcat' group exists
    await runCommand(`getent group tomcat`);
  //  console.log("✅ 'tomcat' group already exists.");
  } catch (error) {
    //console.log("🔄 Creating 'tomcat' group...");
    await runCommand(`sudo groupadd tomcat`);
  }

  try {
    // Check if the 'tomcat' user exists
    await runCommand(`id -u tomcat`);
  //  console.log("✅ 'tomcat' user already exists.");
  } catch (error) {
  //  console.log("🔄 Creating 'tomcat' user...");
    await runCommand(`sudo useradd --system --no-create-home --gid tomcat tomcat`);
  }
}

async function rollbackUpgrade(previousJavaVersion, previousTomcatVersion) {
  console.log("🔄 Rolling back due to failure...");

  try {
    const javaBackupDir = `/opt/java_backups/openjdk-${previousJavaVersion}`;
    const tomcatBackupDir = `/opt/tomcat_backups/tomcat-${previousTomcatVersion}`;

    // ✅ Restore Java from backup
    if (fs.existsSync(javaBackupDir)) {
      console.log(`♻️ Restoring Java ${previousJavaVersion} from backup...`);
      await runCommand(`sudo rm -rf /opt/openjdk-*`);
      await runCommand(`sudo cp -r ${javaBackupDir} /opt/openjdk-${previousJavaVersion}`);

      // ✅ Restore Java Environment Variables
      console.log(`🔧 Restoring environment variables for Java ${previousJavaVersion}...`);
      const envCommands = `
        sudo sed -i '/^export JAVA_HOME=/d' /etc/profile
        sudo sed -i '/^export PATH=.*JAVA_HOME/d' /etc/profile
        sudo sed -i '/^JAVA_HOME=/d' /etc/environment

        echo 'export JAVA_HOME=/opt/openjdk-${previousJavaVersion}' | sudo tee -a /etc/profile
        echo 'export PATH=$JAVA_HOME/bin:$PATH' | sudo tee -a /etc/profile
        echo 'JAVA_HOME=/opt/openjdk-${previousJavaVersion}' | sudo tee -a /etc/environment
      `;
      await runCommand(envCommands);
      await runCommand(`bash -c "source /etc/profile"`); // Apply changes

      console.log(`✅ Java ${previousJavaVersion} rollback and environment restore completed.`);
    } else {
      console.warn(`⚠️ No Java backup found for version ${previousJavaVersion}. Skipping rollback.`);
    }

    // ✅ Restore Tomcat from backup
    if (fs.existsSync(tomcatBackupDir)) {
      console.log(`♻️ Restoring Tomcat ${previousTomcatVersion} from backup...`);
      await runCommand(`sudo rm -rf /opt/tomcat-*`);
      await runCommand(`sudo cp -r ${tomcatBackupDir} /opt/tomcat-${previousTomcatVersion}`);

      // ✅ Ensure the 'tomcat' group and user exist
      await ensureTomcatUserAndGroup();

      // ✅ Set correct ownership and permissions
      console.log(`🔧 Setting permissions and ownership for Tomcat ${previousTomcatVersion}...`);
      await runCommand(`sudo chown -R tomcat:tomcat /opt/tomcat-${previousTomcatVersion}/`);
      await runCommand(`sudo chmod -R 755 /opt/tomcat-${previousTomcatVersion}/`);
      await runCommand(`sudo chmod -R +x /opt/tomcat-${previousTomcatVersion}/bin/*.sh`);

      // ✅ Restart Tomcat systemd service
      console.log(`⚙️ Restarting Tomcat service for version ${previousTomcatVersion}...`);
      await runCommand(`sudo service tomcat-${previousTomcatVersion} restart || sudo /opt/tomcat-${previousTomcatVersion}/bin/shutdown.sh && sudo /opt/tomcat-${previousTomcatVersion}/bin/startup.sh`);

      console.log(`✅ Tomcat ${previousTomcatVersion} restored and restarted.`);
    } else {
      console.warn(`⚠️ No Tomcat backup found for version ${previousTomcatVersion}. Skipping rollback.`);
    }

    console.log("✅ Rollback to previous versions completed successfully.");
  } catch (error) {
    console.error("❌ Rollback failed:", error);
  }
}

async function upgradeJava(javaVersion, javaUrl) {
  const javaDir = `/opt/openjdk-${javaVersion}`;
  const tempTarFile = `/tmp/java-${javaVersion}.tar.gz`;
  const javaBackupsDir = `/opt/java_backups`;

  try {
    await runCommand(`sudo mkdir -p ${javaBackupsDir}`);

    // ✅ Backup current Java version
    const existingJava = await runCommand(`ls /opt | grep 'openjdk-' | head -n 1`);
    if (existingJava) {
      const backupDest = path.join(javaBackupsDir, existingJava);
      await createBackup(`/opt/${existingJava}`, backupDest);
      await runCommand(`sudo rm -rf /opt/${existingJava}`);
    }

    console.log(`🚀 Upgrading Java ${javaVersion} from ${javaUrl}...`);
    await runCommand(`sudo dnf update && sudo dnf install -y wget`);

    // ✅ Check if Java download succeeds before upgrading
    try {
      await runCommand(`sudo wget -q "${javaUrl}" -O "${tempTarFile}"`);
    } catch (error) {
      console.error("❌ Java download failed. Rolling back...");
      const { currentTomcatVersion } = await getCurrentVersions();
      await rollbackUpgrade(javaVersion, currentTomcatVersion);
      throw error;
    }

    await runCommand(`sudo tar -xzf "${tempTarFile}" -C /opt`);

    // ✅ Rename extracted folder
    const extractedFolder = await runCommand(`ls /opt | grep 'jdk-' | head -n 1`);
    if (extractedFolder) {
      await runCommand(`sudo mv /opt/${extractedFolder} ${javaDir}`);
    }

    await runCommand(`rm -f ${tempTarFile}`);

    // ✅ Update Environment Variables
    const envCommands = `
      sudo sed -i '/^export JAVA_HOME=/d' /etc/profile
      sudo sed -i '/^export PATH=.*JAVA_HOME/d' /etc/profile
      sudo sed -i '/^JAVA_HOME=/d' /etc/environment

      echo 'export JAVA_HOME=${javaDir}' | sudo tee -a /etc/profile
      echo 'export PATH=$JAVA_HOME/bin:$PATH' | sudo tee -a /etc/profile
      echo 'JAVA_HOME=${javaDir}' | sudo tee -a /etc/environment
    `;

    await runCommand(envCommands);
    await runCommand(`bash -c "source /etc/profile"`);

    console.log(`✅ Java ${javaVersion} upgraded successfully.`);
    return true; // ✅ Java upgrade successful
  } catch (error) {
    console.error(`❌ Java upgrade failed: ${error}`);
    throw error;
  }
}

async function upgradeTomcat(tomcatVersion, tomcatUrl, javaVersion) {
  const tomcatDir = `/opt/tomcat-${tomcatVersion}`;
  const tempTarFile = `/tmp/tomcat-${tomcatVersion}.tar.gz`;
  const tomcatBackupsDir = `/opt/tomcat_backups`;

  try {
    await runCommand(`sudo mkdir -p ${tomcatBackupsDir}`);

    // ✅ Backup current Tomcat version
    const existingTomcat = await runCommand(
      `ls /opt | grep 'tomcat-' | head -n 1`
    );
    if (existingTomcat) {
      const backupDest = path.join(tomcatBackupsDir, existingTomcat);
      await createBackup(`/opt/${existingTomcat}`, backupDest);
      await runCommand(`sudo rm -rf /opt/${existingTomcat}`);
    }

    console.log(`🚀 Upgrading Tomcat ${tomcatVersion} from ${tomcatUrl}...`);

    // ✅ Check if Tomcat download succeeds before upgrading
    try {
      await runCommand(`sudo wget -q "${tomcatUrl}" -O "${tempTarFile}"`);
    } catch (error) {
      console.error("❌ Tomcat download failed. Rolling back...");

      // ✅ Get previous Java version dynamically
      const { currentJavaVersion, currentTomcatVersion } = await getCurrentVersions();
      await rollbackUpgrade(currentJavaVersion, currentTomcatVersion);
      
      throw error;
    }

    await runCommand(`sudo tar -xzf "${tempTarFile}" -C /opt`);

    // ✅ Extracted folder is named `apache-tomcat-11.0.3`. Rename it to `tomcat-11.0.3`
    const extractedFolder = await runCommand(
      `ls /opt | grep 'apache-tomcat-' | head -n 1`
    );
    if (extractedFolder) {
      await runCommand(`sudo mv /opt/${extractedFolder} ${tomcatDir}`);
    }

    await runCommand(`rm -f ${tempTarFile}`);

    // ✅ Ensure the 'tomcat' group and user exist
    await ensureTomcatUserAndGroup();

    // ✅ Set correct ownership and permissions
    await runCommand(`sudo chown -R tomcat:tomcat ${tomcatDir}`);
    await runCommand(`sudo chmod -R 755 ${tomcatDir}`);
    await runCommand(`sudo chmod -R +x ${tomcatDir}/bin/*.sh`);

    // ✅ Create new Tomcat systemd service
    const serviceFilePath = `/etc/systemd/system/tomcat-${tomcatVersion}.service`;
    const serviceFileContent = `
[Unit]
Description=Apache Tomcat ${tomcatVersion}
After=network.target

[Service]
User=tomcat
Group=tomcat
Environment="JAVA_HOME=/opt/openjdk-${javaVersion}"
Environment="CATALINA_HOME=${tomcatDir}"
ExecStart=${tomcatDir}/bin/catalina.sh run
ExecStop=${tomcatDir}/bin/shutdown.sh
Restart=always

[Install]
WantedBy=multi-user.target
`;

    console.log("⚙️ Creating Tomcat systemd service...");
    await runCommand(
      `echo '${serviceFileContent}' | sudo tee ${serviceFilePath}`
    );
    await runCommand(`sudo chmod 644 ${serviceFilePath}`);
    await runCommand(`sudo chown root:root ${serviceFilePath}`);

    // ✅ Ensure the 'tomcat' group and user exist (redundant check for safety)
    await ensureTomcatUserAndGroup();

    // ✅ Set ownership and permissions again (redundant for safety)
    await runCommand(`sudo chown -R tomcat:tomcat /opt/tomcat-${tomcatVersion}/`);
    await runCommand(`sudo chmod -R 755 /opt/tomcat-${tomcatVersion}/`);
    await runCommand(`sudo chmod -R +x /opt/tomcat-${tomcatVersion}/bin/*.sh`);

    // ✅ Restart Tomcat
    await runCommand(`sudo /opt/tomcat-${tomcatVersion}/bin/shutdown.sh`);
    await runCommand(`sudo /opt/tomcat-${tomcatVersion}/bin/startup.sh`);

    console.log(`✅ Tomcat ${tomcatVersion} upgraded successfully.`);

    // ✅ DELETE OLD TOMCAT SERVICE FILE
    console.log("🗑️ Checking for old Tomcat service files...");
    const oldServices = await runCommand(
      `ls /etc/systemd/system | grep 'tomcat-' | grep -v 'tomcat-${tomcatVersion}' || true`
    );

    if (oldServices) {
      const oldServiceList = oldServices.split("\n");
      for (const oldService of oldServiceList) {
        console.log(
          `🗑️ Removing old Tomcat service file: /etc/systemd/system/${oldService}`
        );
        await runCommand(`sudo rm -f /etc/systemd/system/${oldService}`);
      }
      await runCommand(`sudo systemctl daemon-reload`);
    }
  } catch (error) {
    console.error(`❌ Tomcat upgrade failed: ${error}`);
    throw error;
  }
}

async function upgrade() {
  try {
    console.log("🚀 Starting upgrade process...");
    const { javaVersion, javaUrl, tomcatVersion, tomcatUrl } = await readUpgradeConfiguration();
    const { currentJavaVersion, currentTomcatVersion } = await getCurrentVersions();

    // ✅ Validate if upgrade is needed
    await validateUpgradeConditions(javaVersion, tomcatVersion);

    // ✅ Attempt Java upgrade
    let javaUpgraded = false;
    try {
      javaUpgraded = await upgradeJava(javaVersion, javaUrl);
    } catch (error) {
      console.error("❌ Java upgrade failed. Aborting process.");
      return; // Stop if Java upgrade fails
    }

    // ✅ Attempt Tomcat upgrade
    try {
      await upgradeTomcat(tomcatVersion, tomcatUrl, javaVersion);
	    await runCommand(`sudo systemctl daemon-reload`);
      console.log("✅ Upgrade completed successfully.");
    } catch (error) {
      console.error("❌ Tomcat upgrade failed. Rolling back...");
      
      // ✅ Rollback Java if it was upgraded but Tomcat failed
      if (javaUpgraded) {
        console.log(`🔄 Rolling back Java ${javaVersion} to ${currentJavaVersion} since Tomcat failed...`);
        await rollbackUpgrade(currentJavaVersion, currentTomcatVersion);
      }

      throw error;
    }
  } catch (error) {
    console.error("❌ Upgrade process failed:", error);
  }
}

module.exports = { upgrade };