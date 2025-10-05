"use client";

import React, { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  IconButton,
  Alert,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  CardActions,
} from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Notifications as NotificationsIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  AccessTime as AccessTimeIcon,
} from "@mui/icons-material";

const AlertHistory = ({ userId = "default" }) => {
  const [alertHistory, setAlertHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchAlertHistory();
    fetchStats();
  }, [userId]);

  const fetchAlertHistory = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/alerts/history?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        setAlertHistory(data.data.data || data.data);
      } else {
        setError(data.error);
      }
    } catch (error) {
      console.error("Error fetching alert history:", error);
      setError("Failed to fetch alert history");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(
        `/api/alerts/history/stats?userId=${userId}`
      );
      const data = await response.json();

      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const updateAlertStatus = async (historyId, status) => {
    try {
      const response = await fetch("/api/alerts/history", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyId,
          userId,
          status,
        }),
      });

      if (response.ok) {
        // Refresh data
        fetchAlertHistory();
        fetchStats();
      }
    } catch (error) {
      console.error("Error updating alert status:", error);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "triggered":
        return "warning";
      case "acknowledged":
        return "success";
      case "dismissed":
        return "error";
      default:
        return "default";
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "triggered":
        return <NotificationsIcon />;
      case "acknowledged":
        return <CheckCircleIcon />;
      case "dismissed":
        return <CancelIcon />;
      default:
        return null;
    }
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  const formatChange = (change) => {
    const color = change >= 0 ? "success" : "error";
    const icon = change >= 0 ? <TrendingUpIcon /> : <TrendingDownIcon />;
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {icon}
        <Typography color={color} variant="body2">
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </Typography>
      </Box>
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Statistics Cards */}
      {stats && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Total Alerts
                </Typography>
                <Typography variant="h4">
                  {stats.stats?.totalAlerts || 0}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Recent (24h)
                </Typography>
                <Typography variant="h4">
                  {stats.stats?.recentAlerts || 0}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Acknowledged
                </Typography>
                <Typography variant="h4">
                  {stats.stats?.statusBreakdown?.find(
                    (s) => s._id === "acknowledged"
                  )?.count || 0}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Dismissed
                </Typography>
                <Typography variant="h4">
                  {stats.stats?.statusBreakdown?.find(
                    (s) => s._id === "dismissed"
                  )?.count || 0}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Alert History Table */}
      <Paper sx={{ width: "100%", overflow: "hidden" }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="h6" component="div">
            Alert History
          </Typography>
        </Box>

        {alertHistory.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography color="textSecondary">
              No alert history found
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Triggered At</TableCell>
                  <TableCell>Price</TableCell>
                  <TableCell>Change</TableCell>
                  <TableCell>Volume</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {alertHistory.map((alert) => (
                  <TableRow key={alert._id} hover>
                    <TableCell>
                      <Typography variant="subtitle2" fontWeight="bold">
                        {alert.symbol}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                      >
                        <AccessTimeIcon fontSize="small" />
                        <Typography variant="body2">
                          {new Date(
                            alert.triggerData.timestamp
                          ).toLocaleString()}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="bold">
                        {formatPrice(alert.triggerData.price)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {formatChange(alert.triggerData.priceChangePercent)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Intl.NumberFormat("en-US").format(
                          alert.triggerData.volume
                        )}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        icon={getStatusIcon(alert.status)}
                        label={alert.status}
                        color={getStatusColor(alert.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      {alert.status === "triggered" && (
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            startIcon={<CheckCircleIcon />}
                            onClick={() =>
                              updateAlertStatus(alert._id, "acknowledged")
                            }
                          >
                            Acknowledge
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<CancelIcon />}
                            onClick={() =>
                              updateAlertStatus(alert._id, "dismissed")
                            }
                          >
                            Dismiss
                          </Button>
                        </Box>
                      )}
                      {alert.status === "acknowledged" && (
                        <Chip
                          icon={<CheckCircleIcon />}
                          label="Acknowledged"
                          color="success"
                          size="small"
                        />
                      )}
                      {alert.status === "dismissed" && (
                        <Chip
                          icon={<CancelIcon />}
                          label="Dismissed"
                          color="error"
                          size="small"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
};

export default AlertHistory;
