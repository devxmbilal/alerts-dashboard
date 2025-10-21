"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Badge,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Button,
  Collapse,
} from "@mui/material";
import {
  Notifications as NotificationsIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Clear as ClearIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";

const RealTimeNotifications = ({ token, onAlertTrigger }) => {
  const [notifications, setNotifications] = useState([]);
  const [isConnected, setIsConnected] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const onAlertTriggerRef = useRef(onAlertTrigger);

  // Keep callback ref up to date
  useEffect(() => {
    onAlertTriggerRef.current = onAlertTrigger;
    console.log("🔄 onAlertTrigger callback updated", typeof onAlertTrigger);
  }, [onAlertTrigger]);

  useEffect(() => {
    if (!token) return;

    // Connect to real-time notifications
    connectToNotifications();

    // Load existing notifications
    loadNotifications();

    return () => {
      if (eventSourceRef.current) {
        console.log("🗱️ Cleaning up EventSource on unmount");
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [token]);

  const connectToNotifications = () => {
    // Skip real-time connection if disabled
    if (process.env.NEXT_PUBLIC_DISABLE_REALTIME_NOTIFICATIONS === "true") {
      console.log("📱 Real-time notifications disabled");
      return;
    }

    try {
      // Close existing connection first
      if (eventSourceRef.current) {
        console.log("🔄 Closing existing EventSource connection");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const url = `${
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"
      }/api/notifications/stream?token=${encodeURIComponent(token)}`;
      
      console.log("🔌 Connecting to notifications stream:", url);
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        console.log("✅ EventSource connection opened successfully");
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("📨 Received notification:", data.type, data.symbol);

          if (data.type === "connected") {
            console.log("📡 Notifications stream connected");
            setIsConnected(true);
            return;
          }

          // Add new notification
          setNotifications((prev) => {
            const newNotifications = [data, ...prev];
            // Keep only last 50 notifications
            return newNotifications.slice(0, 50);
          });

          // Update unread count
          setUnreadCount((prev) => prev + 1);

          // Trigger chart switch if callback provided
          if (onAlertTriggerRef.current && data.symbol) {
            console.log(
              `🚨 TRIGGERING CHART SWITCH for ${data.symbol}`
            );
            console.log("🔍 onAlertTrigger callback exists:", typeof onAlertTriggerRef.current);
            console.log("🔍 Alert data:", {
              symbol: data.symbol,
              price: data.price,
              priceChangePercent: data.priceChangePercent,
            });
            
            try {
              onAlertTriggerRef.current({
                symbol: data.symbol,
                price: data.price,
                priceChangePercent: data.priceChangePercent,
                conditions: data.conditions,
                triggeredAt: data.triggeredAt,
              });
              console.log("✅ Chart switch callback executed successfully");
            } catch (callbackError) {
              console.error("❌ Error in onAlertTrigger callback:", callbackError);
              console.error("❌ Callback error stack:", callbackError.stack);
            }
          } else {
            console.warn("⚠️ Chart switch NOT triggered:", {
              hasCallback: !!onAlertTriggerRef.current,
              hasSymbol: !!data.symbol,
            });
          }

          // Show browser notification if permission granted
          if (Notification.permission === "granted") {
            new Notification(`Alert Triggered: ${data.symbol}`, {
              body: `Price: $${data.price} | Change: ${data.priceChangePercent}%`,
              icon: "/favicon.ico",
            });
          }
        } catch (error) {
          console.error("❌ Error parsing notification:", error);
          console.error("❌ Event data:", event.data);
        }
      };

      eventSource.onerror = (error) => {
        console.error("❌ Notifications stream error:", error);
        console.error("❌ EventSource readyState:", eventSource.readyState);
        console.error("❌ EventSource.CONNECTING:", EventSource.CONNECTING);
        console.error("❌ EventSource.OPEN:", EventSource.OPEN);
        console.error("❌ EventSource.CLOSED:", EventSource.CLOSED);
        
        setIsConnected(false);

        // Close the failed connection
        if (eventSource.readyState !== EventSource.CLOSED) {
          console.log("🔒 Closing failed EventSource connection");
          eventSource.close();
        }

        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        // Attempt to reconnect after 5 seconds
        console.log("🔄 Scheduling reconnection in 5 seconds...");
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log("🔄 Attempting to reconnect...");
          connectToNotifications();
        }, 5000);
      };

      eventSourceRef.current = eventSource;
      console.log("📌 EventSource reference saved");
    } catch (error) {
      console.error("❌ Error connecting to notifications:", error);
      setIsConnected(false);
    }
  };

  const loadNotifications = async () => {
    try {
      const response = await fetch("/api/notifications", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.notifications?.filter((n) => !n.read).length || 0);
      }
    } catch (error) {
      console.error("❌ Error loading notifications:", error);
    }
  };

  const markAsRead = async (notificationId) => {
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notificationId }),
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.map((notification) =>
            notification.id === notificationId
              ? { ...notification, read: true }
              : notification
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("❌ Error marking notification as read:", error);
    }
  };

  const clearAllNotifications = async () => {
    try {
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (error) {
      console.error("❌ Error clearing notifications:", error);
    }
  };

  const requestNotificationPermission = async () => {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  };

  const formatPrice = (price) => {
    if (!price) return "$0.00";
    return `$${parseFloat(price).toFixed(price < 1 ? 6 : 2)}`;
  };

  const getChangeColor = (change) => {
    return change >= 0 ? "#4caf50" : "#f44336";
  };

  const formatConditions = (conditions) => {
    if (typeof conditions === "string") {
      return conditions;
    }

    if (typeof conditions === "object" && conditions !== null) {
      const parts = [];

      if (conditions.minDaily) {
        parts.push(`Min Daily: ${conditions.minDaily}`);
      }

      if (conditions.changePercent) {
        parts.push(
          `Change: ${conditions.changePercent.percentage}% (${conditions.changePercent.timeframe})`
        );
      }

      if (conditions.alertCount) {
        parts.push(`Alert Count: ${conditions.alertCount.timeframe}`);
      }

      if (conditions.candle) {
        parts.push(`Candle: ${conditions.candle.condition}`);
      }

      if (conditions.rsiRange) {
        parts.push(
          `RSI: ${conditions.rsiRange.condition} ${conditions.rsiRange.level}`
        );
      }

      if (conditions.volume) {
        parts.push(`Volume: ${conditions.volume.condition}`);
      }

      if (conditions.ema) {
        parts.push(`EMA: ${conditions.ema.condition}`);
      }

      return parts.join(" • ");
    }

    return "No conditions";
  };

  return (
    <Box sx={{ position: "relative" }}>
      {/* Notification Bell */}
      <IconButton
        onClick={() => {
          setIsExpanded(!isExpanded);
          requestNotificationPermission();
        }}
        sx={{ color: "white" }}
      >
        <Badge badgeContent={unreadCount} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>

      {/* Connection Status - Removed to avoid user confusion */}

      {/* Notifications Panel */}
      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
        <Paper
          sx={{
            position: "absolute",
            top: 50,
            right: 0,
            width: 400,
            maxHeight: 500,
            zIndex: 1000,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#ffffff",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
            border: "1px solid #e0e0e0",
          }}
        >
          {/* Header */}
          <Box
            sx={{
              p: 2,
              borderBottom: 1,
              borderColor: "divider",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="h6" sx={{ color: "#333333", fontWeight: 600 }}>
              Real-Time Alerts ({notifications.length})
            </Typography>
            <Box>
              <IconButton
                size="small"
                onClick={clearAllNotifications}
                disabled={notifications.length === 0}
              >
                <ClearIcon />
              </IconButton>
              <IconButton size="small" onClick={() => setIsExpanded(false)}>
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          {/* Notifications List */}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {notifications.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography sx={{ color: "#666666", fontSize: "0.9rem" }}>
                  No alerts triggered yet
                </Typography>
              </Box>
            ) : (
              <List>
                {notifications.map((notification, index) => (
                  <ListItem
                    key={notification.id || index}
                    sx={{
                      borderBottom: 1,
                      borderColor: "#e0e0e0",
                      backgroundColor: notification.read
                        ? "#ffffff"
                        : "#f8f9fa",
                      "&:hover": {
                        backgroundColor: "#f0f0f0",
                      },
                    }}
                    onClick={() => markAsRead(notification.id)}
                  >
                    <ListItemIcon>
                      <CheckCircleIcon
                        sx={{
                          color: getChangeColor(
                            notification.priceChangePercent
                          ),
                        }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Typography variant="subtitle2" sx={{ color: "#333333", fontWeight: 600 }}>
                            {notification.symbol}
                          </Typography>
                          <Chip
                            label="TRIGGERED"
                            size="small"
                            color="error"
                            sx={{ fontSize: "0.65rem", height: 20 }}
                          />
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5 }}>
                          {/* Target & Actual */}
                          <Typography variant="caption" sx={{ color: "#555555", display: "block", mb: 0.3, fontSize: "0.75rem" }}>
                            Target: {notification.targetValue || "N/A"}% | Actual 24h change: {" "}
                            <span style={{ color: getChangeColor(notification.actualValue || notification.priceChangePercent) }}>
                              {notification.actualValue !== undefined ? notification.actualValue.toFixed(3) : notification.priceChangePercent}%
                            </span>
                            {" "} | {notification.timeframe || "5MIN"}
                            {notification.direction && ` | ${notification.direction}`}
                          </Typography>

                          {/* Price Info */}
                          <Typography variant="caption" sx={{ color: "#555555", display: "block", mb: 0.3, fontSize: "0.75rem" }}>
                            Price: {formatPrice(notification.price)}
                            {" "} | Last Price: {formatPrice(notification.baselinePrice || notification.price)}
                            {notification.changeFromBaselinePercent !== undefined && (
                              <span>
                                {" "} | Change: <span style={{ color: getChangeColor(notification.changeFromBaselinePercent) }}>
                                  {notification.changeFromBaselinePercent.toFixed(3)}%
                                </span>
                              </span>
                            )}
                          </Typography>

                          {/* Volume */}
                          <Typography variant="caption" sx={{ color: "#555555", display: "block", mb: 0.3, fontSize: "0.75rem" }}>
                            24h Volume: {notification.volume ? new Intl.NumberFormat("en-US").format(notification.volume) : "N/A"}
                          </Typography>

                          {/* Time & Date */}
                          <Typography variant="caption" sx={{ color: "#666666", display: "block", fontSize: "0.75rem" }}>
                            {formatTime(notification.triggeredAt)}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Paper>
      </Collapse>
    </Box>
  );
};

export default RealTimeNotifications;
