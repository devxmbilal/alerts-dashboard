# Real-Time Crypto Dashboard Setup

This guide will help you set up real-time crypto market data using Binance WebSocket, Redis pub/sub, and Server-Sent Events.

## Prerequisites

1. **Node.js** (v18 or higher)
2. **Redis Server** (v6 or higher)
3. **Binance API Access** (using RapidAPI key provided)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Install Redis (if not already installed):
   - **Windows**: Download from https://github.com/microsoftarchive/redis/releases
   - **macOS**: `brew install redis`
   - **Linux**: `sudo apt-get install redis-server`

## Setup Steps

### 1. Start Redis Server

**Windows:**
```bash
# Navigate to Redis installation directory
cd C:\Program Files\Redis
redis-server.exe
```

**macOS/Linux:**
```bash
redis-server
```

### 2. Start the Backend Worker

In a new terminal:
```bash
npm run worker
```

This will:
- Connect to Binance WebSocket
- Fetch initial market data
- Publish real-time updates to Redis
- Cache data for performance

### 3. Start the Next.js Application

In another terminal:
```bash
npm run dev
```

Or run both simultaneously:
```bash
npm run dev:all
```

## Architecture Overview

```
Binance WebSocket → Backend Worker → Redis Pub/Sub → Next.js API → SSE → Frontend
```

### Components:

1. **Backend Worker** (`workers/binance-worker.js`)
   - Connects to Binance WebSocket
   - Processes ticker data
   - Publishes to Redis channels
   - Handles reconnection logic

2. **Next.js API Route** (`app/api/market/stream/route.js`)
   - Subscribes to Redis channels
   - Provides Server-Sent Events endpoint
   - Handles client connections

3. **Socket Context** (`contexts/SocketContext.js`)
   - Manages real-time data state
   - Provides hooks for components
   - Handles connection management

4. **Updated Components**
   - `MarketPanel`: Shows real-time market data
   - `LineChart`: Displays live price charts
   - `Dashboard`: Wrapped with SocketProvider

## Data Flow

1. **Initial Data**: Worker fetches 24hr ticker data from Binance REST API
2. **Real-time Updates**: WebSocket receives live ticker updates
3. **Redis Caching**: Data is cached with 5-minute expiration
4. **Pub/Sub Distribution**: Updates are published to Redis channels
5. **SSE Streaming**: Next.js API streams data to clients
6. **UI Updates**: Components automatically update with new data

## Supported Trading Pairs

The system tracks 30+ popular trading pairs:
- BTCUSDT, ETHUSDT, ADAUSDT, SOLUSDT, DOTUSDT
- LINKUSDT, UNIUSDT, AVAXUSDT, MATICUSDT, ATOMUSDT
- NEARUSDT, FTMUSDT, ALGOUSDT, VETUSDT, ICPUSDT
- CYBERUSDT, MIRAUSDT, SUIUSDT, APTUSDT, ARBUSDT
- OPUSDT, LDOUSDT, INJUSDT, TIAUSDT, SEIUSDT
- WLDUSDT, JUPUSDT, PENDLEUSDT, WUSDT

## Performance Optimizations

1. **Redis Caching**: 5-minute cache for market data
2. **Data Limiting**: Chart keeps only last 100 data points
3. **Selective Updates**: Only subscribed symbols are processed
4. **Connection Pooling**: Efficient Redis connections
5. **Heartbeat System**: Keeps connections alive

## Troubleshooting

### Redis Connection Issues
```bash
# Check if Redis is running
redis-cli ping
# Should return "PONG"
```

### Worker Connection Issues
- Check Binance WebSocket connectivity
- Verify Redis server is running
- Check console logs for error messages

### Frontend Not Updating
- Check browser console for SSE errors
- Verify API route is accessible
- Check network tab for connection status

## API Endpoints

- `GET /api/market/stream` - Server-Sent Events endpoint
- Query params: `?symbols=BTCUSDT,ETHUSDT` (optional)

## Redis Channels

- `market:updates` - All market updates
- `market:heartbeat` - Connection heartbeat
- `market:{SYMBOL}` - Specific symbol updates

## Monitoring

The worker logs provide real-time status:
- ✅ Connection status
- 📊 Data processing
- 🔄 Reconnection attempts
- ❌ Error handling

## Production Considerations

1. **Redis Persistence**: Enable AOF/RDB for data durability
2. **Load Balancing**: Use Redis Cluster for scaling
3. **Error Handling**: Implement circuit breakers
4. **Monitoring**: Add metrics and alerting
5. **Security**: Implement rate limiting and authentication

## Development Commands

```bash
# Start only Next.js
npm run dev

# Start only worker
npm run worker

# Start both (recommended)
npm run dev:all

# Build for production
npm run build

# Start production server
npm start
```

## Data Structure

Each market data object contains:
```javascript
{
  symbol: "BTCUSDT",
  price: 45000.00,
  change: 2.5,
  changeAmount: 1125.00,
  volume: 1234567890,
  high24h: 46000.00,
  low24h: 44000.00,
  openPrice: 43875.00,
  closePrice: 45000.00,
  timestamp: 1703123456789,
  isFavorite: false
}
```

This setup provides a robust, scalable real-time crypto dashboard with live market data updates!
