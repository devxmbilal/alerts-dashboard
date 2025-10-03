"use client";

import React, { useState, useEffect, memo } from "react";
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

// Mock triggered alerts data
const mockTriggeredAlerts = [
  {
    id: 1,
    symbol: "BTCUSDT",
    type: "price",
    condition: "above",
    value: 46000,
    currentPrice: 46500,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
    status: "triggered",
    notificationSent: true,
    notificationType: "both",
  },
  {
    id: 2,
    symbol: "ETHUSDT",
    type: "percentage",
    condition: "above",
    value: 5,
    currentPrice: 3150,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
    status: "triggered",
    notificationSent: true,
    notificationType: "email",
  },
  {
    id: 3,
    symbol: "ADAUSDT",
    type: "rsi",
    condition: "above",
    value: 70,
    currentPrice: 0.48,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    status: "triggered",
    notificationSent: false,
    notificationType: "telegram",
  },
  {
    id: 4,
    symbol: "SOLUSDT",
    type: "volume",
    condition: "above",
    value: 1000000,
    currentPrice: 105,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 45), // 45 minutes ago
    status: "triggered",
    notificationSent: true,
    notificationType: "both",
  },
  {
    id: 5,
    symbol: "DOGEUSDT",
    type: "price",
    condition: "below",
    value: 0.08,
    currentPrice: 0.079,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    status: "triggered",
    notificationSent: true,
    notificationType: "telegram",
  },
  {
    id: 6,
    symbol: "LINKUSDT",
    type: "percentage",
    condition: "above",
    value: 3,
    currentPrice: 15.2,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 90), // 1.5 hours ago
    status: "triggered",
    notificationSent: true,
    notificationType: "both",
  },
  {
    id: 7,
    symbol: "MATICUSDT",
    type: "price",
    condition: "above",
    value: 0.85,
    currentPrice: 0.87,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
    status: "triggered",
    notificationSent: false,
    notificationType: "email",
  },
  {
    id: 8,
    symbol: "AVAXUSDT",
    type: "percentage",
    condition: "below",
    value: -2,
    currentPrice: 28.5,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 150), // 2.5 hours ago
    status: "triggered",
    notificationSent: true,
    notificationType: "telegram",
  },
  {
    id: 9,
    symbol: "DOTUSDT",
    type: "price",
    condition: "above",
    value: 6.5,
    currentPrice: 6.8,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 180), // 3 hours ago
    status: "triggered",
    notificationSent: true,
    notificationType: "both",
  },
  {
    id: 10,
    symbol: "UNIUSDT",
    type: "percentage",
    condition: "above",
    value: 4,
    currentPrice: 7.2,
    triggeredAt: new Date(Date.now() - 1000 * 60 * 210), // 3.5 hours ago
    status: "triggered",
    notificationSent: true,
    notificationType: "email",
  },
];

const TriggeredAlertsPanel = ({ onRefresh, onClearAll }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [alerts, setAlerts] = useState(mockTriggeredAlerts);
  const [loading, setLoading] = useState(false);

  // Load alerts
  const loadAlerts = async () => {
    setLoading(true);
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setAlerts(mockTriggeredAlerts);
    } catch (error) {
      console.error("Error loading alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  // Clear all alerts
  const handleClearAll = () => {
    setAlerts([]);
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
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <EmailIcon sx={{ fontSize: 16 }} />
            <TelegramIcon sx={{ fontSize: 16 }} />
          </Box>
        );
      default:
        return <NotificationsActiveIcon />;
    }
  };

  // Load alerts on mount
  useEffect(() => {
    loadAlerts();
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
                          label={alert.type.toUpperCase()}
                          size="small"
                          sx={{
                            backgroundColor: getAlertTypeColor(alert.type),
                            color: "white",
                            fontSize: "0.65rem",
                            height: 20,
                          }}
                        />
                        <Chip
                          label={alert.condition}
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
                      <Box>
                        <Typography
                          variant="caption"
                          sx={{ color: "#888", display: "block" }}
                        >
                          {alert.type === "percentage" ? "Change" : "Price"}:{" "}
                          {alert.condition} {alert.value}
                          {alert.type === "percentage" ? "%" : ""}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: "white", display: "block" }}
                        >
                          Current: {formatPrice(alert.currentPrice)}
                        </Typography>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mt: 0.5,
                          }}
                        >
                          <Typography variant="caption" sx={{ color: "#888" }}>
                            {formatTimeAgo(alert.triggeredAt)}
                          </Typography>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                            }}
                          >
                            {getNotificationIcon(alert.notificationType)}
                            {alert.notificationSent ? (
                              <CheckCircleIcon
                                sx={{ fontSize: 12, color: "#4caf50" }}
                              />
                            ) : (
                              <ErrorIcon
                                sx={{ fontSize: 12, color: "#f44336" }}
                              />
                            )}
                          </Box>
                        </Box>
                      </Box>
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
            Last Update: {new Date().toLocaleTimeString()}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default memo(TriggeredAlertsPanel);
