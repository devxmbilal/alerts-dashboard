#!/usr/bin/env node

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

async function testRedisConnection() {
  console.log('🔍 Testing Redis connection and alert publishing...');
  
  try {
    // Test Redis connection
    const redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: true,
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
    });

    await redis.ping();
    console.log('✅ Redis connection successful');

    // Test alert publishing
    const testAlert = {
      type: "alert_triggered",
      alertId: "test_alert_123",
      historyId: "test_history_123",
      userId: "test_user_123",
      symbol: "BTCUSDT",
      triggeredAt: new Date(),
      triggeredPrice: 50000.00,
      triggeredVolume: 1000000,
      triggeredChange: 2.5,
      conditions: { changePercent: { percentage: 2.0, direction: "increase" } },
      targetValue: 2.0,
      actualValue: 2.5,
      direction: "increase",
      timeframe: "5MIN",
      baselinePrice: 49000.00,
      changeFromBaselinePercent: 2.5,
    };

    // Publish to alert triggers channel
    await redis.publish("alert:triggers", JSON.stringify(testAlert));
    console.log('✅ Test alert published to alert:triggers channel');

    // Publish to notifications channel
    await redis.publish("notifications:alerts", JSON.stringify({
      type: "new_alert",
      userId: "test_user_123",
      symbol: "BTCUSDT",
      timestamp: new Date(),
      alertId: "test_alert_123",
    }));
    console.log('✅ Test notification published to notifications:alerts channel');

    // Test subscription
    const subscriber = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
    });

    await subscriber.subscribe("alert:triggers");
    console.log('✅ Subscribed to alert:triggers channel');

    subscriber.on('message', (channel, message) => {
      console.log(`📨 Received message on ${channel}:`, JSON.parse(message));
    });

    // Wait for messages
    console.log('⏳ Waiting for messages... (Press Ctrl+C to stop)');
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      await redis.quit();
      await subscriber.quit();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Redis test failed:', error);
    process.exit(1);
  }
}

testRedisConnection();
