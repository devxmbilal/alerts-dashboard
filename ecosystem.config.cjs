/**
 * PM2 Ecosystem Configuration
 * 
 * LOG ROTATION SETUP (Run on server):
 * pm2 install pm2-logrotate
 * pm2 set pm2-logrotate:max_size 10M
 * pm2 set pm2-logrotate:retain 5
 * pm2 set pm2-logrotate:compress true
 * pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
 */
module.exports = {
  apps: [
    {
      name: "alerts-dashboard",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        LOG_LEVEL: "error", // Only log errors in production
      },
      // Wait for binance-worker to populate Redis before accepting requests
      wait_ready: false,
      listen_timeout: 10000,
      kill_timeout: 5000,
      // Minimal logging - only errors
      error_file: "./logs/alerts-dashboard-error.log",
      out_file: "/dev/null",
      log_file: "/dev/null",
      time: true,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "binance-worker",
      script: "workers/binance-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_file: ".env.local",
      env: {
        NODE_ENV: "production",
        REDIS_HOST: "localhost",
        REDIS_PORT: 6379,
        MONGODB_URI: "mongodb://127.0.0.1:27017/crypto-alerts",
        LOG_LEVEL: "error",
      },
      // Minimal logging - only errors
      error_file: "./logs/binance-worker-error.log",
      out_file: "./logs/binance-worker.log",
      log_file: "./logs/binance-worker.log",
      time: true,
    },
    {
      name: "alert-worker",
      script: "workers/alert-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        REDIS_HOST: "localhost",
        REDIS_PORT: 6379,
        MONGODB_URI: "mongodb://127.0.0.1:27017/crypto-alerts",
        LOG_LEVEL: "error",
      },
      // Minimal logging - only errors
      error_file: "./logs/alert-worker-error.log",
      out_file: "/dev/null",
      log_file: "/dev/null",
      time: true,
    },
    {
      name: "cleanup-worker",
      script: "workers/cleanup-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        CLEANUP_WORKER_AUTOSTART: "true",
        LOG_LEVEL: "error",
      },
      // Minimal logging - only errors
      error_file: "./logs/cleanup-worker-error.log",
      out_file: "/dev/null",
      log_file: "/dev/null",
      time: true,
    },
    {
      name: "notify-worker",
      script: "workers/notify-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        REDIS_HOST: "localhost",
        REDIS_PORT: 6379,
        MONGODB_URI: "mongodb://127.0.0.1:27017/crypto-alerts",
        LOG_LEVEL: "error",
      },
      // Minimal logging - only errors
      error_file: "./logs/notify-worker-error.log",
      out_file: "/dev/null",
      log_file: "/dev/null",
      time: true,
    },
    {
      name: "db-queue-worker",
      script: "workers/db-queue-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        REDIS_HOST: "localhost",
        REDIS_PORT: 6379,
        MONGODB_URI: "mongodb://127.0.0.1:27017/crypto-alerts",
        LOG_LEVEL: "error",
      },
      // Minimal logging - only errors
      error_file: "./logs/db-queue-worker-error.log",
      out_file: "/dev/null",
      log_file: "/dev/null",
      time: true,
    },
  ],
};
