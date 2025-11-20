#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

class CronJobManager {
  constructor() {
    this.isWindows = process.platform === 'win32';
    this.cronJobs = [
      {
        name: "Redis Memory Monitor",
        schedule: "*/5 * * * *", // Every 5 minutes
        command: `node "${path.join(projectRoot, 'scripts', 'redis-memory-monitor.js')}"`,
        description: "Monitor Redis memory usage and cleanup"
      },
      {
        name: "Alert System Health Check",
        schedule: "*/2 * * * *", // Every 2 minutes
        command: `node "${path.join(projectRoot, 'scripts', 'alert-health-check.js')}"`,
        description: "Check alert system health and restart if needed"
      },
      {
        name: "Database Cleanup",
        schedule: "0 2 * * *", // Daily at 2 AM
        command: `node "${path.join(projectRoot, 'scripts', 'database-cleanup.js')}"`,
        description: "Clean old alert history and expired data"
      }
    ];
  }

  async setupCronJobs() {
    console.log("🚀 Setting up cron jobs for alert system monitoring...");
    
    if (this.isWindows) {
      await this.setupWindowsScheduledTasks();
    } else {
      await this.setupLinuxCronJobs();
    }
  }

  async setupWindowsScheduledTasks() {
    console.log("🪟 Setting up Windows Scheduled Tasks...");
    
    for (const job of this.cronJobs) {
      try {
        await this.createWindowsTask(job);
        console.log(`✅ Created Windows task: ${job.name}`);
      } catch (error) {
        console.error(`❌ Failed to create Windows task ${job.name}:`, error.message);
      }
    }
  }

  async createWindowsTask(job) {
    return new Promise((resolve, reject) => {
      // Convert cron schedule to Windows Task Scheduler format
      const taskName = `AlertSystem_${job.name.replace(/\s+/g, '_')}`;
      
      // Create XML for task definition
      const taskXml = this.generateTaskXml(job, taskName);
      const tempXmlFile = path.join(process.env.TEMP || 'C:\\temp', `${taskName}.xml`);
      
      // Write XML to temporary file
      fs.writeFileSync(tempXmlFile, taskXml);
      
      // Create the scheduled task
      const schtasksCmd = `schtasks /create /tn "${taskName}" /xml "${tempXmlFile}" /f`;
      
      const process = spawn('cmd', ['/c', schtasksCmd], { 
        stdio: 'pipe',
        shell: true 
      });
      
      let output = '';
      let error = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      process.on('close', (code) => {
        // Clean up temporary file
        try {
          fs.unlinkSync(tempXmlFile);
        } catch (e) {
          // Ignore cleanup errors
        }
        
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Task creation failed: ${error || output}`));
        }
      });
    });
  }

  generateTaskXml(job, taskName) {
    const interval = this.cronToWindowsInterval(job.schedule);
    
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>${new Date().toISOString()}</Date>
    <Author>Alert System</Author>
    <Description>${job.description}</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>${interval}</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>${new Date().toISOString()}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd</Command>
      <Arguments>/c "${job.command}"</Arguments>
      <WorkingDirectory>${projectRoot}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
  }

  cronToWindowsInterval(cronSchedule) {
    // Simple cron to Windows interval conversion
    // This is a basic implementation - you might need more sophisticated parsing
    if (cronSchedule === "*/5 * * * *") return "PT5M"; // Every 5 minutes
    if (cronSchedule === "*/2 * * * *") return "PT2M"; // Every 2 minutes
    if (cronSchedule === "0 2 * * *") return "P1D"; // Daily (will need different trigger type)
    
    return "PT5M"; // Default to 5 minutes
  }

  async setupLinuxCronJobs() {
    console.log("🐧 Setting up Linux cron jobs...");
    
    // Generate crontab entries
    let cronEntries = "\n# Alert System Monitoring Jobs\n";
    
    for (const job of this.cronJobs) {
      cronEntries += `# ${job.description}\n`;
      cronEntries += `${job.schedule} ${job.command} >> /var/log/alert-system-cron.log 2>&1\n\n`;
    }
    
    // Write to temporary crontab file
    const tempCronFile = '/tmp/alert-system-crontab';
    fs.writeFileSync(tempCronFile, cronEntries);
    
    console.log("📄 Generated crontab entries:");
    console.log(cronEntries);
    
    console.log("\n📋 To install these cron jobs, run:");
    console.log(`sudo crontab -l > /tmp/current-crontab`);
    console.log(`cat ${tempCronFile} >> /tmp/current-crontab`);
    console.log(`sudo crontab /tmp/current-crontab`);
    
    // Also create a shell script for easy installation
    const installScript = `#!/bin/bash
echo "Installing Alert System cron jobs..."
crontab -l > /tmp/current-crontab 2>/dev/null || true
cat ${tempCronFile} >> /tmp/current-crontab
crontab /tmp/current-crontab
echo "✅ Cron jobs installed successfully"
crontab -l | tail -10
`;
    
    fs.writeFileSync(path.join(projectRoot, 'install-cron.sh'), installScript);
    fs.chmodSync(path.join(projectRoot, 'install-cron.sh'), '755');
    
    console.log(`\n🚀 Or run the installation script: ./install-cron.sh`);
  }

  async listExistingTasks() {
    console.log("📋 Checking existing scheduled tasks...");
    
    if (this.isWindows) {
      try {
        const result = await this.runCommand('schtasks /query /fo csv | findstr AlertSystem');
        console.log("Current Alert System tasks:");
        console.log(result || "No existing tasks found");
      } catch (error) {
        console.log("No existing Alert System tasks found");
      }
    } else {
      try {
        const result = await this.runCommand('crontab -l | grep -i alert');
        console.log("Current Alert System cron jobs:");
        console.log(result || "No existing cron jobs found");
      } catch (error) {
        console.log("No existing Alert System cron jobs found");
      }
    }
  }

  async removeExistingTasks() {
    console.log("🧹 Removing existing Alert System tasks...");
    
    if (this.isWindows) {
      const taskNames = [
        'AlertSystem_Redis_Memory_Monitor',
        'AlertSystem_Alert_System_Health_Check',
        'AlertSystem_Database_Cleanup'
      ];
      
      for (const taskName of taskNames) {
        try {
          await this.runCommand(`schtasks /delete /tn "${taskName}" /f`);
          console.log(`✅ Removed task: ${taskName}`);
        } catch (error) {
          // Task might not exist, ignore error
        }
      }
    } else {
      console.log("⚠️ Please manually remove Alert System entries from crontab using: crontab -e");
    }
  }

  runCommand(command) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, { 
        stdio: 'pipe',
        shell: true 
      });
      
      let output = '';
      let error = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(error || output));
        }
      });
    });
  }
}

// Command line interface
async function main() {
  const manager = new CronJobManager();
  
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'install':
        await manager.setupCronJobs();
        break;
        
      case 'list':
        await manager.listExistingTasks();
        break;
        
      case 'remove':
        await manager.removeExistingTasks();
        break;
        
      default:
        console.log("🔧 Alert System Cron Job Manager");
        console.log("\nUsage:");
        console.log("  node setup-cron-jobs.js install  - Install cron jobs");
        console.log("  node setup-cron-jobs.js list     - List existing tasks");
        console.log("  node setup-cron-jobs.js remove   - Remove existing tasks");
        break;
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default CronJobManager;
