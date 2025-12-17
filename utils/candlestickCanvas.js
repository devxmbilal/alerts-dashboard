/**
 * Canvas-based Candlestick Chart Generator
 * Pure Node.js - No browser required!
 * Generates TradingView-style candlestick charts
 */

import { createCanvas } from "canvas";

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
     * @returns {Buffer} - PNG image buffer
     */
    generate(symbol, candles) {
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

        // Candle width
        const candleWidth = (chartWidth / candles.length) * 0.7;
        const candleSpacing = chartWidth / candles.length;

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

        // Draw title
        this.drawTitle(ctx, symbol, candles);

        // Draw current price indicator
        this.drawCurrentPrice(ctx, candles[candles.length - 1].close, minPrice - pricePadding, maxPrice + pricePadding, priceHeight, chartWidth);

        return canvas.toBuffer("image/png");
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
        ctx.font = "12px Arial";
        ctx.textAlign = "left";

        for (let i = 0; i <= numLabels; i++) {
            const price = maxPrice - (priceStep * i);
            const y = this.padding.top + (height * i / numLabels);

            // Format price
            const formattedPrice = price >= 1
                ? `$${price.toFixed(2)}`
                : `$${price.toFixed(6)}`;

            ctx.fillText(formattedPrice, this.width - this.padding.right + 5, y + 4);
        }
    }

    drawTimeLabels(ctx, candles, spacing, chartHeight) {
        ctx.fillStyle = this.colors.text;
        ctx.font = "10px Arial";
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

    drawTitle(ctx, symbol, candles) {
        const firstPrice = candles[0].close;
        const lastPrice = candles[candles.length - 1].close;
        const change = ((lastPrice - firstPrice) / firstPrice) * 100;
        const isPositive = change >= 0;

        // Symbol
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 18px Arial";
        ctx.textAlign = "left";
        ctx.fillText(symbol, this.padding.left, 30);

        // Price
        const priceStr = lastPrice >= 1
            ? `$${lastPrice.toFixed(2)}`
            : `$${lastPrice.toFixed(6)}`;

        ctx.fillStyle = this.colors.text;
        ctx.font = "bold 16px Arial";
        ctx.fillText(priceStr, this.padding.left + 150, 30);

        // Change percentage
        const changeStr = `${isPositive ? "+" : ""}${change.toFixed(2)}%`;
        ctx.fillStyle = isPositive ? this.colors.bullish : this.colors.bearish;
        ctx.font = "bold 14px Arial";
        ctx.fillText(changeStr, this.padding.left + 280, 30);
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

        // Price text
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "left";
        const priceStr = price >= 1 ? price.toFixed(2) : price.toFixed(6);
        ctx.fillText(priceStr, this.width - this.padding.right + 5, y + 4);
    }
}

// Export singleton
export default new CandlestickChartGenerator();
