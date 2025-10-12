# 🚀 Real-Time Alert System

## Overview

This is a **TradingView-level real-time alert system** that monitors live cryptocurrency market data and triggers alerts instantly when conditions are met. The system uses WebSocket streaming, Redis caching, and event-driven processing for ultra-fast performance.

## ⚡ Performance Features

- **Sub-second response time** - Alerts trigger in <1 second
- **Live WebSocket streaming** - No polling delays
- **Memory-based processing** - No database hits per check
- **Redis caching** - Ultra-fast data access
- **Event-driven architecture** - Processes only when data changes

## 🏗️ System Architecture

### 1. Real-Time WebSocket Service
- **Direct Binance WebSocket** connection
- **Live price streaming** for all USDT pairs
- **Auto-reconnection** with retry logic
- **Memory-efficient** processing

### 2. Real-Time Alert Processor
- **Loads alerts from Redis** for fast access
- **Instant condition checking** on every price update
- **Comprehensive condition evaluation**
- **Alert locking system** prevents spam

### 3. Real-Time Notification Service
- **Real-time notifications** to frontend
- **Redis-based persistence** for history
- **User-specific subscriptions**
- **Notification management** (mark as read, clear)

### 4. Real-Time Alert Worker
- **Event-driven architecture** - no cron jobs
- **WebSocket integration** - listens to live data
- **Instant processing** - milliseconds response
- **Graceful shutdown** handling

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Environment Variables
```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017/alerts-dashboard

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Start All Services
```bash
# Start everything (Next.js + Workers)
npm run dev:all

# Or start individually:
npm run dev              # Next.js frontend
npm run worker           # Binance data worker
npm run real-time-worker # Real-time alert worker
```

### 4. Test Real-Time System
```bash
# Test WebSocket connection and data flow
npm run test-real-time
```

## 📊 Supported Alert Conditions

### Required Conditions
- ✅ **Min Daily Volume** - Minimum volume requirement
- ✅ **Change %** - Price change percentage

### Optional Conditions
- ✅ **Alert Count** - Time-based locking system
- ✅ **Candle Conditions** - Technical analysis
- ✅ **RSI Range** - RSI-based alerts
- ✅ **Volume Analysis** - Volume pattern detection
- ✅ **EMA Conditions** - Moving average alerts

## 🔧 API Endpoints

### Real-Time Notifications
- `GET /api/notifications/stream` - Server-Sent Events for live notifications
- `GET /api/notifications` - Get notification history
- `POST /api/notifications` - Mark notification as read
- `DELETE /api/notifications` - Clear all notifications

### Alert Management
- `POST /api/alerts/bulk` - Create alerts for all favorite pairs
- `GET /api/alerts/triggered` - Get triggered alerts
- `DELETE /api/alerts/clear` - Clear all alerts

### Favorites Management
- `POST /api/favorites/add` - Add symbol to favorites
- `POST /api/favorites/remove` - Remove symbol from favorites
- `POST /api/favorites/bulk` - Bulk add/remove favorites
- `GET /api/favorites/list` - Get all favorites

## 🎯 Real-Time Flow

```
1. User creates alerts → Saved to MongoDB + Redis
2. Worker loads alerts → Stored in memory for instant access
3. WebSocket connects → Live Binance data streaming
4. Price update arrives → Instant condition check
5. Conditions met → Alert triggered in <1 second
6. Notification sent → Real-time frontend update
7. Alert locked → Prevents spam (if alert count set)
```

## 📈 Performance Metrics

| Operation | Time | Method |
|-----------|------|--------|
| **Price Update** | <10ms | WebSocket streaming |
| **Condition Check** | <1ms | Memory-based |
| **Alert Trigger** | <100ms | Instant processing |
| **Notification** | <50ms | Real-time delivery |
| **Total Response** | **<1 second** | **End-to-end** |

## 🔥 Key Features

### Ultra-Fast Processing
- ⚡ **WebSocket streaming** - No polling delays
- ⚡ **Redis caching** - Sub-millisecond data access
- ⚡ **Memory-based alerts** - No database queries per check
- ⚡ **Event-driven** - Processes only when data changes

### Scalable Architecture
- 📈 **Single-threaded Node.js** - Lightning fast
- 📈 **Redis pub/sub** - Handles multiple users
- 📈 **WebSocket efficiency** - One connection for all data
- 📈 **Memory optimization** - Cleans up processed alerts

### Smart Alert Management
- 🧠 **Alert locking** - Prevents spam with time-based locks
- 🧠 **Condition validation** - Ensures data integrity
- 🧠 **User-specific** - Only relevant notifications
- 🧠 **Persistent storage** - Alerts saved in MongoDB

## 🎉 User Experience

- ✅ **Instant alerts** - No delays, real-time triggers
- ✅ **Live notifications** - See alerts as they happen
- ✅ **Smart locking** - No spam, perfect timing
- ✅ **Comprehensive data** - Price, volume, conditions, time
- ✅ **TradingView-level** performance and accuracy

## 🛠️ Development

### File Structure
```
├── services/
│   ├── WebSocketService.js          # Real-time WebSocket connection
│   ├── RealTimeAlertProcessor.js    # Alert condition evaluation
│   └── NotificationService.js       # Real-time notifications
├── workers/
│   └── real-time-alert-worker.js    # Main worker process
├── components/
│   └── RealTimeNotifications.js     # Frontend notification component
└── app/api/notifications/
    ├── stream/route.js              # SSE endpoint
    └── route.js                     # REST API endpoints
```

### Testing
```bash
# Test WebSocket connection
npm run test-real-time

# Test individual components
node services/WebSocketService.js
node services/RealTimeAlertProcessor.js
```

## 🚨 Troubleshooting

### Common Issues

1. **WebSocket Connection Failed**
   - Check if Binance API is accessible
   - Verify network connectivity
   - Check firewall settings

2. **Redis Connection Failed**
   - Ensure Redis server is running
   - Check Redis host/port configuration
   - Verify Redis authentication

3. **MongoDB Connection Failed**
   - Ensure MongoDB is running
   - Check connection string
   - Verify database permissions

### Debug Mode
```bash
# Enable debug logging
DEBUG=* npm run real-time-worker
```

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue on GitHub
- Check the troubleshooting section
- Review the API documentation

---

**Built with ❤️ for real-time cryptocurrency trading alerts**
