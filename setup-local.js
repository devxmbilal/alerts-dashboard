#!/usr/bin/env node

// 🛠️ Local Development Setup Script
// Sets up the alerts dashboard for local development

import fs from "fs";
import { execSync } from "child_process";

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function createEnvFile() {
  log("\n🔧 Creating .env.local file...", "blue");

  const envContent = `# Local Development Environment
MONGODB_URI=mongodb://localhost:27017/crypto-alerts
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-super-secure-jwt-secret-key-for-development-change-this
JWT_EXPIRES_IN=7d
NODE_ENV=development
PORT=3000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-for-development
`;

  try {
    fs.writeFileSync(".env.local", envContent);
    log("✅ .env.local file created", "green");
    return true;
  } catch (error) {
    log(`❌ Failed to create .env.local: ${error.message}`, "red");
    return false;
  }
}

function checkMongoDB() {
  log("\n🔍 Checking MongoDB...", "blue");

  try {
    execSync("mongod --version", { stdio: "pipe" });
    log("✅ MongoDB is installed", "green");
    return true;
  } catch (error) {
    log("❌ MongoDB not found", "red");
    log(
      "💡 Install MongoDB: https://www.mongodb.com/try/download/community",
      "yellow"
    );
    return false;
  }
}

function checkRedis() {
  log("\n🔍 Checking Redis...", "blue");

  try {
    execSync("redis-server --version", { stdio: "pipe" });
    log("✅ Redis is installed", "green");
    return true;
  } catch (error) {
    log("❌ Redis not found", "red");
    log("💡 Install Redis: https://redis.io/download", "yellow");
    return false;
  }
}

function startServices() {
  log("\n🚀 Starting Services...", "blue");

  const commands = [
    {
      name: "MongoDB",
      command: "mongod --fork --logpath ./logs/mongodb.log",
      check: "mongod --version",
    },
    {
      name: "Redis",
      command: "redis-server --daemonize yes",
      check: "redis-server --version",
    },
  ];

  for (const service of commands) {
    try {
      execSync(service.check, { stdio: "pipe" });
      log(`✅ ${service.name} is available`, "green");
    } catch (error) {
      log(`❌ ${service.name} not available`, "red");
    }
  }
}

function createLogsDirectory() {
  log("\n📁 Creating logs directory...", "blue");

  try {
    if (!fs.existsSync("logs")) {
      fs.mkdirSync("logs");
      log("✅ Logs directory created", "green");
    } else {
      log("✅ Logs directory already exists", "green");
    }
    return true;
  } catch (error) {
    log(`❌ Failed to create logs directory: ${error.message}`, "red");
    return false;
  }
}

function showNextSteps() {
  log("\n🎯 NEXT STEPS:", "bold");
  log("=============", "bold");

  log("\n1. Start MongoDB:", "blue");
  log("   mongod", "yellow");

  log("\n2. Start Redis:", "blue");
  log("   redis-server", "yellow");

  log("\n3. Install dependencies:", "blue");
  log("   npm install", "yellow");

  log("\n4. Setup database:", "blue");
  log("   npm run setup-db", "yellow");

  log("\n5. Start the application:", "blue");
  log("   npm run dev", "yellow");

  log("\n6. Start workers (in separate terminals):", "blue");
  log("   npm run worker", "yellow");
  log("   npm run alert-worker", "yellow");

  log("\n7. Or start everything at once:", "blue");
  log("   npm run dev:all", "yellow");

  log("\n🌐 Your application will be available at:", "green");
  log("   http://localhost:3000", "green");
}

async function setupLocal() {
  log("🛠️  ALERTS DASHBOARD LOCAL SETUP", "bold");
  log("=================================", "bold");

  const results = {
    envFile: createEnvFile(),
    logsDir: createLogsDirectory(),
    mongodb: checkMongoDB(),
    redis: checkRedis(),
  };

  startServices();
  showNextSteps();

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  log(
    `\n🎯 Setup Score: ${passed}/${total} components ready`,
    passed === total ? "green" : "yellow"
  );

  if (passed === total) {
    log("\n🚀 READY TO START DEVELOPMENT!", "green");
  } else {
    log("\n⚠️  SOME SETUP REQUIRED", "yellow");
    log("Please install missing components and try again.", "yellow");
  }
}

setupLocal().catch((error) => {
  log(`\n💥 Setup failed: ${error.message}`, "red");
  process.exit(1);
});
