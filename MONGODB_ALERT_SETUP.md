# MongoDB Alert System Setup Guide

## Complete Architecture Overview

### 1. **Data Flow**
```
User Input (FilterSidebar) → MongoDB (Alert Storage) → Redis (Pub/Sub) → Alert Worker → WebSocket (Live Alerts)
```

### 2. **Components**

#### **MongoDB** - Persistent Storage
- **Alert Model**: Stores all alert conditions
- **Triggered Alerts**: History of triggered alerts
- **User Alerts**: User-specific alert management

#### **Redis** - Real-time Processing
- **Pub/Sub Channels**:
  - `market:updates` - Live price updates
  - `alert:triggers` - Alert trigger events
- **Caching**: Active alerts for fast lookup

#### **Alert Worker** - Condition Evaluation
- Subscribes to `market:updates`
- Evaluates conditions against live data
- Publishes to `alert:triggers` when conditions match

#### **WebSocket** - Live Alerts
- Streams triggered alerts to clients
- Real-time notifications

## Setup Instructions

### 1. **Install Dependencies**
```bash
npm install mongoose ioredis dotenv
```

### 2. **Environment Variables**
Create `.env` file:
```env
MONGODB_URI=mongodb://localhost:27017/crypto-alerts
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. **Database Setup**
```bash
# Setup MongoDB indexes
node scripts/setup-database.js
```

### 4. **Start Services**
```bash
# Start all services
npm run dev:all

# Or individually:
npm run dev          # Next.js app
npm run worker       # Binance data worker
npm run alert-worker # Alert evaluation worker
```

## Alert Conditions Structure

### **Required Conditions**
```javascript
{
  minDaily: "1000000",        // Minimum daily volume
  changePercent: "1HR",       // Timeframe for change
  timeframe: "1HR",           // Alert timeframe
  percentage: "5"             // Required percentage change
}
```

### **Optional Conditions**
```javascript
{
  candle: {
    timeframes: ["5MIN", "15MIN"],
    condition: "GREEN_CANDLE"
  },
  rsiRange: {
    timeframes: ["1HR", "4HR"],
    period: "14",
    level: "70",
    condition: "ABOVE"
  },
  volume: {
    timeframes: ["1MIN", "5MIN"],
    condition: "INCREASING",
    percentage: "10"
  },
  ema: {
    timeframes: ["5MIN", "15MIN"],
    fast: "12",
    slow: "26",
    condition: "CROSSING_UP"
  }
}
```

## API Endpoints

### **Alert Management**
- `GET /api/alerts?userId=123` - Get user alerts
- `POST /api/alerts` - Create new alert
- `PUT /api/alerts` - Update alert status
- `DELETE /api/alerts?alertId=123&userId=123` - Delete alert

### **Triggered Alerts**
- `GET /api/alerts/triggered?userId=123` - Get triggered alerts
- `GET /api/alerts/stream?userId=123` - Live alert stream (SSE)

## Alert Evaluation Process

### **1. Alert Creation**
```javascript
// User selects conditions in FilterSidebar
const conditions = {
  minDaily: "1000000",
  changePercent: "1HR", 
  percentage: "5",
  candle: { timeframes: ["5MIN"], condition: "GREEN_CANDLE" }
};

// Save to MongoDB
await AlertService.createAlert(userId, symbol, conditions);
```

### **2. Live Data Processing**
```javascript
// Binance worker publishes to Redis
redis.publish('market:updates', JSON.stringify({
  type: 'market_update',
  symbol: 'BTCUSDT',
  price: '45000',
  volume: '1500000',
  priceChangePercent: '2.5'
}));
```

### **3. Alert Evaluation**
```javascript
// Alert worker evaluates conditions
const alerts = await AlertService.getActiveAlertsForSymbol('BTCUSDT');

for (const alert of alerts) {
  const shouldTrigger = await evaluateAlertConditions(alert, marketData);
  
  if (shouldTrigger) {
    await triggerAlert(alert, marketData);
  }
}
```

### **4. Alert Triggering**
```javascript
// Mark as triggered in MongoDB
await AlertService.triggerAlert(alertId, marketData);

