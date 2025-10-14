"use client";

import React, { useState } from "react";
import {
  Box,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardActions,
} from "@mui/material";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";

const MarketDataPopulator = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handlePopulate = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/market/populate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
        console.log("✅ Market data populated:", data.data);
      } else {
        setError(data.error || "Failed to populate market data");
      }
    } catch (err) {
      setError("Network error: " + err.message);
      console.error("❌ Error populating market data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card sx={{ maxWidth: 500, mx: "auto", mt: 2 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <CloudDownloadIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6" component="h2">
            Market Data Populator
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This will fetch all USDT trading pairs from Binance and populate the
          Redis cache. Use this if you're only seeing a limited number of pairs
          in your dashboard.
        </Typography>

        {result && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <CheckCircleIcon sx={{ mr: 1 }} />
              <Box>
                <Typography variant="body2" fontWeight="bold">
                  Market data populated successfully!
                </Typography>
                <Typography variant="body2">
                  Total pairs: {result.totalPairs} | Success:{" "}
                  {result.successCount} | Errors: {result.errorCount}
                </Typography>
              </Box>
            </Box>
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <ErrorIcon sx={{ mr: 1 }} />
              <Typography variant="body2">{error}</Typography>
            </Box>
          </Alert>
        )}
      </CardContent>

      <CardActions sx={{ justifyContent: "center", pb: 2 }}>
        <Button
          variant="contained"
          onClick={handlePopulate}
          disabled={isLoading}
          startIcon={
            isLoading ? <CircularProgress size={20} /> : <CloudDownloadIcon />
          }
          sx={{ minWidth: 200 }}
        >
          {isLoading ? "Populating..." : "Populate Market Data"}
        </Button>
      </CardActions>
    </Card>
  );
};

export default MarketDataPopulator;
