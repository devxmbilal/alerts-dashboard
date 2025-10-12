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
  Alert,
  AlertTitle,
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
  const [isConnected, setIsConnected] = useState(true); // Start as connected to avoid initial warning
  const [isExpanded, setIsExpanded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectionError, setConnectionError] = useState(false);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    if (!token) return;

    // Connect to real-time notifications
    connectToNotifications();

    // Load existing notifications
    loadNotifications();

    return () => {
      if (eventSourceRef.current) {
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
      const eventSource = new EventSource(
        `${
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"
        }/api/notifications/stream`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      eventSource.onopen = () => {
        console.log("✅ Connected to notifications stream");
        setIsConnected(true);
        setConnectionError(false);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

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
          if (onAlertTrigger && data.symbol) {
            console.log(
              `🚨 Real-time alert for ${data.symbol}, switching chart...`
            );
            onAlertTrigger({
              symbol: data.symbol,
              price: data.price,
              priceChangePercent: data.priceChangePercent,
              conditions: data.conditions,
              triggeredAt: data.triggeredAt,
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
        }
      };

      eventSource.onerror = (error) => {
        console.error("❌ Notifications stream error:", error);
        setIsConnected(false);
        setConnectionError(true);

        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        // Attempt to reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (eventSource.readyState === EventSource.CLOSED) {
            connectToNotifications();
          }
        }, 5000);
      };

      eventSourceRef.current = eventSource;
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
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const getChangeColor = (change) => {
    return change >= 0 ? "#4caf50" : "#f44336";
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

      {/* Connection Status - Only show after error */}
      {connectionError && !isConnected && (
        <Alert
          severity="warning"
          sx={{
            position: "absolute",
            top: 50,
            right: 0,
            zIndex: 1000,
            minWidth: 200,
            maxWidth: 300,
          }}
        >
          <AlertTitle>Connection Issue</AlertTitle>
          Notifications may be delayed. Reconnecting...
        </Alert>
      )}

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
            <Typography variant="h6">
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
                <Typography color="text.secondary">
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
                      borderColor: "divider",
                      backgroundColor: notification.read
                        ? "transparent"
                        : "#f5f5f5",
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
                          <Typography variant="subtitle2" fontWeight="bold">
                            {notification.symbol}
                          </Typography>
                          <Chip
                            label={`$${notification.price}`}
                            size="small"
                            color={
                              notification.priceChangePercent >= 0
                                ? "success"
                                : "error"
                            }
                          />
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            {notification.conditions}
                          </Typography>
                          <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Change: {notification.priceChangePercent}%
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Vol: {notification.volume?.toLocaleString()}
                            </Typography>
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            {formatTime(notification.triggeredAt)} •{" "}
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
    </Box>
  );
};

export default RealTimeNotifications;
