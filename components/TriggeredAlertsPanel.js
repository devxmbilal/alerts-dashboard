"use client";

import React, { useState, useEffect, memo } from "react";
import { useAlert } from "../contexts/AlertContext";
import AlertHistoryItem from "./AlertHistoryItem";
import {
  Box,
  Paper,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  IconButton,
  Button,
  Divider,
  useTheme,
  useMediaQuery,
  Badge,
  Tooltip,
} from "@mui/material";
import {
  NotificationsActive as NotificationsActiveIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  Email as EmailIcon,
  Telegram as TelegramIcon,
} from "@mui/icons-material";

// No mock data - alerts will be loaded from real triggers

const TriggeredAlertsPanel = ({ onRefresh, onClearAll, onAlertTrigger }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [eventSource, setEventSource] = useState(null);
  const { getTriggeredAlerts, clearTriggeredAlerts } = useAlert();

  // Set mounted after hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Monitor for new alerts and trigger chart switch
  useEffect(() => {
    if (alerts.length > 0 && onAlertTrigger) {
      // Get the most recent alert (first in the array since they're sorted by date desc)
      const latestAlert = alerts[0];

      // Check if this is a new alert (triggered recently)
      const now = new Date();
      const alertTime = new Date(latestAlert.triggeredAt);
      const timeDiff = now - alertTime;

      // If alert was triggered within the last 30 seconds, switch chart
      if (timeDiff < 30000) {
        console.log(
          `🚨 New alert detected for ${latestAlert.symbol}, switching chart...`
        );
        onAlertTrigger({
          symbol: latestAlert.symbol,
          price: latestAlert.triggeredPrice,
          priceChangePercent: latestAlert.priceChangePercent,
          conditions: latestAlert.conditionsText,
          triggeredAt: latestAlert.triggeredAt,
        });
      }
    }
  }, [alerts, onAlertTrigger]);

  // Load alerts from database
  const loadAlerts = async () => {
    setLoading(true);
    try {
      // Get current user ID from localStorage
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const userId = user._id || user.id;

      console.log("🔍 Debug - User from localStorage:", user);
      console.log("🔍 Debug - User ID:", userId);

      if (!userId) {
        console.error("❌ No user ID found in localStorage");
        return;
      }

      // Fetch triggered alerts from database
      const url = `/api/alerts/history?userId=${userId}&limit=50`;
      console.log("🔍 Fetching alerts from:", url);

      const response = await fetch(url);
      console.log("🔍 API Response status:", response.status);

      const data = await response.json();
      console.log("🔍 API Response data:", data);
      console.log("🔍 data.success:", data.success);
      console.log("🔍 data.data type:", Array.isArray(data.data));
      console.log("🔍 data.data length:", data.data?.length);

      if (data.success) {
        if (!data.data || !Array.isArray(data.data)) {
          console.error("❌ data.data is not an array:", data.data);
          return;
        }

        console.log("🔍 First alert sample:", data.data[0]);

        // Transform database alerts to display format
        const triggeredAlerts = data.data.map((alert) => {
          console.log("🔍 Transforming alert:", alert._id, alert.symbol);
          return {
            id: alert._id,
            symbol: alert.symbol,
            type: "triggered",
            triggered: true,
            triggeredAt: new Date(alert.triggeredAt || alert.createdAt),
            triggeredPrice: alert.triggerData?.price,
            triggeredVolume:
              alert.triggerData?.volume24h || alert.triggerData?.volume,
            priceChangePercent: alert.triggerData?.priceChangePercent,
            conditions: alert.alertConditions,
            conditionsText:
              alert.conditions ||
              `Volume: ${(
                alert.triggerData?.volume24h || alert.triggerData?.volume
              )?.toLocaleString()} | Change: ${alert.triggerData?.priceChangePercent?.toFixed(
                3
              )}%`,
            targetValue: alert.alertConditions?.changePercent?.percentage,
            actualValue: Math.abs(alert.triggerData?.priceChangePercent || 0),
            timeframe: alert.alertConditions?.changePercent?.timeframe,
            direction: alert.alertConditions?.changePercent?.direction,
            volume24h:
              alert.triggerData?.volume24h || alert.triggerData?.volume,
            price24hChange: alert.triggerData?.priceChangePercent,
            high: alert.triggerData?.high,
            low: alert.triggerData?.low,
            open: alert.triggerData?.open,
            close: alert.triggerData?.close,
            // Baseline data for comparison
            baselinePrice: alert.baselineData?.baselinePrice,
            changeFromBaselinePercent:
              alert.baselineData?.changeFromBaselinePercent,
            notificationType: "both",
            notificationSent: true,
          };
        });

        console.log("✅ Transformed alerts:", triggeredAlerts.length);
        console.log("🔍 First transformed alert:", triggeredAlerts[0]);

        setAlerts(triggeredAlerts);
        console.log("📊 Loaded triggered alerts:", triggeredAlerts.length);
      } else {
        console.error("❌ Failed to load alerts:", data.error);
      }
    } catch (error) {
      console.error("❌ Error loading alerts:", error);
      console.error("❌ Error stack:", error.stack);
    } finally {
      setLoading(false);
    }
  };

  // Clear all alerts
  const handleClearAll = () => {
    clearTriggeredAlerts();
    onClearAll?.();
  };

  // Clear specific alert
  const handleClearAlert = (alertId) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
  };

  // Format time ago
  const formatTimeAgo = (date) => {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  // Format price
  const formatPrice = (price) => {
    if (price >= 1000) return `$${price.toLocaleString()}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(4)}`;
  };

  // Get alert type icon
  const getAlertTypeIcon = (type) => {
    switch (type) {
      case "price":
        return <TrendingUpIcon />;
      case "percentage":
        return <TrendingDownIcon />;
      case "volume":
        return <NotificationsActiveIcon />;
      case "rsi":
        return <WarningIcon />;
      default:
        return <NotificationsActiveIcon />;
    }
  };

  // Get alert type color
  const getAlertTypeColor = (type) => {
    switch (type) {
      case "price":
        return "#1976d2";
      case "percentage":
        return "#f44336";
      case "volume":
        return "#4caf50";
      case "rsi":
        return "#ff9800";
      default:
        return "#1976d2";
    }
  };

  // Get notification icon
  const getNotificationIcon = (type) => {
    switch (type) {
      case "email":
        return <EmailIcon />;
      case "telegram":
        return <TelegramIcon />;
      case "both":
        return (
          <span style={{ display: "flex", gap: "4px" }}>
            <EmailIcon sx={{ fontSize: 16 }} />
            <TelegramIcon sx={{ fontSize: 16 }} />
          </span>
        );
      default:
        return <NotificationsActiveIcon />;
    }
  };

  // Load alerts on mount
  useEffect(() => {
    loadAlerts();
  }, []);

  // Auto-refresh alerts every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadAlerts();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Connect to real-time alert stream
  useEffect(() => {
    const connectToAlertStream = () => {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const userId = user._id || user.id;

      if (!userId) {
        console.log("No user ID found for alert stream");
        return;
      }

      // Close existing connection
      if (eventSource) {
        eventSource.close();
      }

      const url = `/api/alerts/stream?userId=${userId}`;
      console.log("🔌 Connecting to alert stream:", url);

      const es = new EventSource(url);
      setEventSource(es);

      es.onopen = () => {
        console.log("✅ Alert stream connected");
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "alert_triggered") {
            console.log("🚨 Real-time alert received:", data.data);

            // Add new alert to the list
            const newAlert = {
              id: data.data.alertId,
              symbol: data.data.symbol,
              type: "triggered",
              triggered: true,
              triggeredAt: new Date(data.data.triggeredAt),
              triggeredPrice: data.data.triggeredPrice,
              triggeredVolume: data.data.triggeredVolume,
              priceChangePercent: data.data.triggeredChange,
              conditions: data.data.conditions,
              conditionsText: `Volume: ${data.data.triggeredVolume?.toLocaleString()} | Change: ${data.data.triggeredChange?.toFixed(
                3
              )}%`,
              targetValue: data.data.conditions.percentage,
              actualValue: Math.abs(data.data.triggeredChange || 0),
              timeframe: data.data.conditions.timeframe,
              volume24h: data.data.triggeredVolume,
              price24hChange: data.data.triggeredChange,
              notificationType: "both",
              notificationSent: true,
            };

            setAlerts((prev) => [newAlert, ...prev]);

            // Emit custom event for other components
            window.dispatchEvent(
              new CustomEvent("alertTriggered", { detail: data.data })
            );
          } else if (data.type === "heartbeat") {
            console.log("💓 Alert stream heartbeat");
          }
        } catch (error) {
          console.error("❌ Error parsing alert stream message:", error);
        }
      };

      es.onerror = (error) => {
        console.error("❌ Alert stream error:", error);
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          if (es.readyState === EventSource.CLOSED) {
            console.log("🔄 Reconnecting to alert stream...");
            connectToAlertStream();
          }
        }, 5000);
      };

      es.onclose = () => {
        console.log("🔌 Alert stream closed");
      };
    };

    // Connect when component mounts
    connectToAlertStream();

    // Cleanup on unmount
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: "1px solid #333" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6" sx={{ color: "white" }}>
            Triggered Alerts History
          </Typography>
          <Badge badgeContent={alerts.length} color="primary">
            <NotificationsActiveIcon sx={{ color: "#1976d2" }} />
          </Badge>
        </Box>
      </Box>

      {/* Alerts List */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {alerts.length === 0 ? (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 2,
              p: 3,
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 48, color: "#4caf50" }} />
            <Typography
              variant="body2"
              sx={{ color: "#888", textAlign: "center" }}
            >
              No triggered alerts
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "#666", textAlign: "center" }}
            >
              Alerts will appear here when conditions are met
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: 2 }}>
            {alerts.map((alert) => (
              <AlertHistoryItem
                key={alert.id}
                alert={alert}
                onClear={handleClearAlert}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Footer Stats */}
      <Box
        sx={{ p: 2, borderTop: "1px solid #333", backgroundColor: "#1a1a1a" }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="caption" sx={{ color: "#888" }}>
            Total Alerts: {alerts.length}
          </Typography>
          <Typography variant="caption" sx={{ color: "#888" }}>
            Last Update:{" "}
            {mounted ? new Date().toLocaleTimeString() : "Loading..."}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default memo(TriggeredAlertsPanel);
