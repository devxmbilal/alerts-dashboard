"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useSocket } from "./SocketContext";

const AlertContext = createContext();

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error("useAlert must be used within an AlertProvider");
  }
  return context;
};

export const AlertProvider = ({ children }) => {
  const [alerts, setAlerts] = useState(new Map()); // symbol -> alert conditions
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);
  const alertCheckInterval = useRef(null);
  const { setAlertProcessorRef } = useSocket();

  // Create alert for a symbol (now saves to MongoDB)
  const createAlert = useCallback(
    async (symbol, conditions, userId = "default") => {
      try {
        const response = await fetch("/api/alerts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            symbol,
            conditions,
            notificationSettings: {
              email: false,
              telegram: false,
              webhook: false,
            },
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to create alert");
        }

        const result = await response.json();
        const newAlert = result.data;

        // Update local state
        setAlerts((prev) => {
          const newMap = new Map(prev);
          newMap.set(symbol, newAlert);
          return newMap;
        });

        console.log(`🚨 Alert created for ${symbol}:`, newAlert);
        return newAlert;
      } catch (error) {
        console.error("❌ Error creating alert:", error);
        throw error;
      }
    },
    []
  );

  // Remove alert for a symbol
  const removeAlert = useCallback((symbol) => {
    setAlerts((prev) => {
      const newMap = new Map(prev);
      newMap.delete(symbol);
      return newMap;
    });
    console.log(`🗑️ Alert removed for ${symbol}`);
  }, []);

  // Check if symbol has an alert
  const hasAlert = useCallback(
    (symbol) => {
      return alerts.has(symbol);
    },
    [alerts]
  );

  // Get alert for a symbol
  const getAlert = useCallback(
    (symbol) => {
      return alerts.get(symbol);
    },
    [alerts]
  );

  // Get all alerts
  const getAllAlerts = useCallback(() => {
    return Array.from(alerts.values());
  }, [alerts]);

  // Check alert conditions against market data
  const checkAlertConditions = useCallback(
    (symbol, marketData) => {
      const alert = alerts.get(symbol);
      if (!alert || !marketData) return false;

      const { conditions } = alert;
      const { minDaily, changePercent, timeframe, percentage } = conditions;

      // Check Min Daily condition
      if (minDaily && marketData.volume) {
        const minVolume = parseFloat(minDaily);
        if (marketData.volume < minVolume) {
          return false;
        }
      }

      // Check Change % condition
      if (changePercent && percentage && marketData.priceChangePercent) {
        const requiredChange = parseFloat(percentage);
        const actualChange = Math.abs(
          parseFloat(marketData.priceChangePercent)
        );

        if (actualChange < requiredChange) {
          return false;
        }
      }

      return true;
    },
    [alerts]
  );

  // Get detailed alert conditions for display
  const getAlertConditionsText = useCallback((alert, marketData) => {
    const { conditions } = alert;
    const { minDaily, changePercent, percentage } = conditions;

    let conditionsText = "Combined conditions met: ";
    const conditionsList = [];

    if (minDaily && marketData.volume) {
      const minVolume = parseFloat(minDaily);
      const actualVolume = parseFloat(marketData.volume);
      conditionsList.push(
        `Volume ${actualVolume.toLocaleString()} >= ${minVolume.toLocaleString()}`
      );
    }

    if (changePercent && percentage && marketData.priceChangePercent) {
      const actualChange = parseFloat(marketData.priceChangePercent);
      const requiredChange = parseFloat(percentage);
      const direction = actualChange >= 0 ? "upward" : "downward";
      conditionsList.push(
        `${Math.abs(actualChange).toFixed(
          6
        )}% >= ${requiredChange}% (${direction})`
      );
    }

    return conditionsText + conditionsList.join(" AND ");
  }, []);

  // Clear triggered alerts
  const clearTriggeredAlerts = useCallback(() => {
    setTriggeredAlerts([]);
  }, []);

  // Get triggered alerts
  const getTriggeredAlerts = useCallback(() => {
    return triggeredAlerts;
  }, [triggeredAlerts]);

  // Create alerts for multiple symbols (favorites)
  const createAlertsForSymbols = useCallback(
    (symbols, conditions) => {
      const createdAlerts = [];
      symbols.forEach((symbol) => {
        if (!hasAlert(symbol)) {
          const alert = createAlert(symbol, conditions);
          createdAlerts.push(alert);
        }
      });
      return createdAlerts;
    },
    [createAlert, hasAlert]
  );

  // Remove alerts for multiple symbols
  const removeAlertsForSymbols = useCallback(
    (symbols) => {
      symbols.forEach((symbol) => {
        removeAlert(symbol);
      });
    },
    [removeAlert]
  );

  // Process market data and check for triggered alerts
  const processMarketData = useCallback(
    (marketData) => {
      const triggered = [];

      for (const [symbol, alert] of alerts) {
        if (alert.status === "active" && !alert.triggered) {
          const symbolData = marketData.get(symbol);
          if (symbolData && checkAlertConditions(symbol, symbolData)) {
            // Alert triggered!
            const triggeredAlert = {
              ...alert,
              triggered: true,
              triggeredAt: new Date(),
              triggeredPrice: symbolData.price,
              triggeredVolume: symbolData.volume,
              triggeredChange: symbolData.priceChangePercent,
              // Add detailed information for display
              conditionsText: getAlertConditionsText(alert, symbolData),
              targetValue: alert.conditions.percentage,
              actualValue: Math.abs(parseFloat(symbolData.priceChangePercent)),
              timeframe: alert.conditions.timeframe,
              volume24h: symbolData.volume,
              price24hChange: symbolData.priceChangePercent,
              // Add notification status
              notificationType: "both",
              notificationSent: false,
            };

            setTriggeredAlerts((prev) => [triggeredAlert, ...prev]);
            triggered.push(triggeredAlert);

            // Mark alert as triggered
            setAlerts((prev) => {
              const newMap = new Map(prev);
              newMap.set(symbol, { ...alert, triggered: true });
              return newMap;
            });

            console.log(`🚨 ALERT TRIGGERED for ${symbol}:`, triggeredAlert);
          }
        }
      }

      return triggered;
    },
    [alerts, checkAlertConditions]
  );

  // Register alert processor with SocketContext
  useEffect(() => {
    setAlertProcessorRef(processMarketData);
  }, [setAlertProcessorRef, processMarketData]);

  const value = {
    alerts: getAllAlerts(),
    triggeredAlerts: getTriggeredAlerts(),
    createAlert,
    removeAlert,
    hasAlert,
    getAlert,
    getAllAlerts,
    checkAlertConditions,
    getAlertConditionsText,
    processMarketData,
    clearTriggeredAlerts,
    getTriggeredAlerts,
    createAlertsForSymbols,
    removeAlertsForSymbols,
  };

  return (
    <AlertContext.Provider value={value}>{children}</AlertContext.Provider>
  );
};

export default AlertContext;
