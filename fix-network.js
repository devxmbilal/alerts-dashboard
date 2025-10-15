#!/usr/bin/env node

// 🔧 Network Fix Script
// Attempts to fix common network connectivity issues

import { execSync } from 'child_process';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkSystemInfo() {
  log('\n🔍 Checking System Information...', 'blue');
  
  try {
    // Check Node.js version
    const nodeVersion = process.version;
    log(`✅ Node.js version: ${nodeVersion}`, 'green');
    
    // Check if we're on Windows
    const isWindows = process.platform === 'win32';
    log(`🖥️  Platform: ${process.platform}`, isWindows ? 'yellow' : 'blue');
    
    // Check available memory
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    log(`💾 Memory usage: ${memMB}MB`, 'blue');
    
    return { nodeVersion, isWindows, memMB };
  } catch (error) {
    log(`❌ System check failed: ${error.message}`, 'red');
    return null;
  }
}

function suggestNetworkFixes() {
  log('\n🔧 NETWORK TROUBLESHOOTING SUGGESTIONS', 'bold');
  log('=======================================', 'bold');
  
  log('\n1. 🌐 DNS Issues:', 'blue');
  log('   - Try using Google DNS: 8.8.8.8, 8.8.4.4', 'yellow');
  log('   - Try using Cloudflare DNS: 1.1.1.1, 1.0.0.1', 'yellow');
  log('   - Check /etc/resolv.conf (Linux) or network settings (Windows)', 'yellow');
  
  log('\n2. 🔥 Firewall Issues:', 'blue');
  log('   - Check if ports 80, 443, 9443 are blocked', 'yellow');
  log('   - Temporarily disable firewall for testing', 'yellow');
  log('   - Add exceptions for Node.js and your application', 'yellow');
  
  log('\n3. 🌍 Proxy Issues:', 'blue');
  log('   - Check if you\'re behind a corporate proxy', 'yellow');
  log('   - Set HTTP_PROXY and HTTPS_PROXY environment variables', 'yellow');
  log('   - Configure proxy settings in your application', 'yellow');
  
  log('\n4. 🚫 Network Restrictions:', 'blue');
  log('   - Some networks block Binance APIs', 'yellow');
  log('   - Try using a VPN or different network', 'yellow');
  log('   - Check if your ISP blocks cryptocurrency-related domains', 'yellow');
  
  log('\n5. 🔧 Application Configuration:', 'blue');
  log('   - Increase timeout values in your code', 'yellow');
  log('   - Add retry logic with exponential backoff', 'yellow');
  log('   - Use alternative API endpoints', 'yellow');
}

async function createNetworkTestScript() {
  log('\n🧪 Creating Network Test Script...', 'blue');
  
  const testScript = `#!/usr/bin/env node

// Quick network test
import fetch from 'node-fetch';

async function quickTest() {
  console.log('🧪 Quick Network Test');
  
  const endpoints = [
    'https://api.binance.com/api/v3/ping',
    'https://api1.binance.com/api/v3/ping',
    'https://api2.binance.com/api/v3/ping'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(\`Testing \${endpoint}...\`);
      const response = await fetch(endpoint, { timeout: 10000 });
      if (response.ok) {
        console.log(\`✅ \${endpoint} - OK\`);
        return true;
      }
    } catch (error) {
      console.log(\`❌ \${endpoint} - \${error.message}\`);
    }
  }
  
  console.log('❌ All endpoints failed');
  return false;
}

quickTest();
`;
  
  try {
    const fs = await import('fs');
    fs.writeFileSync('quick-network-test.js', testScript);
    log('✅ Created quick-network-test.js', 'green');
    log('   Run: node quick-network-test.js', 'yellow');
  } catch (error) {
    log(`❌ Failed to create test script: ${error.message}`, 'red');
  }
}

function showAlternativeSolutions() {
  log('\n🔄 ALTERNATIVE SOLUTIONS', 'bold');
  log('========================', 'bold');
  
  log('\n1. 📡 Use Alternative Data Sources:', 'blue');
  log('   - CoinGecko API: https://api.coingecko.com/api/v3', 'yellow');
  log('   - CoinMarketCap API: https://pro-api.coinmarketcap.com', 'yellow');
  log('   - CryptoCompare API: https://min-api.cryptocompare.com', 'yellow');
  
  log('\n2. 🔧 Modify Worker Configuration:', 'blue');
  log('   - Increase timeout values', 'yellow');
  log('   - Add more retry attempts', 'yellow');
  log('   - Use different user agents', 'yellow');
  log('   - Implement circuit breaker pattern', 'yellow');
  
  log('\n3. 🌐 Network Configuration:', 'blue');
  log('   - Use different DNS servers', 'yellow');
  log('   - Configure proxy settings', 'yellow');
  log('   - Use VPN or different network', 'yellow');
  log('   - Check firewall rules', 'yellow');
  
  log('\n4. 🚀 Deployment Options:', 'blue');
  log('   - Deploy to different server/region', 'yellow');
  log('   - Use cloud services (AWS, DigitalOcean, etc.)', 'yellow');
  log('   - Use containerized deployment', 'yellow');
  log('   - Implement load balancing', 'yellow');
}

async function runNetworkFix() {
  log('🔧 NETWORK TROUBLESHOOTING TOOL', 'bold');
  log('================================', 'bold');
  
  const systemInfo = checkSystemInfo();
  
  if (systemInfo) {
    log('\n📊 System Information:', 'blue');
    log(`   Node.js: ${systemInfo.nodeVersion}`, 'blue');
    log(`   Platform: ${process.platform}`, 'blue');
    log(`   Memory: ${systemInfo.memMB}MB`, 'blue');
  }
  
  suggestNetworkFixes();
  await createNetworkTestScript();
  showAlternativeSolutions();
  
  log('\n🎯 NEXT STEPS:', 'bold');
  log('==============', 'bold');
  
  log('\n1. Run network diagnostic:', 'blue');
  log('   node test-network.js', 'yellow');
  
  log('\n2. Test with quick script:', 'blue');
  log('   node quick-network-test.js', 'yellow');
  
  log('\n3. Check your network configuration', 'blue');
  log('   - DNS settings', 'yellow');
  log('   - Firewall rules', 'yellow');
  log('   - Proxy settings', 'yellow');
  
  log('\n4. Try alternative solutions:', 'blue');
  log('   - Different network/VPN', 'yellow');
  log('   - Alternative data sources', 'yellow');
  log('   - Different server location', 'yellow');
  
  log('\n💡 If all else fails, consider using:', 'green');
  log('   - CoinGecko API as fallback', 'green');
  log('   - Different server/region', 'green');
  log('   - VPN or proxy service', 'green');
}

runNetworkFix().catch(error => {
  log(`\n💥 Network fix tool failed: ${error.message}`, 'red');
  process.exit(1);
});
