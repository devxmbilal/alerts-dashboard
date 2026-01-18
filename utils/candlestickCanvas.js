/**
 * Canvas-based Candlestick Chart Generator
 * Pure Node.js - No browser required!
 * Generates TradingView-style candlestick charts
 */

import { createCanvas, registerFont } from "canvas";
import path from "path";
import fs from "fs";

// 🔥 FIX: Register fonts for server environments where Arial might not be available
// Try to register common fonts that exist on Linux servers
const fontPaths = [
    // DejaVu Sans (common on Linux)
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    // Liberation Sans (common on CentOS/RHEL)
    "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    // Ubuntu font
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
];

let fontRegistered = false;
for (const fontPath of fontPaths) {
    try {
        if (fs.existsSync(fontPath)) {
            registerFont(fontPath, { family: "ChartFont" });
            fontRegistered = true;
            console.log(`✅ Registered chart font: ${fontPath}`);
            break;
        }
    } catch (e) {
        // Continue to next font
    }
}

if (!fontRegistered) {
    console.log("⚠️ No custom fonts found, using system default");
}

// Font to use throughout the chart - fallback to sans-serif if custom font not available
const CHART_FONT = fontRegistered ? "ChartFont" : "sans-serif";

class CandlestickChartGenerator {
    constructor(options = {}) {
        this.width = options.width || 1200;
        this.height = options.height || 600;
        this.padding = {
            top: 60,
            right: 80,
            bottom: 50,
            left: 20
        };

        // Colors (TradingView style)
        this.colors = {
            background: "#1e222d",
            gridLine: "rgba(255, 255, 255, 0.06)",
            text: "#d1d4dc",
            bullish: "#26a69a", // Green candle
            bearish: "#ef5350", // Red candle
            volume: {
                bullish: "rgba(38, 166, 154, 0.4)",
                bearish: "rgba(239, 83, 80, 0.4)"
            },
            priceLabel: "#2962ff"
        };
    }

    /**
     * Generate candlestick chart from OHLCV data
     * @param {string} symbol - Trading pair symbol
     * @param {Array} candles - Array of {open, high, low, close, volume, timestamp}
     * @param {string} timeframe - Chart timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w)
     * @param {object} alertData - Optional alert context {triggerPrice, baselinePrice, changePercent}
     * @returns {Buffer} - PNG image buffer
     */
    generate(symbol, candles, timeframe = "5m", alertData = null) {
        if (!candles || candles.length === 0) {
            throw new Error("No candle data provided");
        }

        const canvas = createCanvas(this.width, this.height);
        const ctx = canvas.getContext("2d");

        // Draw background
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.width, this.height);

        // Calculate chart dimensions
        const chartWidth = this.width - this.padding.left - this.padding.right;
        const chartHeight = this.height - this.padding.top - this.padding.bottom;
        const volumeHeight = chartHeight * 0.2; // 20% for volume
        const priceHeight = chartHeight * 0.8; // 80% for price

        // Calculate price range
        const prices = candles.flatMap(c => [c.high, c.low]);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice;
        const pricePadding = priceRange * 0.05;

        // Calculate volume range
        const maxVolume = Math.max(...candles.map(c => c.volume));

        // Candle width - use 75% of chart for candles, leave 25% empty on right
        const candleAreaWidth = chartWidth * 0.75; // 3/4 of chart width for candles
        const candleWidth = (candleAreaWidth / candles.length) * 0.7;
        const candleSpacing = candleAreaWidth / candles.length;

        // Draw grid lines
        this.drawGrid(ctx, chartWidth, chartHeight, minPrice - pricePadding, maxPrice + pricePadding);

        // Draw candles
        candles.forEach((candle, i) => {
            const x = this.padding.left + (i * candleSpacing) + (candleSpacing / 2);

            // Draw candle
            this.drawCandle(
                ctx,
                x,
                candle,
                candleWidth,
                minPrice - pricePadding,
                maxPrice + pricePadding,
                priceHeight
            );

            // Draw volume bar
            this.drawVolumeBar(
                ctx,
                x,
                candle,
                candleWidth,
                maxVolume,
                volumeHeight,
                priceHeight
            );
        });

