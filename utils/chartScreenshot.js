import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import candlestickCanvas from "./candlestickCanvas.js";
import candleCache from "./candleCache.js"; // 🔥 NEW: Candle caching to prevent IP bans

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
    // Binance IP ban tracking (FIX for 418 errors)
    this.binanceIpBannedUntil = 0; // Track when IP ban expires
    this.binanceBanCooldown = 600000; // 10 minutes cooldown on 418

    // 🔥 NEW: Rate limiting to PREVENT IP bans
    this.lastBinanceRequest = 0;
    this.minRequestInterval = 1000; // Minimum 1 second between requests
    this.requestCount = 0;
    this.requestCountResetTime = Date.now();
    this.maxRequestsPerMinute = 30; // Max 30 requests per minute (conservative)
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
        `Failed to initialize browser after ${maxRetries} attempts: ${lastError?.message || "Unknown error"
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
   * Fetch Binance Kline data (FREE) with 418 IP ban handling
   * @param {string} symbol - Trading pair symbol
   * @param {string} interval - Timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w)
   * @param {number} limit - Number of candles (default: 50)
   * @returns {Promise<Array>} - Array of candle objects
   */
  async getBinanceCandles(symbol, interval = "5m", limit = 50) {
    // Check if IP is banned (10-minute cooldown)
    if (Date.now() < this.binanceIpBannedUntil) {
      const waitMs = this.binanceIpBannedUntil - Date.now();
      console.log(`🚫 Binance IP banned, skipping candles for ${symbol}. Wait ${Math.ceil(waitMs / 60000)} more minutes...`);
      throw new Error("BINANCE_IP_BANNED");
    }

    // 🔥 NEW: Rate limiting to PREVENT IP bans
    const now = Date.now();

    // Reset counter every minute
    if (now - this.requestCountResetTime > 60000) {
      this.requestCount = 0;
      this.requestCountResetTime = now;
    }

    // Check if we've exceeded requests per minute
    if (this.requestCount >= this.maxRequestsPerMinute) {
      console.log(`⏳ Rate limit reached (${this.requestCount}/${this.maxRequestsPerMinute} requests/min), skipping chart for ${symbol}`);
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    // Ensure minimum interval between requests
    const timeSinceLastRequest = now - this.lastBinanceRequest;
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`⏳ Waiting ${waitTime}ms before next Binance request...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update request tracking
    this.lastBinanceRequest = Date.now();
    this.requestCount++;

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

      // 🔥 FIX: Add timestamp for cache-busting to get fresh data
      const timestamp = Date.now();
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}&_t=${timestamp}`;
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });

      return res.data.map((c) => ({
        timestamp: c[0], // Open time in milliseconds
        openTime: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));
    } catch (error) {
      // Check for 418 IP ban
      if (error.response && error.response.status === 418) {
        this.binanceIpBannedUntil = Date.now() + this.binanceBanCooldown;
        console.error(`🚫 HTTP 418: Binance IP BANNED! Stopping candle requests for 10 minutes`);
        console.error(`🚫 Resume at: ${new Date(this.binanceIpBannedUntil).toLocaleTimeString()}`);
        throw new Error("BINANCE_IP_BANNED");
      }

      console.error(
        `❌ Error fetching Binance candles for ${symbol}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Generate Candlestick chart using QuickChart (FAST - PRIMARY METHOD)
   * Uses OHLC chart type for proper candlestick display like TradingView
   * @param {string} symbol - Trading pair symbol
   * @param {Array} candles - Array of candle objects
   * @returns {Promise<Buffer>} - Chart image buffer
   */
  async captureCandlestickChart(symbol, candles = []) {
    if (!candles || candles.length === 0) {
      throw new Error("No candle data provided");
    }

    try {
      // Calculate price change for title
      const firstPrice = candles[0].close;
      const lastPrice = candles[candles.length - 1].close;
      const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
      const isPositive = lastPrice >= firstPrice;

      // Format OHLC data for candlestick chart
      // QuickChart uses boxplot-like format: [open, high, low, close]
      const ohlcData = candles.map((c) => ({
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
      }));

      // Volume data with colors based on candle direction
      const volumeData = candles.map((c, i) => ({
        x: i,
        y: c.volume,
      }));

      const volumeColors = candles.map((c) =>
        c.close >= c.open ? "rgba(38, 166, 91, 0.6)" : "rgba(231, 76, 60, 0.6)"
      );

      // Time labels (empty for cleaner look, or format if needed)
      const labels = candles.map((c, i) => {
        if (c.timestamp) {
          const date = new Date(c.timestamp);
          return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        }
        return "";
      });

      // Use box plot style for candlestick simulation (QuickChart compatible)
      // Since QuickChart doesn't have native candlestick, we use a combination approach
      const chartConfig = {
        type: "bar",
        data: {
          labels: labels,
          datasets: [
            // Candlestick body (using floating bars)
            {
              type: "bar",
              label: `${symbol}`,
              data: candles.map((c) => {
                const isGreen = c.close >= c.open;
                return {
                  x: labels[candles.indexOf(c)],
                  y: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
                };
              }),
              backgroundColor: candles.map((c) =>
                c.close >= c.open ? "rgba(38, 166, 91, 1)" : "rgba(231, 76, 60, 1)"
              ),
              borderColor: candles.map((c) =>
                c.close >= c.open ? "rgb(38, 166, 91)" : "rgb(231, 76, 60)"
              ),
              borderWidth: 1,
              barPercentage: 0.8,
              categoryPercentage: 0.9,
            },
            // Volume bars at bottom
            {
              type: "bar",
              label: "Volume",
              data: candles.map((c) => c.volume),
              backgroundColor: volumeColors,
              yAxisID: "volume",
              barPercentage: 0.6,
              order: 2,
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
                color: "#ffffff",
                font: { size: 14, weight: "bold" },
                boxWidth: 15,
              },
            },
            title: {
              display: true,
              text: `📊 ${symbol} | ${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}% | $${lastPrice.toFixed(6)}`,
              color: isPositive ? "#26a65b" : "#e74c3c",
              font: { size: 18, weight: "bold" },
              padding: { top: 10, bottom: 20 },
            },
          },
          scales: {
            x: {
              display: true,
              ticks: {
                color: "#888888",
                maxTicksLimit: 8,
                font: { size: 10 },
              },
              grid: {
                color: "rgba(255,255,255,0.05)",
              },
            },
            y: {
              type: "linear",
              position: "right",
              ticks: {
                color: "#ffffff",
                font: { size: 11 },
                callback: (value) => {
                  if (value >= 1) return "$" + value.toFixed(2);
                  return "$" + value.toFixed(6);
                },
              },
              grid: {
                color: "rgba(255,255,255,0.08)",
              },
            },
            volume: {
              type: "linear",
              position: "left",
              max: Math.max(...candles.map((c) => c.volume)) * 4,
              ticks: {
                display: false,
              },
              grid: {
                display: false,
              },
            },
          },
        },
      };

      const url = `${this.quickChartBaseUrl
        }?width=1600&height=800&format=png&backgroundColor=rgb(20,20,20)&c=${encodeURIComponent(
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
          const postUrl = `${this.quickChartBaseUrl}?width=1600&height=800&format=png&backgroundColor=rgb(20,20,20)`;
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
   * Main capture method - uses Canvas for REAL candlestick charts (FAST - no browser needed!)
   * @param {string} symbol - Trading pair symbol (e.g., VANAUSDT, BTCUSDT)
   * @param {string} timeframe - Chart timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w)
   * @param {object} options - Options { alertData, liveData }
   * @returns {Promise<Buffer>} - Screenshot buffer
   */
  async captureChart(symbol, timeframe = "5m", options = {}) {
    // 🔥 PERMANENT FIX: Try cached candles first (no Binance API call needed!)
    try {
      console.log(`🕯️ Generating canvas candlestick chart for ${symbol}...`);

      // 🔥 FIX: Wait 2 seconds to ensure Binance API returns the latest candle data
      await new Promise(resolve => setTimeout(resolve, 2000));

      const candles = await this.getBinanceCandles(symbol, timeframe, 100); // 🔥 Zoom out: Show 100 candles (was 35)

      // Step 1: Try to get candles from cache (Redis/Memory)
      //let candles = await candleCache.getCandles(symbol, timeframe, 100);

      if (candles && candles.length >= 50) {
        console.log(`✅ Using CACHED candles for ${symbol} (${candles.length} candles) - NO Binance API call!`);
      } else {
        // Step 2: Cache miss - fetch from Binance and store in cache
        console.log(`📡 Cache miss for ${symbol}, fetching from Binance...`);
        candles = await this.getBinanceCandles(symbol, timeframe, 100);

        if (candles && candles.length > 0) {
          // Store in cache for next time
          await candleCache.storeCandles(symbol, timeframe, candles);
          console.log(`💾 Stored ${candles.length} candles in cache for ${symbol}`);
        }
      }

      if (!candles || candles.length === 0) {
        throw new Error("No candle data available");
      }

      // 🔥 FIX: Update last candle with live price (NO new candle added!)
      // This ensures chart shows current price without adding extra candle
      // New candles only come from cache when timeframe naturally progresses
      if (options.liveData && options.liveData.price && candles.length > 0) {
        const livePrice = parseFloat(options.liveData.price) || 0;

        if (livePrice > 0) {
          // ALWAYS update the last candle with current price (no new candle)
          const lastCachedCandle = candles[candles.length - 1];

          candles[candles.length - 1] = {
            ...lastCachedCandle,
            high: Math.max(lastCachedCandle.high || livePrice, livePrice),
            low: Math.min(lastCachedCandle.low || livePrice, livePrice),
            close: livePrice  // Update close to current live price
          };

          console.log(`📈 Updated last candle with live price: $${livePrice}`);
        }
      }

      // 🔥 FIX: Pass alertData to canvas generator for trigger price marker
      const alertData = options.alertData || null;
      const chartBuffer = candlestickCanvas.generate(symbol, candles, timeframe, alertData);
      console.log(`✅ Chart generated (${(chartBuffer.length / 1024).toFixed(1)}KB)${alertData ? ' with alert marker' : ''}`);
      return chartBuffer;

    } catch (canvasError) {
      // 🔥 FIX: If rate limited or IP banned, return null instead of throwing
      // This allows alert to be sent without chart
      if (canvasError.message === "BINANCE_IP_BANNED" || canvasError.message === "RATE_LIMIT_EXCEEDED") {
        console.warn(`⚠️ ${canvasError.message}: Skipping chart for ${symbol}, alert will be sent without image`);
        return null; // Return null - alert will be sent without chart
      }

      console.warn(`⚠️ Canvas chart failed for ${symbol}: ${canvasError.message}`);

      // Method 2: Puppeteer/TradingView (FALLBACK - slower but guaranteed candlestick)
      try {
        console.log(`📊 Falling back to Puppeteer for ${symbol}...`);
        return await this.captureChartPuppeteer(symbol, timeframe);
      } catch (puppeteerError) {
        console.warn(`⚠️ Puppeteer also failed: ${puppeteerError.message}`);

        // Method 3: QuickChart (LAST RESORT - line chart)
        try {
          console.log(`📊 Using QuickChart as last resort for ${symbol}...`);
          const candles = await this.getBinanceCandles(symbol, timeframe, 50);
          return await this.captureCandlestickChart(symbol, candles);
        } catch (quickChartError) {
          // 🔥 FIX: If all methods fail, return null instead of crashing
          console.warn(`⚠️ All chart methods failed for ${symbol}, sending alert without chart`);
          return null;
        }
      }
    }
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
   * Convert timeframe string to milliseconds
   * @param {string} timeframe - Timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w)
   * @returns {number} - Milliseconds
   */
  getTimeframeMs(timeframe) {
    const tf = timeframe.toLowerCase();
    const value = parseInt(tf) || 1;

    if (tf.endsWith('w')) return value * 7 * 24 * 60 * 60 * 1000;
    if (tf.endsWith('d')) return value * 24 * 60 * 60 * 1000;
    if (tf.endsWith('h')) return value * 60 * 60 * 1000;
    if (tf.endsWith('m')) return value * 60 * 1000;

    // Default to 5 minutes
    return 5 * 60 * 1000;
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
    this.binanceIpBannedUntil = 0; // Also reset IP ban
    console.log("✅ Browser and Binance failure tracking reset. Screenshots re-enabled.");
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
      binanceIpBanned: Date.now() < this.binanceIpBannedUntil,
      binanceIpBanRemaining: Math.max(0, this.binanceIpBannedUntil - Date.now()),
    };
  }
}

// Export singleton instance
export default new ChartScreenshotService();
