import WebSocket from "ws";
import dotenv from "dotenv";
dotenv.config();
class WebSocketService {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000;
    this.subscriptions = new Set();
    this.priceData = new Map(); // symbol -> latest price data
    this.listeners = new Map(); // symbol -> callback functions
  }

  async connect() {
    try {
      console.log("🚀 Connecting to Binance WebSocket...");

      this.ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");

      this.ws.on("open", () => {
        console.log("✅ Connected to Binance WebSocket");
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });

      this.ws.on("message", (data) => {
        try {
          const tickers = JSON.parse(data);
          this.processTickerData(tickers);
        } catch (error) {
          console.error("❌ Error parsing WebSocket data:", error);
        }
      });

      this.ws.on("close", () => {
        console.log("🔌 WebSocket connection closed");
        this.isConnected = false;
        this.handleReconnect();
      });

      this.ws.on("error", (error) => {
        console.error("❌ WebSocket error:", error);
        this.isConnected = false;
      });
    } catch (error) {
      console.error("❌ Failed to connect to WebSocket:", error);
      this.handleReconnect();
    }
  }

  processTickerData(tickers) {
    tickers.forEach((ticker) => {
      const symbol = ticker.s;
      if (symbol && symbol.endsWith("USDT")) {
        const priceData = {
          symbol: symbol,
          price: parseFloat(ticker.c),
          priceChange: parseFloat(ticker.P),
          priceChangePercent: parseFloat(ticker.P),
          // ✅ FIX: Use ticker.q (quote volume in USDT) instead of ticker.v (base volume)
          volume: parseFloat(ticker.q),      // Quote volume (USDT) - CORRECT!
          volume24h: parseFloat(ticker.q),   // Quote volume (USDT)
          high: parseFloat(ticker.h),
          low: parseFloat(ticker.l),
          open: parseFloat(ticker.o),
          close: parseFloat(ticker.c),
          timestamp: Date.now(),
          isFavorite: false, // Will be updated by alert worker
        };

        // Update price data
        this.priceData.set(symbol, priceData);

        // Notify listeners for this symbol
        if (this.listeners.has(symbol)) {
          this.listeners.get(symbol).forEach((callback) => {
            try {
              callback(priceData);
            } catch (error) {
              console.error(`❌ Error in listener for ${symbol}:`, error);
            }
          });
        }

        // Also notify general listeners
        if (this.listeners.has("*")) {
          this.listeners.get("*").forEach((callback) => {
            try {
              callback(priceData);
            } catch (error) {
              console.error("❌ Error in general listener:", error);
            }
          });
        }
      }
    });
  }

  subscribe(symbol, callback) {
    if (!this.listeners.has(symbol)) {
      this.listeners.set(symbol, new Set());
    }
    this.listeners.get(symbol).add(callback);
    this.subscriptions.add(symbol);
  }

  unsubscribe(symbol, callback) {
    if (this.listeners.has(symbol)) {
      this.listeners.get(symbol).delete(callback);
      if (this.listeners.get(symbol).size === 0) {
        this.listeners.delete(symbol);
        this.subscriptions.delete(symbol);
      }
    }
  }

  subscribeToAll(callback) {
    this.subscribe("*", callback);
  }

  getLatestPrice(symbol) {
    return this.priceData.get(symbol);
  }

  getAllPrices() {
    return Array.from(this.priceData.values());
  }

  handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectInterval);
    } else {
      console.error("❌ Max reconnection attempts reached");
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }

  isConnected() {
    return this.isConnected;
  }
}

export default new WebSocketService();