// Publish to Redis
redis.publish('alert:triggers', JSON.stringify({
  type: 'alert_triggered',
  alertId: alert._id,
  symbol: alert.symbol,
  triggeredPrice: marketData.price,
  triggeredAt: new Date()
}));
```

### **5. Live Notifications**
```javascript
// WebSocket streams to client
const eventSource = new EventSource('/api/alerts/stream?userId=123');

eventSource.onmessage = (event) => {
  const alert = JSON.parse(event.data);
  console.log('Alert triggered:', alert);
};
```

## Database Models

### **Alert Model**
```javascript
{
  _id: ObjectId,
  symbol: String,           // e.g., "BTCUSDT"
  userId: String,           // User identifier
  conditions: {
    minDaily: String,       // Required
    changePercent: String,  // Required
    timeframe: String,      // Required
    percentage: String,      // Required
    candle: Object,         // Optional
    rsiRange: Object,       // Optional
    volume: Object,         // Optional
    ema: Object            // Optional
  },
  status: String,           // "active", "paused", "triggered", "expired"
  triggered: Boolean,
  triggeredAt: Date,
  triggeredPrice: Number,
  triggeredVolume: Number,
  triggeredChange: Number,
  notificationSettings: Object,
  createdAt: Date,
  updatedAt: Date
}
```

## Redis Channels

### **market:updates**
```javascript
{
  type: "market_update",
  symbol: "BTCUSDT",
  price: "45000",
  volume: "1500000",
  priceChangePercent: "2.5",
  timestamp: "2024-01-01T12:00:00Z"
}
```

### **alert:triggers**
```javascript
{
  type: "alert_triggered",
  alertId: "507f1f77bcf86cd799439011",
  userId: "user123",
  symbol: "BTCUSDT",
  triggeredAt: "2024-01-01T12:00:00Z",
  triggeredPrice: 45000,
  triggeredVolume: 1500000,
  triggeredChange: 2.5,
  conditions: Object,
  notificationSettings: Object
}
```

## Testing the System

### **1. Create Test Alert**
```bash
curl -X POST http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "symbol": "BTCUSDT",
    "conditions": {
      "minDaily": "1000000",
      "changePercent": "1HR",
      "timeframe": "1HR",
      "percentage": "5"
    }
  }'
```

### **2. Check Alert Status**
```bash
curl "http://localhost:3000/api/alerts?userId=test123"
```

### **3. Monitor Live Alerts**
```bash
curl "http://localhost:3000/api/alerts/stream?userId=test123"
```

## Troubleshooting

### **Common Issues**

1. **MongoDB Connection Failed**
   - Check if MongoDB is running
   - Verify MONGODB_URI in .env

2. **Redis Connection Failed**
   - Check if Redis is running
   - Verify REDIS_HOST and REDIS_PORT

3. **Alerts Not Triggering**
   - Check if alert worker is running
   - Verify market data is being published to Redis
   - Check alert conditions in database

4. **WebSocket Not Working**
   - Check if SSE endpoint is accessible
   - Verify client EventSource implementation

### **Logs to Check**
```bash
# Alert Worker logs
npm run alert-worker

# Binance Worker logs  
npm run worker

# Application logs
npm run dev
```

## Performance Optimization

### **Database Indexes**
```javascript
// Already created in setup-database.js
{ symbol: 1, status: 1 }
{ userId: 1, status: 1 }
{ createdAt: -1 }
{ triggeredAt: -1 }
```

### **Redis Caching**
- Cache active alerts by symbol
- Cache user alerts for fast lookup
- Use Redis pub/sub for real-time updates

### **Alert Worker Optimization**
- Process alerts in batches
- Use connection pooling
- Implement alert deduplication
- Add rate limiting for notifications

## Security Considerations

1. **User Authentication**: Implement proper user authentication
2. **Rate Limiting**: Limit alert creation per user
3. **Input Validation**: Validate all alert conditions
4. **Database Security**: Use MongoDB authentication
5. **Redis Security**: Configure Redis authentication

## Monitoring

### **Key Metrics**
- Alert creation rate
- Alert trigger rate
- Worker performance
- Database connection health
- Redis performance

### **Alerts Dashboard**
- Active alerts count
- Triggered alerts history
- User alert statistics
- System health status