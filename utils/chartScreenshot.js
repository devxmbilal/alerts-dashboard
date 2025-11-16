import puppeteer from "puppeteer";
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
   * Capture TradingView chart screenshot
   * @param {string} symbol - Trading pair symbol (e.g., VANAUSDT, BTCUSDT)
   * @param {string} timeframe - Chart timeframe (1m, 5m, 15m, 1h, 4h, 1d)
   * @returns {Promise<Buffer>} - Screenshot buffer
   */
  async captureChart(symbol, timeframe = "5m") {
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
