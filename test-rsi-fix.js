#!/usr/bin/env node

/**
 * 🛡️ RSI Queue System Test
 * Tests the new queue system to prevent 418 errors
 */

import RealTimeAlertProcessor from './services/RealTimeAlertProcessor.js';

async function testRsiQueueSystem() {
  console.log('🧪 Testing RSI Queue System...\n');
  
  // Test symbols
  const testSymbols = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT'];
  const timeframes = ['5MIN', '15MIN', '1HR'];
  
  console.log('📊 Initial RSI Queue Status:');
  console.log(RealTimeAlertProcessor.getRsiQueueStatus());
  console.log('');
  
  // Simulate multiple simultaneous RSI requests (this would cause 418 before)
  console.log('🚀 Simulating multiple simultaneous RSI requests...');
  
  const promises = [];
  for (const symbol of testSymbols) {
    for (const timeframe of timeframes) {
      promises.push(
        RealTimeAlertProcessor.getRSI(symbol, timeframe, 14)
          .then(result => {
            if (result) {
              console.log(`✅ ${symbol} ${timeframe}: RSI = ${result.current?.toFixed(2) || 'N/A'}`);
            } else {
              console.log(`⏳ ${symbol} ${timeframe}: Queued for background fetch`);
            }
          })
          .catch(err => {
            console.log(`❌ ${symbol} ${timeframe}: Error = ${err.message}`);
          })
      );
    }
  }
  
  // Wait for all requests
  await Promise.all(promises);
  
  console.log('\n📊 Final RSI Queue Status:');
  console.log(RealTimeAlertProcessor.getRsiQueueStatus());
  
  // Wait a bit to see queue processing
  console.log('\n⏳ Waiting 10 seconds to observe queue processing...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  console.log('\n📊 Queue Status After 10 seconds:');
  console.log(RealTimeAlertProcessor.getRsiQueueStatus());
  
  console.log('\n✅ Test completed! The queue system should prevent 418 errors.');
  console.log('🛡️ Multiple requests are now processed sequentially with delays.');
}

// Run test
testRsiQueueSystem().catch(console.error);