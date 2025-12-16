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
  Clear as ClearIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";

const RealTimeNotifications = ({ token, onAlertTrigger }) => {
  const [alertHistory, setAlertHistory] = useState([]);
  const [isConnected, setIsConnected] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [newAlertCount, setNewAlertCount] = useState(0);
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

    // Load existing alert history
    loadAlertHistory();

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
      console.log("📱 Real-time alert history disabled");
      return;
    }

    try {
      // Close existing connection first
      if (eventSourceRef.current) {
        console.log("🔄 Closing existing EventSource connection");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // FIXED: Use alerts stream instead of notifications stream for real-time alerts
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const userId = user._id || user.id;

      if (!userId) {
        console.error("❌ No user ID found in localStorage");
        return;
      }

      // Use relative URL for production (works with nginx proxy)
      // Only use absolute URL in development
      const baseUrl =
        typeof window !== "undefined" && window.location.origin
          ? window.location.origin
          : process.env.NEXT_PUBLIC_API_URL || "";

      const url = `${baseUrl}/api/alerts/stream?userId=${userId}`;

      console.log("🔌 Connecting to alerts stream:", url);
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        console.log("✅ EventSource connection opened successfully");
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log(
            "📨 Received alert stream update:",
            data.type,
            data.symbol || data.data?.symbol
          );
          console.log("📨 Full alert data:", data);

          if (data.type === "connected") {
            console.log("📡 Alert stream connected");
            setIsConnected(true);
            return;
          }

          // Handle alert_triggered events from Redis
          if (data.type === "alert_triggered") {
            const alertData = data.data || data;
            console.log(`🚨 ALERT TRIGGERED: ${alertData.symbol}`);

            // Map alert data to history format
            const mappedAlert = {
              id:
                alertData.alertId || alertData._id || `realtime_${Date.now()}`,
              symbol: alertData.symbol,
              targetValue:
                alertData.targetValue ||
                alertData.conditions?.changePercent?.percentage,
              actualValue: alertData.actualValue || alertData.triggeredChange,
              timeframe:
                alertData.timeframe ||
                alertData.conditions?.changePercent?.timeframe ||
                "5MIN",
              direction:
                alertData.direction ||
                alertData.conditions?.changePercent?.direction ||
                "increase",
              price: alertData.triggeredPrice || alertData.price,
              baselinePrice: alertData.baselinePrice,
              changeFromBaselinePercent: alertData.changeFromBaselinePercent,
              volume: alertData.triggeredVolume || alertData.volume,
              priceChangePercent:
                alertData.triggeredChange || alertData.priceChangePercent,
              triggeredAt: alertData.triggeredAt || new Date().toISOString(),
              read: false,
            };

            // Add new alert to history
            setAlertHistory((prev) => {
              const newHistory = [mappedAlert, ...prev];
              // Keep only last 50 alerts
              return newHistory.slice(0, 50);
            });

            // Update new alert count for badge
            setNewAlertCount((prev) => prev + 1);

            // Show visual feedback for new alert
            console.log(`🚨 NEW ALERT ADDED TO HISTORY: ${alertData.symbol}`);
            console.log(`📊 Alert details:`, mappedAlert);

            // Trigger chart switch if callback provided
            if (onAlertTriggerRef.current && alertData.symbol) {
              console.log(`🚨 TRIGGERING CHART SWITCH for ${alertData.symbol}`);
              console.log("🔍 Alert data for chart switch:", {
                symbol: alertData.symbol,
                price: alertData.triggeredPrice,
                priceChangePercent: alertData.triggeredChange,
                conditions: alertData.conditions,
                triggeredAt: alertData.triggeredAt,
              });

              try {
                onAlertTriggerRef.current({
                  symbol: alertData.symbol,
                  price: alertData.triggeredPrice,
                  priceChangePercent: alertData.triggeredChange,
                  conditions: alertData.conditions,
                  triggeredAt: alertData.triggeredAt,
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
                hasSymbol: !!alertData.symbol,
                dataType: data.type,
              });
            }

            // Show browser notification if permission granted
            if (Notification.permission === "granted") {
              new Notification(`🚨 Alert Triggered: ${alertData.symbol}`, {
                body: `Price: $${alertData.triggeredPrice} | Change: ${alertData.triggeredChange}%`,
                icon: "/favicon.ico",
              });
            }
          } else if (data.type === "heartbeat") {
            console.log("💓 Alert stream heartbeat");
          }
        } catch (error) {
          console.error("❌ Error parsing alert stream message:", error);
          console.error("❌ Event data:", event.data);
        }
      };

      eventSource.onerror = (error) => {
        console.error("❌ Alert history stream error:", error);
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
      console.error("❌ Error connecting to alert history:", error);
      setIsConnected(false);
    }
  };

  const loadAlertHistory = async () => {
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

        // Map alert history to display format
        const mappedHistory = alertHistory.map((alert) => ({
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

        setAlertHistory(mappedHistory);
        // Reset new alert count when loading existing history
        setNewAlertCount(0);
      }
    } catch (error) {
      console.error("❌ Error loading alert history:", error);
    }
  };

  const markAsRead = (id) => {
    setAlertHistory((prev) => {
      const updatedHistory = prev.map((alert) =>
        alert.id === id ? { ...alert, read: true } : alert
      );

      return updatedHistory;
    });
  };

  // Reset new alert count when panel is opened
  useEffect(() => {
    if (isExpanded) {
      setNewAlertCount(0);
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
        setAlertHistory([]);
        setNewAlertCount(0);
        setShowClearDialog(false);
      } else {
        const errorData = await response.json();
        console.error("❌ Failed to clear alert history:", errorData.error);
        // Still clear from UI even if API fails
        setAlertHistory([]);
        setNewAlertCount(0);
        setShowClearDialog(false);
      }
    } catch (error) {
      console.error("❌ Error clearing alert history:", error);
      // Still clear from UI even if API fails
      setAlertHistory([]);
      setNewAlertCount(0);
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

      return parts.join(" • ");
    }

    return "No conditions";
  };

  return (
    <Box sx={{ position: "relative" }}>
      {/* Alert Notifications Icon */}
      <IconButton
        onClick={() => {
          setIsExpanded(!isExpanded);
          requestNotificationPermission();
        }}
        sx={{ color: "text.primary" }}
      >
        <Badge
          badgeContent={newAlertCount > 0 ? newAlertCount : null}
          color="error"
          sx={{
            "& .MuiBadge-badge": {
              backgroundColor: "#f44336",
              color: "text.primary",
              fontWeight: "bold",
              fontSize: "0.75rem",
            },
          }}
        >
          <NotificationsIcon />
        </Badge>
      </IconButton>

      {/* Connection Status - Removed to avoid user confusion */}

      {/* Alert Notifications Panel */}
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
            backgroundColor: "background.paper",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
            border: 1,
            borderColor: "divider",
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
              backgroundColor: "background.paper",
            }}
          >
            <Typography variant="h6" sx={{ color: "text.primary", fontWeight: 600 }}>
              Alert Notifications ({alertHistory.length})
            </Typography>
            <Box sx={{ color: "text.primary" }}>
              <Button
                size="small"
                onClick={() => setShowClearDialog(true)}
                disabled={alertHistory.length === 0}
                sx={{
                  color: "text.primary",
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
                  color: "text.primary",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          {/* Alert Notifications List */}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {alertHistory.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography sx={{ color: "text.primary", fontSize: "0.9rem" }}>
                  No alerts triggered yet
                </Typography>
              </Box>
            ) : (
              <List sx={{ p: 1 }}>
                {alertHistory.map((alert, index) => (
                  <ListItem
                    key={alert.id || index}
                    sx={{
                      borderBottom: 1,
                      borderColor: "divider",
                      backgroundColor: alert.read ? "background.default" : "background.paper",
                      "&:hover": {
                        backgroundColor: "action.hover",
                      },
                      mb: 1,
                      borderRadius: 1,
                      border: 1,
                      borderColor: "divider",
                    }}
                    onClick={() => markAsRead(alert.id)}
                  >
                    <ListItemIcon>
                      <CheckCircleIcon
                        sx={{
                          color: getChangeColor(alert.priceChangePercent),
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
                              color: "text.primary",
                              fontWeight: 700,
                              fontSize: "1rem",
                            }}
                          >
                            {alert.symbol}
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
                              color: "text.secondary",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Target:</strong> {alert.targetValue || 1} |{" "}
                            <strong>Actual 24h change:</strong>{" "}
                            <span
                              style={{
                                color: getChangeColor(
                                  alert.actualValue || alert.priceChangePercent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {alert.actualValue !== undefined
                                ? alert.actualValue.toFixed(3)
                                : alert.priceChangePercent}
                              %
                            </span>{" "}
                            | <strong>Timeframe:</strong>{" "}
                            {alert.timeframe || "5MIN"} |{" "}
                            <strong>Direction:</strong>{" "}
                            {alert.direction || "increase"}
                          </Typography>

                          {/* Price */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.primary",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.85rem",
                              fontWeight: 600,
                            }}
                          >
                            <strong>Price:</strong> {formatPrice(alert.price)}
                          </Typography>

                          {/* Last Price */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Last Price:</strong>{" "}
                            {formatPrice(alert.baselinePrice || alert.price)}
                          </Typography>

                          {/* Change in price */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Change in price:</strong>{" "}
                            <span
                              style={{
                                color: getChangeColor(
                                  alert.changeFromBaselinePercent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {alert.changeFromBaselinePercent !== undefined
                                ? alert.changeFromBaselinePercent.toFixed(3)
                                : "N/A"}
                              %
                            </span>
                          </Typography>

                          {/* Volume */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              display: "block",
                              mb: 0.5,
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>24h Volume:</strong>{" "}
                            {alert.volume
                              ? new Intl.NumberFormat("en-US", {
                                maximumFractionDigits: 1,
                              }).format(alert.volume)
                              : "N/A"}
                          </Typography>

                          {/* Time & Date */}
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.disabled",
                              display: "block",
                              fontSize: "0.8rem",
                              mt: 0.5,
                            }}
                          >
                            <strong>Time:</strong>{" "}
                            {formatTime(alert.triggeredAt)}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.disabled",
                              display: "block",
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>Date:</strong>{" "}
                            {formatDate(alert.triggeredAt)}
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
            backgroundColor: "background.default",
            color: "text.primary",
            border: "1px solid #333",
          },
        }}
      >
        <DialogTitle sx={{ color: "text.primary", fontWeight: 600 }}>
          Clear All Alert Notifications
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: "text.secondary", mb: 2 }}>
            Are you sure you want to delete all alert notifications? This action
            cannot be undone.
          </Typography>
          <Typography sx={{ color: "text.disabled", fontSize: "0.9rem" }}>
            This will permanently remove {alertHistory.length} alert(s) from the
            database.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowClearDialog(false)}
            sx={{ color: "text.disabled" }}
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
