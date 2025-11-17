import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ChartScreenshotService {
  constructor() {
    this.browser = null;
    this.isInitialized = false;
    this.screenshotQueue = [];
    this.isProcessing = false;
    // Browser state management
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 5; // Disable after 5 consecutive failures
    this.isDisabled = false;
    this.lastFailureTime = 0;
    this.cooldownPeriod = 60000; // 1 minute cooldown after failures
    this.initializationInProgress = false;
    this.lastHealthCheck = 0;
    this.healthCheckInterval = 30000; // Check health every 30 seconds
    // QuickChart API (PRIMARY METHOD - FAST)
    this.quickChartBaseUrl = "https://quickchart.io/chart";
    this.useQuickChart = true; // Use QuickChart by default (fast)
    this.quickChartTimeout = 15000; // 15 seconds timeout for QuickChart
  }

  /**
   * Check if browser is healthy and responsive
   */
  async isBrowserHealthy() {
    if (!this.browser || !this.isInitialized) {
      return false;
    }

    try {
      // Quick health check - just verify connection
      const pages = await Promise.race([
        this.browser.pages(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 2000)
        ),
      ]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize Puppeteer browser with optimized settings
   */
  async initialize() {
    // Prevent concurrent initialization
    if (this.initializationInProgress) {
      console.log("⏳ Browser initialization already in progress, waiting...");
      // Wait for ongoing initialization
      let waitCount = 0;
      while (this.initializationInProgress && waitCount < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        waitCount++;
      }
      if (this.isInitialized && (await this.isBrowserHealthy())) {
        return; // Initialization completed by another call
      }
    }

    // Check cooldown period
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (
      timeSinceLastFailure < this.cooldownPeriod &&
      this.consecutiveFailures > 0
    ) {
      const remainingCooldown = Math.ceil(
        (this.cooldownPeriod - timeSinceLastFailure) / 1000
      );
      console.log(
        `⏸️ Browser in cooldown period (${remainingCooldown}s remaining). Skipping initialization.`
      );
      throw new Error(
        `Browser initialization in cooldown period (${remainingCooldown}s remaining)`
      );
    }

    // Check if disabled due to too many failures
    if (this.isDisabled) {
      console.warn(
        "⚠️ Browser initialization is disabled due to consecutive failures. Reset required."
      );
      throw new Error(
        "Browser initialization disabled due to consecutive failures"
      );
    }

    this.initializationInProgress = true;

    try {
      // Check if browser is already healthy
      if (
        this.isInitialized &&
        this.browser &&
        (await this.isBrowserHealthy())
      ) {
        this.initializationInProgress = false;
        return; // Browser is already healthy
      }

      // Force cleanup if browser exists but not properly initialized
      if (this.browser) {
        try {
          const pages = await Promise.race([
            this.browser.pages(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Cleanup timeout")), 3000)
            ),
          ]);
          for (const page of pages) {
            try {
              await page.close();
            } catch (e) {
              // Ignore
            }
          }
          await Promise.race([
            this.browser.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Close timeout")), 3000)
            ),
          ]);
        } catch (e) {
          // Ignore close errors - browser might already be dead
        }
        this.browser = null;
        this.isInitialized = false;
      }

      console.log("🚀 Initializing Puppeteer browser for chart screenshots...");

      // Retry logic for browser initialization
      let lastError = null;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.browser = await puppeteer.launch({
            headless: "new", // Use new headless mode
            pipe: true, // Use pipe instead of WebSocket for better compatibility
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-blink-features=AutomationControlled",
              "--no-first-run",
              "--disable-gpu",
              "--disable-software-rasterizer",
              "--disable-extensions",
              "--window-size=800,400",
              "--disable-web-security",
              "--disable-features=IsolateOrigins,site-per-process",
              "--disable-background-networking",
              "--disable-background-timer-throttling",
              "--disable-renderer-backgrounding",
              "--disable-backgrounding-occluded-windows",
              "--disable-ipc-flooding-protection",
              "--single-process", // Use single process mode for stability
            ],
            defaultViewport: {
              width: 800,
              height: 400,
            },
            ignoreHTTPSErrors: true,
            timeout: 60000,
          });

          // Verify browser is actually working with a test
          const testPage = await this.browser.newPage();
          await testPage.goto("about:blank", {
            waitUntil: "domcontentloaded",
            timeout: 5000,
          });
          await testPage.close();

          this.isInitialized = true;
          this.consecutiveFailures = 0; // Reset failure count on success
          this.lastFailureTime = 0;
          console.log("✅ Puppeteer browser initialized successfully");
          this.initializationInProgress = false;
          return; // Success!
        } catch (error) {
          lastError = error;

          // Only log detailed error on last attempt
          if (attempt === maxRetries) {
            console.error(
              `❌ Browser initialization attempt ${attempt}/${maxRetries} failed:`,
              error.message
            );
          } else {
            console.warn(
              `⚠️ Browser initialization attempt ${attempt}/${maxRetries} failed, retrying...`
            );
          }

          // Cleanup failed browser instance
          if (this.browser) {
            try {
              await Promise.race([
                this.browser.close(),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Close timeout")), 2000)
                ),
              ]);
            } catch (e) {
              // Ignore
            }
            this.browser = null;
          }

          // Wait before retry (exponential backoff)
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000; // 2s, 4s
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      }

      // All retries failed - track failures
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();

      // Disable after too many consecutive failures
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.isDisabled = true;
        console.error(
          `❌ Browser initialization disabled after ${this.consecutiveFailures} consecutive failures. ` +
            `Screenshots will be disabled until service restart.`
        );
      }

      this.initializationInProgress = false;
      throw new Error(
        `Failed to initialize browser after ${maxRetries} attempts: ${
          lastError?.message || "Unknown error"
        }`
      );
    } catch (error) {
      this.initializationInProgress = false;
      if (
        error.message.includes("cooldown") ||
        error.message.includes("disabled")
      ) {
        throw error; // Re-throw cooldown/disabled errors
      }
      console.error("❌ Error initializing Puppeteer browser:", error.message);
      this.browser = null;
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Fetch Binance Kline data (FREE)
   * @param {string} symbol - Trading pair symbol
   * @param {string} interval - Timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w)
   * @param {number} limit - Number of candles (default: 50)
   * @returns {Promise<Array>} - Array of candle objects
   */
  async getBinanceCandles(symbol, interval = "5m", limit = 50) {
    try {
      // Map timeframe to Binance interval
      const intervalMap = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "1h": "1h",
        "4h": "4h",
        "1d": "1d",
        "1w": "1w",
      };
      const binanceInterval = intervalMap[interval.toLowerCase()] || "5m";

      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
      const res = await axios.get(url, { timeout: 10000 });

      return res.data.map((c) => ({
        openTime: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));
    } catch (error) {
      console.error(
        `❌ Error fetching Binance candles for ${symbol}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Generate Candlestick chart using QuickChart (FAST - PRIMARY METHOD)
   * @param {string} symbol - Trading pair symbol
   * @param {Array} candles - Array of candle objects
   * @returns {Promise<Buffer>} - Chart image buffer
   */
  async captureCandlestickChart(symbol, candles = []) {
    if (!candles || candles.length === 0) {
      throw new Error("No candle data provided");
    }

    try {
      // Calculate price change for color
      const firstPrice = candles[0].close;
      const lastPrice = candles[candles.length - 1].close;
      const isPositive = lastPrice >= firstPrice;

      // Extract prices and volumes for line chart (QuickChart doesn't support candlestick)
      const closePrices = candles.map((c) => c.close);
      const highPrices = candles.map((c) => c.high);
      const lowPrices = candles.map((c) => c.low);
      const volumes = candles.map((c) => c.volume);

      // Calculate price change percentage
      const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;

      // Color scheme based on price direction
      const lineColor = isPositive ? "rgb(0, 255, 127)" : "rgb(255, 71, 87)"; // Green or Red
      const fillColor = isPositive
        ? "rgba(0, 255, 127, 0.1)"
        : "rgba(255, 71, 87, 0.1)";
      const volumeColor = isPositive
        ? "rgba(0, 200, 0, 0.4)"
        : "rgba(200, 0, 0, 0.4)";

      // Create labels (empty for cleaner look)
      const labels = candles.map(() => "");

      const chartConfig = {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            {
              label: `${symbol} Price`,
              data: closePrices,
              borderColor: lineColor,
              backgroundColor: fillColor,
              borderWidth: 2,
              tension: 0.4,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 4,
              yAxisID: "y",
            },
            {
              label: "High",
              data: highPrices,
              borderColor: "rgba(0, 255, 0, 0.3)",
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false,
              yAxisID: "y",
            },
            {
              label: "Low",
              data: lowPrices,
              borderColor: "rgba(255, 0, 0, 0.3)",
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false,
              yAxisID: "y",
            },
            {
              type: "bar",
              label: "Volume",
              data: volumes,
              backgroundColor: volumeColor,
              yAxisID: "volume-axis",
              order: 2, // Show behind line chart
            },
          ],
        },
        options: {
          responsive: false,
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: {
                color: "white",
                font: { size: 12, weight: "bold" },
                usePointStyle: true,
              },
            },
            title: {
              display: true,
              text: `${symbol} Price Chart (${
                priceChange >= 0 ? "+" : ""
              }${priceChange.toFixed(2)}%)`,
              color: "white",
              font: { size: 16, weight: "bold" },
            },
            tooltip: {
              enabled: true,
              mode: "index",
              intersect: false,
            },
          },
          scales: {
            x: {
              ticks: {
                color: "white",
                maxTicksLimit: 10,
                display: false, // Hide x-axis labels for cleaner look
              },
              grid: {
                color: "rgba(255,255,255,0.1)",
                display: true,
              },
            },
            y: {
              position: "left",
              ticks: {
                color: "white",
                font: { size: 11 },
              },
              grid: {
                color: "rgba(255,255,255,0.1)",
              },
            },
            "volume-axis": {
              type: "linear",
              position: "right",
              ticks: {
                color: "rgba(255,255,255,0.6)",
                font: { size: 10 },
              },
              grid: {
                display: false,
              },
            },
          },
        },
      };

      const url = `${
        this.quickChartBaseUrl
      }?width=800&height=500&format=png&backgroundColor=rgb(20,20,20)&c=${encodeURIComponent(
        JSON.stringify(chartConfig)
      )}`;

      console.log(`📊 Generating QuickChart for ${symbol}...`);

      // Try GET first, but if URL is too long, use POST
      let res;
      try {
        res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: this.quickChartTimeout,
          validateStatus: (status) => {
            // Accept 200-299 and also check if response is valid PNG
            return status >= 200 && status < 300;
          },
        });
      } catch (getError) {
        // If GET fails, try POST method (for large configs)
        if (getError.response && getError.response.data) {
          const responseData = Buffer.from(getError.response.data);
          // Check if response is actually a valid PNG image
          if (
            responseData.length > 0 &&
            responseData[0] === 0x89 &&
            responseData[1] === 0x50
          ) {
            // Valid PNG signature (89 50 4E 47)
            console.log(`✅ QuickChart returned PNG despite status code`);
            return responseData;
          }
        }

        // Try POST method for large configs
        try {
          console.log(`📊 Trying POST method for QuickChart (large config)...`);
          const postUrl = `${this.quickChartBaseUrl}?width=800&height=500&format=png&backgroundColor=rgb(20,20,20)`;
          res = await axios.post(
            postUrl,
            { config: chartConfig },
            {
              responseType: "arraybuffer",
              timeout: this.quickChartTimeout,
              headers: {
                "Content-Type": "application/json",
              },
            }
          );
        } catch (postError) {
          // If POST also fails, check if response data is valid PNG
          if (postError.response && postError.response.data) {
            const responseData = Buffer.from(postError.response.data);
            if (
              responseData.length > 0 &&
              responseData[0] === 0x89 &&
              responseData[1] === 0x50
            ) {
              console.log(`✅ QuickChart returned PNG despite error status`);
              return responseData;
            }
          }
          throw getError; // Throw original error
        }
      }

      // Validate response is PNG
      const imageBuffer = Buffer.from(res.data);
      if (imageBuffer.length === 0) {
        throw new Error("Empty response from QuickChart");
      }

      // Check PNG signature (89 50 4E 47)
      if (imageBuffer[0] !== 0x89 || imageBuffer[1] !== 0x50) {
        throw new Error("Invalid PNG response from QuickChart");
      }

      console.log(
        `✅ QuickChart generated for ${symbol} (${imageBuffer.length} bytes)`
      );
      return imageBuffer;
    } catch (error) {
      console.error(
        `❌ QuickChart generation failed for ${symbol}:`,
        error.message
      );
      if (error.response) {
        // Check if response is actually a valid image despite error status
        if (error.response.data) {
          const responseData = Buffer.from(error.response.data);
          if (
            responseData.length > 0 &&
            responseData[0] === 0x89 &&
            responseData[1] === 0x50
          ) {
            // Valid PNG - use it even if status is error
            console.log(
              `✅ QuickChart returned valid PNG despite error status, using it`
            );
            return responseData;
          }
        }
        console.error(
          `❌ QuickChart API error: ${error.response.status} - ${error.response.statusText}`
        );
      }
      throw error;
    }
  }

  /**
   * Capture TradingView chart screenshot (FALLBACK METHOD - Puppeteer)
   * @param {string} symbol - Trading pair symbol (e.g., VANAUSDT, BTCUSDT)
   * @param {string} timeframe - Chart timeframe (1m, 5m, 15m, 1h, 4h, 1d)
   * @returns {Promise<Buffer>} - Screenshot buffer
   */
  async captureChartPuppeteer(symbol, timeframe = "5m") {
    let page = null;

    try {
      // Check if disabled
      if (this.isDisabled) {
        throw new Error(
          "Browser initialization is disabled due to consecutive failures"
        );
      }

      // Periodic health check (not on every request)
      const now = Date.now();
      const needsHealthCheck =
        now - this.lastHealthCheck > this.healthCheckInterval;

      if (needsHealthCheck) {
        this.lastHealthCheck = now;
        if (
          !this.isInitialized ||
          !this.browser ||
          !(await this.isBrowserHealthy())
        ) {
          this.isInitialized = false;
          await this.initialize();
        }
      } else {
        // Quick check - only initialize if not initialized
        if (!this.isInitialized || !this.browser) {
          await this.initialize();
        } else {
          // Quick health verification without full check
          try {
            await Promise.race([
              this.browser.pages(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Quick check timeout")), 1000)
              ),
            ]);
          } catch (e) {
            // Browser is dead, reinitialize
            console.warn(
              `[${symbol}] Browser connection lost, reinitializing...`
            );
            this.isInitialized = false;
            await this.initialize();
          }
        }
      }

      console.log(`[${symbol}] Starting chart screenshot capture...`);

      // Create a new page with timeout
      page = await Promise.race([
        this.browser.newPage(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Page creation timeout")), 10000)
        ),
      ]);

      // Set viewport for optimal chart display
      await page.setViewport({
        width: 800,
        height: 400,
        deviceScaleFactor: 2, // Higher resolution
      });

      // Set user agent to avoid being blocked
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Hide webdriver property to avoid bot detection
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
        // Add Chrome object
        window.chrome = {
          runtime: {},
        };
        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      });

      // Construct TradingView chart URL
      const tradingViewUrl = this.constructTradingViewUrl(symbol, timeframe);
      console.log(`[${symbol}] Loading TradingView chart: ${tradingViewUrl}`);

      // Navigate to TradingView chart with timeout
      try {
        await page.goto(tradingViewUrl, {
          waitUntil: "domcontentloaded", // More lenient than networkidle2
          timeout: 45000, // Increased for Windows
        });
      } catch (navError) {
        console.warn(
          `[${symbol}] Navigation with domcontentloaded failed, trying with load...`
        );
        // Fallback: try with 'load' event
        await page.goto(tradingViewUrl, {
          waitUntil: "load",
          timeout: 60000,
        });
      }

      // Wait for chart to load
      await page.waitForSelector("canvas", { timeout: 20000 });
      console.log(`[${symbol}] Chart canvas found, waiting for render...`);

      // Additional wait for chart rendering (increased for Windows)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Hide unnecessary elements (optional)
      await page.evaluate(() => {
        // Hide TradingView header/footer if needed
        const elements = document.querySelectorAll(
          ".tv-header, .tv-footer, .chart-controls-bar"
        );
        elements.forEach((el) => (el.style.display = "none"));
      });

      // Capture screenshot
      const screenshot = await page.screenshot({
        type: "jpeg",
        quality: 85,
        fullPage: false,
      });

      console.log(`[${symbol}] Screenshot captured successfully`);

      return screenshot;
    } catch (error) {
      console.error(`[${symbol}] Error capturing chart screenshot:`, error);
      throw error;
    } finally {
      // Always close the page to prevent memory leaks
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Main capture method - uses QuickChart (FAST), falls back to Puppeteer
   * @param {string} symbol - Trading pair symbol (e.g., VANAUSDT, BTCUSDT)
   * @param {string} timeframe - Chart timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w)
   * @param {object} options - Options { useQuickChart: true/false, forcePuppeteer: false }
   * @returns {Promise<Buffer>} - Screenshot buffer
   */
  async captureChart(symbol, timeframe = "5m", options = {}) {
    const useQuickChart = options.useQuickChart !== false && this.useQuickChart;
    const forcePuppeteer = options.forcePuppeteer === true;

    // Method 1: QuickChart (FAST - Generated charts, 1-2 seconds)
    if (useQuickChart && !forcePuppeteer) {
      try {
        // Fetch candle data from Binance
        const candles = await this.getBinanceCandles(symbol, timeframe, 50);

        if (candles.length === 0) {
          throw new Error("No candle data available from Binance");
        }

        // Generate chart using QuickChart
        return await this.captureCandlestickChart(symbol, candles);
      } catch (quickChartError) {
        console.warn(
          `⚠️ QuickChart failed for ${symbol}, falling back to Puppeteer:`,
          quickChartError.message
        );
        // Fall through to Puppeteer fallback
      }
    }

    // Method 2: Puppeteer (FALLBACK - TradingView screenshots, 5-10 seconds)
    return await this.captureChartPuppeteer(symbol, timeframe);
  }

  /**
   * Construct TradingView public chart URL
   * @param {string} symbol - Trading pair symbol
   * @param {string} timeframe - Chart timeframe
   * @returns {string} - TradingView chart URL
   */
  constructTradingViewUrl(symbol, timeframe) {
    // Map timeframe to TradingView format
    const timeframeMap = {
      "1m": "1",
      "5m": "5",
      "15m": "15",
      "1h": "60",
      "4h": "240",
      "1d": "D",
      "1w": "W",
    };

    const tvTimeframe = timeframeMap[timeframe.toLowerCase()] || "5";

    // Construct URL for Binance trading pair
    return `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}&interval=${tvTimeframe}`;
  }

  /**
   * Capture multiple charts concurrently
   * @param {Array<{symbol: string, timeframe: string}>} chartRequests
   * @returns {Promise<Array<{symbol: string, screenshot: Buffer}>>}
   */
  async captureMultipleCharts(chartRequests) {
    try {
      console.log(
        `📊 Capturing ${chartRequests.length} charts concurrently...`
      );

      const screenshots = await Promise.all(
        chartRequests.map(async ({ symbol, timeframe }) => {
          try {
            const screenshot = await this.captureChart(symbol, timeframe);
            return { symbol, screenshot, success: true };
          } catch (error) {
            console.error(`[${symbol}] Failed to capture chart:`, error);
            return { symbol, screenshot: null, success: false };
          }
        })
      );

      const successCount = screenshots.filter((s) => s.success).length;
      console.log(
        `✅ Successfully captured ${successCount}/${chartRequests.length} charts`
      );

      return screenshots;
    } catch (error) {
      console.error("❌ Error capturing multiple charts:", error);
      throw error;
    }
  }

  /**
   * Save screenshot to file (for testing/debugging)
   * @param {Buffer} screenshot - Screenshot buffer
   * @param {string} filename - Output filename
   * @returns {Promise<string>} - File path
   */
  async saveScreenshot(screenshot, filename) {
    try {
      const tmpDir = path.join(__dirname, "..", "tmp");

      // Create tmp directory if it doesn't exist
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, screenshot);

      console.log(`💾 Screenshot saved to: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error("❌ Error saving screenshot:", error);
      throw error;
    }
  }

  /**
   * Clean up old screenshots from tmp directory
   * @param {number} maxAgeMs - Maximum age in milliseconds
   */
  async cleanupOldScreenshots(maxAgeMs = 3600000) {
    // Default: 1 hour
    try {
      const tmpDir = path.join(__dirname, "..", "tmp");

      if (!fs.existsSync(tmpDir)) {
        return;
      }

      const files = fs.readdirSync(tmpDir);
      const now = Date.now();

      files.forEach((file) => {
        const filePath = path.join(tmpDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Deleted old screenshot: ${file}`);
        }
      });
    } catch (error) {
      console.error("❌ Error cleaning up old screenshots:", error);
    }
  }

  /**
   * Close browser and cleanup
   */
  async shutdown() {
    try {
      if (this.browser) {
        const pages = await this.browser.pages();
        // Close all pages first
        for (const page of pages) {
          try {
            await page.close();
          } catch (e) {
            // Ignore individual page errors
          }
        }
        // Then close browser
        await this.browser.close();
        this.browser = null;
        this.isInitialized = false;
        console.log("✅ Puppeteer browser closed");
      }
    } catch (error) {
      console.error("❌ Error shutting down Puppeteer browser:", error);
      // Force null even on error
      this.browser = null;
      this.isInitialized = false;
    }
  }

  /**
   * Health check - verify browser is running
   * @returns {boolean}
   */
  async healthCheck() {
    return await this.isBrowserHealthy();
  }

  /**
   * Reset failure tracking and re-enable browser initialization
   */
  resetFailures() {
    this.consecutiveFailures = 0;
    this.isDisabled = false;
    this.lastFailureTime = 0;
    console.log("✅ Browser failure tracking reset. Screenshots re-enabled.");
  }

  /**
   * Get browser state information
   * @returns {object} Browser state
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      isDisabled: this.isDisabled,
      consecutiveFailures: this.consecutiveFailures,
      timeSinceLastFailure: this.lastFailureTime
        ? Date.now() - this.lastFailureTime
        : 0,
      initializationInProgress: this.initializationInProgress,
    };
  }
}

// Export singleton instance
export default new ChartScreenshotService();
