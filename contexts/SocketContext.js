"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [marketData, setMarketData] = useState(new Map());
  const [eventSource, setEventSource] = useState(null);
  const [subscribedSymbols, setSubscribedSymbols] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [alertProcessor, setAlertProcessor] = useState(null);

  // Batching for market updates to prevent incremental loading effect
  const pendingUpdates = React.useRef(new Map());
  const batchTimeoutRef = React.useRef(null);
  const initialDataLoadedRef = React.useRef(false);

  // Set alert processor from AlertContext
  const setAlertProcessorRef = useCallback((processor) => {
    setAlertProcessor(() => processor);
  }, []);

  // Process alerts when market data updates
  useEffect(() => {
    if (alertProcessor && marketData.size > 0) {
      alertProcessor(marketData);
    }
  }, [marketData, alertProcessor]);

  // Connect to Server-Sent Events
  const connect = useCallback(
    (symbols = []) => {
      if (eventSource) {
        console.log("🔌 Closing existing SSE connection");
        eventSource.close();
      }

      const symbolsParam = symbols.length > 0 ? symbols.join(",") : "";
      const url = `/api/market/stream${symbolsParam ? `?symbols=${symbolsParam}` : ""
        }`;

      console.log("🔌 Connecting to SSE:", url);

      // Reset initial data flag on new connection (for page refresh)
      initialDataLoadedRef.current = false;
      pendingUpdates.current = new Map();
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
        batchTimeoutRef.current = null;
      }

      const es = new EventSource(url);
      setEventSource(es);
      setSubscribedSymbols(symbols);

      es.onopen = () => {
        console.log("✅ SSE connection opened");
        setIsConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "initial_data") {
            console.log(
              "📊 Received initial data:",
              data.data.length,
              "symbols - loading ALL at once"
            );
            // Mark initial data as loaded
            initialDataLoadedRef.current = true;

            setMarketData((prev) => {
              const newMarketData = new Map();
              data.data.forEach((item) => {
                // Preserve favorite status from previous data
                const previousData = prev.get(item.symbol);
                newMarketData.set(item.symbol, {
                  ...item,
                  isFavorite: previousData ? previousData.isFavorite : false,
                });
              });
              console.log(`✅ All ${newMarketData.size} pairs loaded instantly!`);
              return newMarketData;
            });
          } else if (data.type === "market_update") {
            // Only process updates AFTER initial data is loaded
            // This prevents the counting effect
            if (!initialDataLoadedRef.current) {
              return; // Skip updates until initial data loads
            }

            // Batch updates to reduce re-renders
            pendingUpdates.current.set(data.symbol, data.data);

            // Apply batched updates every 500ms
            if (!batchTimeoutRef.current) {
              batchTimeoutRef.current = setTimeout(() => {
                const updates = pendingUpdates.current;
                if (updates.size > 0) {
                  setMarketData((prev) => {
                    const newMap = new Map(prev);
                    updates.forEach((updateData, symbol) => {
                      const previousData = prev.get(symbol);
                      newMap.set(symbol, {
                        ...updateData,
                        isFavorite: previousData ? previousData.isFavorite : false,
                      });
                    });
                    return newMap;
                  });
                  setLastUpdate(Date.now());
                  pendingUpdates.current = new Map();
                }
                batchTimeoutRef.current = null;
              }, 500);
            }
          } else if (data.type === "heartbeat" || data.type === "ping") {
            // Keep connection alive - no logging to reduce noise
          }
        } catch (error) {
          console.error("❌ Error parsing SSE message:", error);
        }
      };

      es.onerror = (error) => {
        console.error("❌ SSE connection error:", error);
        setIsConnected(false);

        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          if (es.readyState === EventSource.CLOSED) {
            console.log("🔄 Attempting to reconnect...");
            connect(symbols);
          }
        }, 5000);
      };

      es.onclose = () => {
        console.log("🔌 SSE connection closed");
        setIsConnected(false);
      };
    },
    [] // Remove eventSource from dependencies to prevent infinite loop
  );

  // Disconnect from SSE
  const disconnect = useCallback(() => {
    if (eventSource) {
      console.log("🔌 Disconnecting SSE...");
      eventSource.close();
      setEventSource(null);
      setIsConnected(false);
    }
  }, []); // Remove eventSource from dependencies to prevent infinite loop

  // Subscribe to specific symbols
  const subscribeToSymbols = useCallback(
    (symbols) => {
      console.log("📡 Subscribing to symbols:", symbols);
      connect(symbols);
    },
    [connect]
  );

  // Fetch all available USDT pairs
  const fetchAllPairs = useCallback(async () => {
    try {
      const response = await fetch("/api/market/pairs");
      const data = await response.json();

      if (data.success) {
        console.log(`📊 Found ${data.count} USDT spot pairs`);
        return data.pairs;
      }
      return [];
    } catch (error) {
      console.error("❌ Error fetching pairs:", error);
      return [];
    }
  }, []);

  // Get market data for a specific symbol
  const getSymbolData = useCallback(
    (symbol) => {
      return marketData.get(symbol?.toUpperCase());
    },
    [marketData]
  );

  // Get all market data as array
  const getAllMarketData = useCallback(() => {
    return Array.from(marketData.values());
  }, [marketData]);

  // Get filtered market data
  const getFilteredMarketData = useCallback(
    (filter = {}) => {
      let data = getAllMarketData();

      // Filter to only show USDT spot pairs (Binance spot market)
      data = data.filter((item) => {
        // Check if item and symbol exist
        if (!item || !item.symbol || typeof item.symbol !== "string") {
          return false;
        }

        // Only show USDT pairs
        if (!item.symbol.endsWith("USDT")) {
          return false;
        }

        // Exclude premium pairs (usually have _ in symbol)
        if (item.symbol.includes("_")) {
          return false;
        }

        // Exclude leveraged tokens (more specific matching)
        // Note: Removed UP/DOWN from this list - they were incorrectly filtering legitimate coins like SYRUP and JUP
        const leveragedTokens = [
          "BULL",
          "BEAR",
          "3L",
          "3S",
          "5L",
          "5S",
        ];
        if (leveragedTokens.some((token) => item.symbol.includes(token))) {
          return false;
        }

        // Exclude BUSD pairs (but allow USDT pairs that might contain BUSD in base asset)
        if (item.symbol.startsWith("BUSD")) {
          return false;
        }

        return true;
      });

      if (filter.search) {
        data = data.filter((item) =>
          item.symbol.toLowerCase().includes(filter.search.toLowerCase())
        );
      }

      if (filter.favorites) {
        data = data.filter((item) => item.isFavorite);
      }

      if (filter.sortBy) {
        data.sort((a, b) => {
          switch (filter.sortBy) {
            case "price":
              return b.price - a.price;
            case "change":
              return b.change - a.change;
            case "volume":
              return b.volume - a.volume;
            case "symbol":
              return a.symbol.localeCompare(b.symbol);
            default:
              return 0;
          }
        });
      }

      return data;
    },
    [getAllMarketData]
  );

  // Toggle favorite status (now just for UI updates, actual persistence handled by API)
  const toggleFavorite = useCallback((symbol) => {
    setMarketData((prev) => {
      const newMap = new Map(prev);
      const currentData = newMap.get(symbol);
      if (currentData) {
        newMap.set(symbol, {
          ...currentData,
          isFavorite: !currentData.isFavorite,
        });
      }
      return newMap;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const value = {
    isConnected,
    marketData: getAllMarketData(),
    getSymbolData,
    getFilteredMarketData,
    subscribeToSymbols,
    fetchAllPairs,
    toggleFavorite,
    connect,
    disconnect,
    lastUpdate,
    subscribedSymbols,
    setAlertProcessorRef,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

export default SocketContext;
