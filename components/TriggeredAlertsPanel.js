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

      if (!userId) {
        console.log("No user ID found");
        return;
      }

      // Fetch triggered alerts from database
      const response = await fetch(
        `/api/alerts/history?userId=${userId}&limit=50`
      );
      const data = await response.json();

      if (data.success) {
        // Transform database alerts to display format
        const triggeredAlerts = data.data.map((alert) => ({
          id: alert._id,
          symbol: alert.symbol,
          type: "triggered",
          triggered: true,
          triggeredAt: new Date(alert.triggeredAt || alert.createdAt),
          triggeredPrice: alert.triggerData.price,
          triggeredVolume: alert.triggerData.volume,
          priceChangePercent: alert.triggerData.priceChangePercent,
          conditions: alert.alertConditions,
          conditionsText:
            alert.conditions ||
            `Volume: ${alert.triggerData.volume?.toLocaleString()} | Change: ${alert.triggerData.priceChangePercent?.toFixed(
              3
            )}%`,
          targetValue: alert.alertConditions.changePercent?.percentage,
          actualValue: Math.abs(alert.triggerData.priceChangePercent || 0),
          timeframe: alert.alertConditions.changePercent?.timeframe,
          volume24h: alert.triggerData.volume,
          price24hChange: alert.triggerData.priceChangePercent,
          high: alert.triggerData.high,
          low: alert.triggerData.low,
          open: alert.triggerData.open,
          close: alert.triggerData.close,
          notificationType: "both",
          notificationSent: true,
        }));

        setAlerts(triggeredAlerts);
        console.log("📊 Loaded triggered alerts:", triggeredAlerts.length);
      } else {
        console.error("Failed to load alerts:", data.error);
      }
    } catch (error) {
      console.error("Error loading alerts:", error);
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
            mb: 1,
          }}
        >
          <Typography variant="h6" sx={{ color: "white" }}>
            Triggered Alerts
          </Typography>
          <Badge badgeContent={alerts.length} color="primary">
            <NotificationsActiveIcon sx={{ color: "#1976d2" }} />
          </Badge>
        </Box>

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={loadAlerts}
            disabled={loading}
            startIcon={<RefreshIcon />}
            sx={{ fontSize: "0.75rem" }}
          >
            Refresh
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={handleClearAll}
            disabled={alerts.length === 0}
            startIcon={<ClearIcon />}
            sx={{ fontSize: "0.75rem" }}
          >
            Clear All
          </Button>
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
          <List sx={{ p: 0 }}>
            {alerts.map((alert, index) => (
              <React.Fragment key={alert.id}>
                <ListItem
                  sx={{
                    backgroundColor: "#2a2a2a",
                    borderBottom: "1px solid #333",
                    "&:hover": {
                      backgroundColor: "#333",
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <Box
                      sx={{
                        color: getAlertTypeColor(alert.type),
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {getAlertTypeIcon(alert.type)}
                    </Box>
                  </ListItemIcon>

                  <ListItemText
                    primary={
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 0.5,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ color: "white", fontWeight: 600 }}
                        >
                          {alert.symbol}
                        </Typography>
                        <Chip
                          label={
                            alert.type ? alert.type.toUpperCase() : "ALERT"
                          }
                          size="small"
                          sx={{
                            backgroundColor: getAlertTypeColor(
                              alert.type || "alert"
                            ),
                            color: "white",
                            fontSize: "0.65rem",
                            height: 20,
                          }}
                        />
                        <Chip
                          label={`${alert.conditions?.changePercent || "N/A"} ${
                            alert.conditions?.percentage || "0"
                          }%`}
                          size="small"
                          variant="outlined"
                          sx={{
                            color: "#888",
                            borderColor: "#444",
                            fontSize: "0.65rem",
                            height: 20,
                          }}
                        />
                      </Box>
                    }
                    secondary={
                      <span>
                        <Typography
                          variant="caption"
                          sx={{ color: "#888", display: "block", mb: 1 }}
                        >
                          {alert.conditionsText || "Conditions met"}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: "#888", display: "block" }}
                        >
                          Target: {alert.targetValue || 1} | Actual:{" "}
                          {alert.actualValue?.toFixed(6) || "N/A"} |{" "}
                          {alert.timeframe || "5MIN"}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: "white", display: "block" }}
                        >
                          Price: {formatPrice(alert.triggeredPrice || 0)} | 24h
                          Change:{" "}
                          {alert.price24hChange
                            ? `${parseFloat(alert.price24hChange).toFixed(3)}%`
                            : "N/A"}
                        </Typography>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginTop: "4px",
                          }}
                        >
                          <Typography variant="caption" sx={{ color: "#888" }}>
                            {mounted
                              ? formatTimeAgo(alert.triggeredAt)
                              : "Loading..."}
                          </Typography>
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            {getNotificationIcon(
                              alert.notificationType || "both"
                            )}
                            {alert.notificationSent ? (
                              <CheckCircleIcon
                                sx={{ fontSize: 12, color: "#4caf50" }}
                              />
                            ) : (
                              <ErrorIcon
                                sx={{ fontSize: 12, color: "#f44336" }}
                              />
                            )}
                          </span>
                        </span>
                      </span>
                    }
                  />

                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 1,
                    }}
                  >
                    <Chip
                      label="TRIGGERED"
                      size="small"
                      sx={{
                        backgroundColor: "#f44336",
                        color: "white",
                        fontSize: "0.65rem",
                        height: 20,
                      }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => handleClearAlert(alert.id)}
                      sx={{ color: "#888" }}
                    >
                      <ClearIcon />
                    </IconButton>
                  </Box>
                </ListItem>
                {index < alerts.length - 1 && (
                  <Divider sx={{ backgroundColor: "#333" }} />
                )}
              </React.Fragment>
            ))}
          </List>
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
