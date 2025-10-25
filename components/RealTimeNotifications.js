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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
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
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
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
          console.log("📨 Full notification data:", data);

          if (data.type === "connected") {
            console.log("📡 Notifications stream connected");
            setIsConnected(true);
            return;
          }

          // Map alert history data to notification format
          const mappedAlert = {
            id: data._id || data.id || `realtime_${Date.now()}`,
            symbol: data.symbol,
            targetValue: data.targetValue,
            actualValue: data.actualValue,
            timeframe: data.timeframe || "5MIN",
            direction: data.direction || "increase",
            price: data.price,
            baselinePrice: data.baselinePrice,
            changeFromBaselinePercent: data.changeFromBaselinePercent,
            volume: data.volume,
            priceChangePercent: data.priceChangePercent,
            triggeredAt: data.triggeredAt || new Date().toISOString(),
            read: false,
          };

          // Add new notification
          setNotifications((prev) => {
            const newNotifications = [mappedAlert, ...prev];
            // Keep only last 50 notifications
            return newNotifications.slice(0, 50);
          });

          // Update unread count - increment for new unread notification
          setUnreadCount((prev) => prev + 1);

          // Show visual feedback for new alert
          console.log(`🚨 NEW ALERT ADDED TO HISTORY: ${data.symbol}`);
          console.log(`📊 Alert details:`, mappedAlert);

          // Trigger chart switch if callback provided
          if (onAlertTriggerRef.current && data.symbol) {
            console.log(`🚨 TRIGGERING CHART SWITCH for ${data.symbol}`);
            console.log(
              "🔍 onAlertTrigger callback exists:",
              typeof onAlertTriggerRef.current
            );
            console.log("🔍 Alert data for chart switch:", {
              symbol: data.symbol,
              price: data.price,
              priceChangePercent: data.priceChangePercent,
              conditions: data.conditions,
              triggeredAt: data.triggeredAt,
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
              console.error(
                "❌ Error in onAlertTrigger callback:",
                callbackError
              );
              console.error("❌ Callback error stack:", callbackError.stack);
            }
          } else {
            console.warn("⚠️ Chart switch NOT triggered:", {
              hasCallback: !!onAlertTriggerRef.current,
              hasSymbol: !!data.symbol,
              dataType: data.type,
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
      // Get user from localStorage
      const userStr = localStorage.getItem("user");
      if (!userStr) return;

      const user = JSON.parse(userStr);
      const userId = user._id;

      const response = await fetch(
        `/api/alerts/history?userId=${userId}&limit=150`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const result = await response.json();
        const alertHistory = result.data || [];

        // Map alert history to notification format
        const mappedNotifications = alertHistory.map((alert) => ({
          id: alert._id,
          symbol: alert.symbol,

          targetValue: alert.alertConditions?.changePercent?.percentage,
          actualValue: alert.triggerData?.priceChangePercent,
          timeframe: alert.alertConditions?.changePercent?.timeframe || "5MIN",
          direction:
            alert.alertConditions?.changePercent?.direction || "increase",
          price: alert.triggerData?.price,
          baselinePrice: alert.baselineData?.baselinePrice,
          changeFromBaselinePercent:
            alert.baselineData?.changeFromBaselinePercent,
          volume: alert.triggerData?.volume24h,
          priceChangePercent: alert.triggerData?.priceChangePercent,
          triggeredAt: alert.triggeredAt,
          read: alert.status === "acknowledged",
        }));

        setNotifications(mappedNotifications);
        // Calculate unread count (notifications that are not read)
        const unreadNotifications = mappedNotifications.filter((n) => !n.read);
        setUnreadCount(unreadNotifications.length);
      }
    } catch (error) {
      console.error("❌ Error loading alert history:", error);
    }
  };

  const markAsRead = (id) => {
    setNotifications((prev) => {
      const updatedNotifications = prev.map((notif) =>
        notif.id === id ? { ...notif, read: true } : notif
      );

      // Recalculate unread count
      const unreadCount = updatedNotifications.filter((n) => !n.read).length;
      setUnreadCount(unreadCount);

      return updatedNotifications;
    });
  };

  // Mark all as read when panel is opened
  useEffect(() => {
    if (isExpanded) {
      // Mark all notifications as read
      setNotifications((prev) =>
        prev.map((notif) => ({ ...notif, read: true }))
      );
      setUnreadCount(0);
    }
  }, [isExpanded]);

  const clearAllNotifications = async () => {
    setIsClearing(true);
    try {
      // Get user from localStorage
      const userStr = localStorage.getItem("user");
      if (!userStr) {
        console.error("❌ User not found in localStorage");
        return;
      }

      const user = JSON.parse(userStr);
      const userId = user._id;

      // Call API to delete all alert history
      const response = await fetch("/api/alerts/history", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        console.log("✅ All alert history cleared successfully");
        // Clear from UI
        setNotifications([]);
        setUnreadCount(0);
        setShowClearDialog(false);
      } else {
        const errorData = await response.json();
        console.error("❌ Failed to clear alert history:", errorData.error);
        // Still clear from UI even if API fails
        setNotifications([]);
        setUnreadCount(0);
        setShowClearDialog(false);
      }
    } catch (error) {
      console.error("❌ Error clearing notifications:", error);
      // Still clear from UI even if API fails
      setNotifications([]);
      setUnreadCount(0);
      setShowClearDialog(false);
    } finally {
      setIsClearing(false);
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
        <Badge
          badgeContent={unreadCount > 0 ? unreadCount : null}
          color="error"
          sx={{
            "& .MuiBadge-badge": {
              backgroundColor: "#f44336",
              color: "white",
              fontWeight: "bold",
              fontSize: "0.75rem",
            },
          }}
        >
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
            backgroundColor: "#000000",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
            border: "1px solid #333333",
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
              backgroundColor: "#000000",
            }}
          >
            <Typography variant="h6" sx={{ color: "white", fontWeight: 600 }}>
              Alert History ({notifications.length})
            </Typography>
            <Box sx={{ color: "white" }}>
              <Button
                size="small"
                onClick={() => setShowClearDialog(true)}
                disabled={notifications.length === 0}
                sx={{
                  color: "white",
                  textTransform: "none",
                  fontSize: "0.8rem",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                  "&:disabled": {
                    color: "rgba(255, 255, 255, 0.3)",
                  },
                }}
              >
                Clear All
              </Button>
              <IconButton
                size="small"
                onClick={() => setIsExpanded(false)}
                sx={{
                  color: "white",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          {/* Notifications List */}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {notifications.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography sx={{ color: "white", fontSize: "0.9rem" }}>
                  No alerts triggered yet
                </Typography>
              </Box>
            ) : (
              <List sx={{ p: 1 }}>
                {notifications.map((notification, index) => (
                  <ListItem
                    key={notification.id || index}
                    sx={{
                      borderBottom: 1,
                      borderColor: "#333333",
                      backgroundColor: notification.read
                        ? "#000000"
                        : "#1a1a1a",
                      "&:hover": {
                        backgroundColor: "#2a2a2a",
                      },
                      mb: 1,
                      borderRadius: 1,
                      border: "1px solid #333333",
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
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mb: 1,
                          }}
                        >
                          <Typography
                            variant="subtitle1"
                            sx={{
                              color: "white",
                              fontWeight: 700,
                              fontSize: "1rem",
                            }}
                          >
                            {notification.symbol}
                          </Typography>
                          <Chip
                            label="TRIGGERED"
                            size="small"
                            color="error"
                            sx={{
                              fontSize: "0.65rem",
                              height: 20,
                              fontWeight: 600,
                            }}
                          />
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5, lineHeight: 1.8 }}>
                          {/* Target & Actual */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#cccccc",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Target:</strong>{" "}
                            {notification.targetValue || 1} |{" "}
                            <strong>Actual 24h change:</strong>{" "}
                            <span
                              style={{
                                color: getChangeColor(
                                  notification.actualValue ||
                                    notification.priceChangePercent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {notification.actualValue !== undefined
                                ? notification.actualValue.toFixed(3)
                                : notification.priceChangePercent}
                              %
                            </span>{" "}
                            | <strong>Timeframe:</strong>{" "}
                            {notification.timeframe || "5MIN"} |{" "}
                            <strong>Direction:</strong>{" "}
                            {notification.direction || "increase"}
                          </Typography>

                          {/* Price */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "white",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.85rem",
                              fontWeight: 600,
                            }}
                          >
                            <strong>Price:</strong>{" "}
                            {formatPrice(notification.price)}
                          </Typography>

                          {/* Last Price */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#cccccc",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Last Price:</strong>{" "}
                            {formatPrice(
                              notification.baselinePrice || notification.price
                            )}
                          </Typography>

                          {/* Change in price */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#cccccc",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Change in price:</strong>{" "}
                            <span
                              style={{
                                color: getChangeColor(
                                  notification.changeFromBaselinePercent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {notification.changeFromBaselinePercent !==
                              undefined
                                ? notification.changeFromBaselinePercent.toFixed(
                                    3
                                  )
                                : "N/A"}
                              %
                            </span>
                          </Typography>

                          {/* Volume */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#cccccc",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>24h Volume:</strong>{" "}
                            {notification.volume
                              ? new Intl.NumberFormat("en-US", {
                                  maximumFractionDigits: 1,
                                }).format(notification.volume)
                              : "N/A"}
                          </Typography>

                          {/* Time & Date */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#aaaaaa",
                              display: "block",
                              fontSize: "0.8rem",
                              mt: 0.5,
                            }}
                          >
                            <strong>Time:</strong>{" "}
                            {formatTime(notification.triggeredAt)}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#aaaaaa",
                              display: "block",
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Date:</strong>{" "}
                            {formatDate(notification.triggeredAt)}
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

      {/* Clear Confirmation Dialog */}
      <Dialog
        open={showClearDialog}
        onClose={() => setShowClearDialog(false)}
        PaperProps={{
          sx: {
            backgroundColor: "#1a1a1a",
            color: "white",
            border: "1px solid #333",
          },
        }}
      >
        <DialogTitle sx={{ color: "white", fontWeight: 600 }}>
          Clear All Alert History
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: "#ccc", mb: 2 }}>
            Are you sure you want to delete all alert history? This action
            cannot be undone.
          </Typography>
          <Typography sx={{ color: "#888", fontSize: "0.9rem" }}>
            This will permanently remove {notifications.length} alert(s) from
            the database.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowClearDialog(false)}
            sx={{ color: "#888" }}
            disabled={isClearing}
          >
            Cancel
          </Button>
          <Button
            onClick={clearAllNotifications}
            variant="contained"
            color="error"
            disabled={isClearing}
            sx={{
              backgroundColor: "#f44336",
              "&:hover": {
                backgroundColor: "#d32f2f",
              },
            }}
          >
            {isClearing ? "Clearing..." : "Clear All"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RealTimeNotifications;
