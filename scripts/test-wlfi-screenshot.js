import ChartScreenshotService from "../utils/chartScreenshot.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🧪 Testing WLFIUSDT Screenshot Generation\n");
console.log("=".repeat(60));

const symbol = "WLFIUSDT";
const timeframe = "5m";

console.log(`\n📊 Fetching Binance candles for ${symbol}...`);
try {
  const start = Date.now();
  const candles = await ChartScreenshotService.getBinanceCandles(symbol, timeframe, 50);
  const time = Date.now() - start;
  
  console.log(`✅ Candles fetched: ${candles.length} candles`);
  console.log(`⏱️  Time taken: ${time}ms`);
  console.log(`📊 First candle: Open=${candles[0].open}, Close=${candles[0].close}`);
  console.log(`📊 Last candle: Open=${candles[candles.length-1].open}, Close=${candles[candles.length-1].close}`);
  
  console.log(`\n📸 Generating chart screenshot...`);
  const screenshotStart = Date.now();
  const screenshot = await ChartScreenshotService.captureCandlestickChart(symbol, candles);
  const screenshotTime = Date.now() - screenshotStart;
  
  console.log(`✅ Screenshot generated!`);
  console.log(`⏱️  Time taken: ${screenshotTime}ms`);
  console.log(`📸 Size: ${(screenshot.length / 1024).toFixed(2)}KB`);
  console.log(`📸 Is Buffer: ${Buffer.isBuffer(screenshot)}`);
  console.log(`📸 Is PNG: ${screenshot[0] === 0x89 && screenshot[1] === 0x50}`);
  
  console.log(`\n✅ SUCCESS! Chart screenshot working for ${symbol}`);
  console.log(`\n💡 Total time: ${time + screenshotTime}ms`);
  
} catch (error) {
  console.error(`\n❌ FAILED: ${error.message}`);
  console.error(`\n📝 Error details:`, error);
}

console.log("\n" + "=".repeat(60));
process.exit(0);
