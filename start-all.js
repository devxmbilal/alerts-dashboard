#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting Crypto Alerts Dashboard with all workers...');

// Start Next.js dev server
const devServer = spawn('npm', ['run', 'dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

// Start Binance worker
const binanceWorker = spawn('npm', ['run', 'worker'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

// Start Alert worker
const alertWorker = spawn('npm', ['run', 'alert-worker'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

// Start Cleanup worker
const cleanupWorker = spawn('npm', ['run', 'cleanup-worker'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down all processes...');
  
  devServer.kill('SIGINT');
  binanceWorker.kill('SIGINT');
  alertWorker.kill('SIGINT');
  cleanupWorker.kill('SIGINT');
  
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down all processes...');
  
  devServer.kill('SIGTERM');
  binanceWorker.kill('SIGTERM');
  alertWorker.kill('SIGTERM');
  cleanupWorker.kill('SIGTERM');
  
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

// Handle worker crashes
devServer.on('close', (code) => {
  console.log(`❌ Dev server exited with code ${code}`);
});

binanceWorker.on('close', (code) => {
  console.log(`❌ Binance worker exited with code ${code}`);
});

alertWorker.on('close', (code) => {
  console.log(`❌ Alert worker exited with code ${code}`);
});

cleanupWorker.on('close', (code) => {
  console.log(`❌ Cleanup worker exited with code ${code}`);
});

console.log('✅ All processes started successfully!');
console.log('📱 Dashboard: http://localhost:3000');
console.log('🔧 Workers: Binance, Alert, Cleanup');
console.log('🛑 Press Ctrl+C to stop all processes');
