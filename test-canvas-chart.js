/**
 * Test script for Canvas-based Candlestick Chart
 * Run: node test-canvas-chart.js
 */

import candlestickCanvas from "./utils/candlestickCanvas.js";
import fs from "fs";
import path from "path";

// Mock candle data for testing
function generateMockCandles() {
    const candles = [];
    let basePrice = 0.0397;
    const now = Date.now();

    for (let i = 0; i < 50; i++) {
        const change = (Math.random() - 0.45) * 0.001; // Slight upward bias
        const open = basePrice;
        const close = basePrice + change;
        const high = Math.max(open, close) + Math.random() * 0.0003;
        const low = Math.min(open, close) - Math.random() * 0.0003;
        const volume = 100000 + Math.random() * 500000;

        candles.push({
            timestamp: now - (50 - i) * 5 * 60 * 1000, // 5 min intervals
            open: open,
            high: high,
            low: low,
            close: close,
            volume: volume,
        });

        basePrice = close;
    }

    return candles;
}

async function testCanvasChart() {
    console.log("🧪 Testing Canvas-based Candlestick Chart...\n");

    const testSymbol = "AUDIOUSDT";

    try {
        // Generate mock candles
        console.log(`📊 Generating mock candles for ${testSymbol}...`);
        const candles = generateMockCandles();
        console.log(`✅ Generated ${candles.length} candles`);

        // Generate canvas candlestick chart
        console.log(`\n🕯️ Generating candlestick chart...`);
        const startTime = Date.now();

        const chartBuffer = candlestickCanvas.generate(testSymbol, candles);

        const endTime = Date.now();

        console.log(`✅ Chart generated in ${endTime - startTime}ms`);
        console.log(`   Image size: ${(chartBuffer.length / 1024).toFixed(2)} KB`);

        // Save to file for visual inspection
        const outputPath = path.join(process.cwd(), "test-canvas-candlestick.png");
        fs.writeFileSync(outputPath, chartBuffer);
        console.log(`\n💾 Chart saved to: ${outputPath}`);

        // Validate image
        if (chartBuffer.length < 10 * 1024) {
            console.log(`\n⚠️ WARNING: Image size is too small (${(chartBuffer.length / 1024).toFixed(2)} KB)`);
        } else {
            console.log(`\n✅ Image size OK (>10KB) - Good for Telegram!`);
        }

        // Check if it's a valid PNG
        if (chartBuffer[0] === 0x89 && chartBuffer[1] === 0x50) {
            console.log(`✅ Valid PNG format detected`);
        } else {
            console.log(`⚠️ Invalid image format!`);
        }

        console.log(`\n🎉 Test completed successfully!`);
        console.log(`   Open test-canvas-candlestick.png to see the REAL candlestick chart`);

    } catch (error) {
        console.error(`\n❌ Test failed:`, error.message);
        console.error(error.stack);
    }

    process.exit(0);
}

testCanvasChart();
