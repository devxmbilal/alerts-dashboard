# Utils Directory

Utility functions and services for the Crypto Alerts Dashboard.

## Files

### `chartScreenshot.js` 
**Chart Screenshot Service** - Captures TradingView chart screenshots using Puppeteer.

#### Features:
- Capture real-time TradingView charts
- Multiple timeframe support (1m, 5m, 15m, 1h, 4h, 1d)
- Optimized for server environments
- Concurrent screenshot processing
- Automatic cleanup and memory management
- Health monitoring

#### Usage:
```javascript
import ChartScreenshotService from './utils/chartScreenshot.js';

// Initialize browser
await ChartScreenshotService.initialize();

// Capture chart
const screenshot = await ChartScreenshotService.captureChart('BTCUSDT', '5m');

// Save to file
await ChartScreenshotService.saveScreenshot(screenshot, 'chart.jpg');

// Cleanup
await ChartScreenshotService.shutdown();
```

#### Methods:
- `initialize()` - Initialize Puppeteer browser
- `captureChart(symbol, timeframe)` - Capture single chart
- `captureMultipleCharts(requests)` - Capture multiple charts concurrently
- `constructTradingViewUrl(symbol, timeframe)` - Build TradingView URL
- `saveScreenshot(buffer, filename)` - Save screenshot to tmp folder
- `cleanupOldScreenshots(maxAgeMs)` - Remove old screenshots
- `healthCheck()` - Verify browser health
- `shutdown()` - Close browser and cleanup

### `alertLock.js`
**Alert Lock Management** - Handles alert throttling and cooldown periods.

### `auth.js`
**Authentication Utilities** - JWT token verification and authentication helpers.

### `init-redis.js`
**Redis Initialization** - Initialize Redis connection for the application.

### `mongodb.js`
**MongoDB Connection** - Database connection management and utilities.

### `redis.js`
**Redis Cache Services** - Cache management for alerts, favorites, and market data.

## Dependencies

### Chart Screenshot Service Dependencies:
- `puppeteer` - Headless browser for screenshot capture
- Built-in Node.js modules: `fs`, `path`, `url`

### Installation:
```bash
npm install puppeteer
```

### Server Requirements (Linux):
Puppeteer requires certain system libraries:
```bash
sudo apt-get install -y chromium-browser libgbm1 libasound2 libatk-bridge2.0-0
```

## Environment Variables

Chart Screenshot Service uses:
- No specific env vars required (uses TradingView public charts)

## Performance

- **Screenshot Capture**: 2-4 seconds per chart
- **Concurrent Limit**: Up to 50 charts simultaneously
- **Memory Usage**: ~150-200MB per browser instance
- **Image Size**: 50-150KB per screenshot

## Error Handling

All utilities include comprehensive error handling:
- Detailed error logging
- Graceful fallbacks
- Automatic retry logic (where applicable)
- Resource cleanup on errors

## Testing

Test the chart screenshot utility:
```bash
npm run test-chart-screenshot
```

## Notes

- Chart screenshots are stored temporarily in `tmp/` folder
- Old screenshots are automatically cleaned up
- Browser instance is reused for efficiency
- Health checks ensure browser stability