        // Draw price labels on Y-axis
        this.drawPriceLabels(ctx, minPrice - pricePadding, maxPrice + pricePadding, priceHeight);

        // Draw time labels on X-axis (optional)
        this.drawTimeLabels(ctx, candles, candleSpacing, chartHeight);

        // Draw title with timeframe and alert data if provided
        this.drawTitle(ctx, symbol, candles, timeframe, alertData);

        // 🔥 REMOVED: Client doesn't want price indicator lines
        // - drawCurrentPrice (blue)
        // - drawBaselineLine (green)
        // - drawTriggerLine (orange)
        // - drawAlertInfoBox

        return canvas.toBuffer("image/png");
    }

    // 🔥 NEW: Draw baseline price line (green dashed)
    drawBaselineLine(ctx, baselinePrice, minPrice, maxPrice, height) {
        const priceRange = maxPrice - minPrice;
        const y = this.padding.top + ((maxPrice - baselinePrice) / priceRange) * height;

        // Draw green dashed line
        ctx.strokeStyle = "#26a69a"; // Green
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(this.padding.left, y);
        ctx.lineTo(this.width - this.padding.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw label box on left
        const labelText = `BASELINE ${this.formatPrice(baselinePrice)}`;
        ctx.fillStyle = "#26a69a";
        ctx.fillRect(this.padding.left, y - 10, 130, 20);

        ctx.fillStyle = "#000000";
        ctx.font = `bold 10px ${CHART_FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(labelText, this.padding.left + 5, y + 4);
    }

    // 🔥 NEW: Draw trigger price line (orange solid)
    drawTriggerLine(ctx, triggerPrice, minPrice, maxPrice, height) {
        const priceRange = maxPrice - minPrice;
        const y = this.padding.top + ((maxPrice - triggerPrice) / priceRange) * height;

        // Draw orange SOLID line
        ctx.strokeStyle = "#ffa500"; // Orange
        ctx.lineWidth = 2;
        ctx.setLineDash([]); // Solid line
        ctx.beginPath();
        ctx.moveTo(this.padding.left, y);
        ctx.lineTo(this.width - this.padding.right, y);
        ctx.stroke();

        // Draw label box on left
        const labelText = `ALERT @ ${this.formatPrice(triggerPrice)}`;
        ctx.fillStyle = "#ffa500";
        ctx.fillRect(this.padding.left, y - 10, 130, 20);

        ctx.fillStyle = "#000000";
        ctx.font = `bold 10px ${CHART_FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(labelText, this.padding.left + 5, y + 4);
    }

    // 🔥 NEW: Draw arrow pointing to trigger candle
    drawTriggerArrow(ctx, candles, candleSpacing, triggerPrice, minPrice, maxPrice, height) {
        // Find the candle closest to trigger price (second-last candle usually)
        const triggerCandleIndex = candles.length - 2; // Second-last candle
        if (triggerCandleIndex < 0) return;

        const x = this.padding.left + (triggerCandleIndex * candleSpacing) + (candleSpacing / 2);
        const priceRange = maxPrice - minPrice;
        const y = this.padding.top + ((maxPrice - triggerPrice) / priceRange) * height;

        // Draw arrow pointing down to the candle
        const arrowY = y - 30;

        // Arrow line
        ctx.strokeStyle = "#ffa500";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, arrowY);
        ctx.lineTo(x, y - 5);
        ctx.stroke();

        // Arrow head
        ctx.fillStyle = "#ffa500";
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 10);
        ctx.lineTo(x + 8, y - 10);
        ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();

        // Circle around trigger point
        ctx.strokeStyle = "#ffa500";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // 🔥 NEW: Draw info box with alert summary
    drawAlertInfoBox(ctx, alertData, chartWidth, chartHeight) {
        const boxWidth = 180;
        const boxHeight = 70;
        const boxX = this.width - this.padding.right - boxWidth - 10;
        const boxY = this.height - this.padding.bottom - boxHeight - 30;

        // Semi-transparent background
        ctx.fillStyle = "rgba(30, 34, 45, 0.9)";
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Border
        ctx.strokeStyle = "#ffa500";
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        // Title
        ctx.fillStyle = "#ffa500";
        ctx.font = `bold 11px ${CHART_FONT}`;
        ctx.textAlign = "left";
        ctx.fillText("📊 Alert Summary", boxX + 10, boxY + 15);

        // Content
        ctx.fillStyle = "#d1d4dc";
        ctx.font = `10px ${CHART_FONT}`;

        const baseline = alertData.baselinePrice ? this.formatPrice(alertData.baselinePrice) : "N/A";
        const trigger = this.formatPrice(alertData.triggerPrice);
        const change = alertData.changePercent ? `(${alertData.changePercent >= 0 ? '+' : ''}${alertData.changePercent.toFixed(2)}%)` : "";

        ctx.fillText(`Baseline: ${baseline}`, boxX + 10, boxY + 32);
        ctx.fillText(`Trigger: ${trigger} ${change}`, boxX + 10, boxY + 47);
        ctx.fillText(`Time: ${new Date().toLocaleTimeString()}`, boxX + 10, boxY + 62);
    }

    drawGrid(ctx, width, height, minPrice, maxPrice) {
        const numLines = 5;
        const priceStep = (maxPrice - minPrice) / numLines;

        ctx.strokeStyle = this.colors.gridLine;
        ctx.lineWidth = 1;

        for (let i = 0; i <= numLines; i++) {
            const y = this.padding.top + (height * 0.8 * i / numLines);
            ctx.beginPath();
            ctx.moveTo(this.padding.left, y);
            ctx.lineTo(this.width - this.padding.right, y);
            ctx.stroke();
        }
    }

    drawCandle(ctx, x, candle, width, minPrice, maxPrice, height) {
        const priceRange = maxPrice - minPrice;
        const scaleY = (price) => this.padding.top + ((maxPrice - price) / priceRange) * height;

        const open = scaleY(candle.open);
        const close = scaleY(candle.close);
        const high = scaleY(candle.high);
        const low = scaleY(candle.low);

        const isBullish = candle.close >= candle.open;
        const color = isBullish ? this.colors.bullish : this.colors.bearish;

        // Draw wick (high-low line)
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, high);
        ctx.lineTo(x, low);
        ctx.stroke();

        // Draw body
        const bodyTop = Math.min(open, close);
        const bodyHeight = Math.abs(close - open) || 1;

        ctx.fillStyle = color;
        ctx.fillRect(x - width / 2, bodyTop, width, bodyHeight);

        // Draw border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - width / 2, bodyTop, width, bodyHeight);
    }

    drawVolumeBar(ctx, x, candle, width, maxVolume, volumeHeight, priceHeight) {
        const volumeY = this.padding.top + priceHeight;
        const barHeight = (candle.volume / maxVolume) * volumeHeight * 0.8;

        const isBullish = candle.close >= candle.open;
        ctx.fillStyle = isBullish ? this.colors.volume.bullish : this.colors.volume.bearish;

        ctx.fillRect(
            x - width / 2,
            volumeY + volumeHeight - barHeight,
            width,
            barHeight
        );
    }

    drawPriceLabels(ctx, minPrice, maxPrice, height) {
        const numLabels = 5;
        const priceStep = (maxPrice - minPrice) / numLabels;

        ctx.fillStyle = this.colors.text;
        ctx.font = `12px ${CHART_FONT}`;
        ctx.textAlign = "left";

        for (let i = 0; i <= numLabels; i++) {
            const price = maxPrice - (priceStep * i);
            const y = this.padding.top + (height * i / numLabels);

            // 🔥 FIX: Dynamic decimal places for very small prices
            const formattedPrice = this.formatPrice(price);

            ctx.fillText(formattedPrice, this.width - this.padding.right + 5, y + 4);
        }
    }

    // 🔥 NEW: Smart price formatting for all price ranges
    formatPrice(price) {
        if (price === 0 || price === null || price === undefined || isNaN(price)) {
            return "$0.00";
        }

        const absPrice = Math.abs(price);

        if (absPrice >= 1000) {
            return `$${price.toFixed(2)}`;
        } else if (absPrice >= 1) {
            return `$${price.toFixed(4)}`;
        } else if (absPrice >= 0.001) {
            return `$${price.toFixed(6)}`;
        } else if (absPrice >= 0.0000001) {
            return `$${price.toFixed(8)}`;
        } else {
            // For extremely small prices, use scientific notation
            return `$${price.toExponential(4)}`;
        }
    }

    drawTimeLabels(ctx, candles, spacing, chartHeight) {
        ctx.fillStyle = this.colors.text;
        ctx.font = `10px ${CHART_FONT}`;
        ctx.textAlign = "center";

        const labelInterval = Math.ceil(candles.length / 6);

        candles.forEach((candle, i) => {
            if (i % labelInterval === 0 && candle.timestamp) {
                const x = this.padding.left + (i * spacing) + (spacing / 2);
                const y = this.padding.top + chartHeight + 15;

                const date = new Date(candle.timestamp);
                const timeStr = date.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                });

                ctx.fillText(timeStr, x, y);
            }
        });
    }

    drawTitle(ctx, symbol, candles, timeframe = "5m", alertData = null) {
        const firstPrice = candles[0].close;
        const lastPrice = candles[candles.length - 1].close;

        // 🔥 FIX: If alertData provided, show ALERT change, not chart range change
        let displayChange;
        let isPositive;

        if (alertData && alertData.changePercent !== undefined) {
            // Use alert's actual change percentage
            displayChange = alertData.changePercent;
            isPositive = displayChange >= 0;
        } else {
            // Default: calculate from chart data
            displayChange = ((lastPrice - firstPrice) / firstPrice) * 100;
            isPositive = displayChange >= 0;
        }

        // Symbol + Timeframe + Alert indicator
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 18px ${CHART_FONT}`;
        ctx.textAlign = "left";

        const titleText = alertData
            ? `⚠️ ${symbol} · ${timeframe.toUpperCase()} · ALERT`
            : `${symbol} · ${timeframe.toUpperCase()}`;
        ctx.fillText(titleText, this.padding.left, 30);

        // Price - Show trigger price if alertData, else current price
        const displayPrice = alertData?.triggerPrice || lastPrice;
        const priceStr = this.formatPrice(displayPrice);

        ctx.fillStyle = this.colors.text;
        ctx.font = `bold 16px ${CHART_FONT}`;
        ctx.fillText(priceStr, this.padding.left + (alertData ? 210 : 150), 30);

        // Change percentage
        const changeStr = `${isPositive ? "+" : ""}${displayChange.toFixed(2)}%`;
        ctx.fillStyle = isPositive ? this.colors.bullish : this.colors.bearish;
        ctx.font = `bold 14px ${CHART_FONT}`;
        ctx.fillText(changeStr, this.padding.left + (alertData ? 330 : 280), 30);
    }

    drawCurrentPrice(ctx, price, minPrice, maxPrice, height, width) {
        const priceRange = maxPrice - minPrice;
        const y = this.padding.top + ((maxPrice - price) / priceRange) * height;

        // Dashed line
        ctx.strokeStyle = this.colors.priceLabel;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(this.padding.left, y);
        ctx.lineTo(this.width - this.padding.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price label box
        const labelWidth = 70;
        const labelHeight = 20;
        ctx.fillStyle = this.colors.priceLabel;
        ctx.fillRect(this.width - this.padding.right, y - labelHeight / 2, labelWidth, labelHeight);

        // Price text - 🔥 FIX: Use smart formatting for small prices
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 11px ${CHART_FONT}`;
        ctx.textAlign = "left";
        const priceStr = this.formatPrice(price).replace('$', ''); // Remove $ as it's in a colored box
        ctx.fillText(priceStr, this.width - this.padding.right + 5, y + 4);
    }
}

// Export singleton
export default new CandlestickChartGenerator();
