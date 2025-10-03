"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  ButtonGroup,
  IconButton,
  useTheme,
  useMediaQuery,
  Skeleton,
} from "@mui/material";
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Refresh as RefreshIcon,
  Fullscreen as FullscreenIcon,
  Download as DownloadIcon,
} from "@mui/icons-material";

// Mock data generator
const generateMockData = (symbol, timeframe) => {
  const basePrice =
    symbol === "BTCUSDT"
      ? 45000
      : symbol === "ETHUSDT"
      ? 3000
      : symbol === "ADAUSDT"
      ? 0.45
      : 100;

  const dataPoints =
    timeframe === "1m"
      ? 60
      : timeframe === "5m"
      ? 60
      : timeframe === "15m"
      ? 60
      : timeframe === "1h"
      ? 24
      : timeframe === "4h"
      ? 24
      : 30;

  const data = [];
  let currentPrice = basePrice;

  for (let i = 0; i < dataPoints; i++) {
    const change = (Math.random() - 0.5) * 0.02; // ±1% change
    currentPrice *= 1 + change;

    data.push({
      time: new Date(Date.now() - (dataPoints - i) * 60000).toISOString(),
      price: currentPrice,
      volume: Math.random() * 1000000,
    });
  }

  return data;
};

const LineChart = ({ symbol, timeframe, onTimeframeChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [priceChange, setPriceChange] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [volume, setVolume] = useState(0);

  // Timeframe options
  const timeframeOptions = [
    { value: "1m", label: "1M" },
    { value: "5m", label: "5M" },
    { value: "15m", label: "15M" },
    { value: "1h", label: "1H" },
    { value: "4h", label: "4H" },
    { value: "1d", label: "1D" },
  ];

  // Load data
  const loadData = async () => {
    setLoading(true);
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const newData = generateMockData(symbol, timeframe);
      setData(newData);

      if (newData.length > 0) {
        const latest = newData[newData.length - 1];
        const first = newData[0];
        setCurrentPrice(latest.price);
        setVolume(latest.volume);
        setPriceChange(((latest.price - first.price) / first.price) * 100);
      }
    } catch (error) {
      console.error("Error loading chart data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Load data when symbol or timeframe changes
  useEffect(() => {
    loadData();
  }, [symbol, timeframe]);

  // Chart data for rendering
  const chartData = useMemo(() => {
    if (data.length === 0) return null;

    const minPrice = Math.min(...data.map((d) => d.price));
    const maxPrice = Math.max(...data.map((d) => d.price));
    const priceRange = maxPrice - minPrice;

    return {
      points: data.map((point, index) => ({
        x: (index / (data.length - 1)) * 100,
        y: ((point.price - minPrice) / priceRange) * 100,
        price: point.price,
        time: point.time,
      })),
      minPrice,
      maxPrice,
    };
  }, [data]);

  // Format price
  const formatPrice = (price) => {
    if (price >= 1000) return `$${price.toLocaleString()}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(4)}`;
  };

  // Format volume
  const formatVolume = (vol) => {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toFixed(0);
  };

  // Format percentage
  const formatPercentage = (percent) => {
    const isPositive = percent >= 0;
    return {
      value: `${isPositive ? "+" : ""}${percent.toFixed(2)}%`,
      color: isPositive ? "#4caf50" : "#f44336",
    };
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box sx={{ p: 1.5, borderBottom: "1px solid #333" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1.5,
          }}
        >
          <Box>
            <Typography
              variant="h6"
              sx={{ color: "white", fontWeight: 600, fontSize: "1.1rem" }}
            >
              {symbol}
            </Typography>
            <Typography
              variant="h5"
              sx={{ color: "white", fontWeight: 700, fontSize: "1.3rem" }}
            >
              {formatPrice(currentPrice)}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {priceChange >= 0 ? (
                <TrendingUpIcon sx={{ color: "#4caf50" }} />
              ) : (
                <TrendingDownIcon sx={{ color: "#f44336" }} />
              )}
              <Typography
                variant="body1"
                sx={{
                  color: priceChange >= 0 ? "#4caf50" : "#f44336",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                }}
              >
                {formatPercentage(priceChange).value}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "flex", gap: 1 }}>
            <IconButton
              onClick={loadData}
              disabled={loading}
              sx={{ color: "white" }}
            >
              <RefreshIcon />
            </IconButton>
            <IconButton sx={{ color: "white" }}>
              <FullscreenIcon />
            </IconButton>
            <IconButton sx={{ color: "white" }}>
              <DownloadIcon />
            </IconButton>
          </Box>
        </Box>

        {/* Timeframe Selector */}
        <ButtonGroup
          variant="outlined"
          size="small"
          sx={{
            "& .MuiButton-root": {
              color: "white",
              borderColor: "#444",
              fontSize: "0.7rem",
              py: 0.5,
              px: 1,
              "&:hover": {
                borderColor: "#1976d2",
                backgroundColor: "rgba(25, 118, 210, 0.1)",
              },
              "&.Mui-selected": {
                backgroundColor: "#1976d2",
                color: "white",
                "&:hover": {
                  backgroundColor: "#1565c0",
                },
              },
            },
          }}
        >
          {timeframeOptions.map((option) => (
            <Button
              key={option.value}
              onClick={() => onTimeframeChange?.(option.value)}
              variant={timeframe === option.value ? "contained" : "outlined"}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      </Box>

      {/* Chart Area */}
      <Box sx={{ flex: 1, p: 1.5, position: "relative", minHeight: "200px" }}>
        {loading ? (
          <Skeleton variant="rectangular" height="100%" animation="wave" />
        ) : chartData ? (
          <Box sx={{ height: "100%", position: "relative" }}>
            {/* SVG Chart */}
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: "absolute", top: 0, left: 0 }}
            >
              {/* Grid lines */}
              {[0, 25, 50, 75, 100].map((y) => (
                <line
                  key={y}
                  x1="0"
                  y1={y}
                  x2="100"
                  y2={y}
                  stroke="#333"
                  strokeWidth="0.5"
                />
              ))}
              {[0, 25, 50, 75, 100].map((x) => (
                <line
                  key={x}
                  x1={x}
                  y1="0"
                  x2={x}
                  y2="100"
                  stroke="#333"
                  strokeWidth="0.5"
                />
              ))}

              {/* Price line */}
              <polyline
                points={chartData.points
                  .map((p) => `${p.x},${100 - p.y}`)
                  .join(" ")}
                fill="none"
                stroke="#1976d2"
                strokeWidth="2"
              />

              {/* Price dots */}
              {chartData.points.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={100 - point.y}
                  r="1"
                  fill="#1976d2"
                />
              ))}

              {/* Area under curve */}
              <polygon
                points={`0,100 ${chartData.points
                  .map((p) => `${p.x},${100 - p.y}`)
                  .join(" ")} 100,100`}
                fill="url(#gradient)"
                opacity="0.1"
              />

              {/* Gradient definition */}
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#1976d2" />
                  <stop offset="100%" stopColor="#1976d2" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Price labels */}
            <Box
              sx={{
                position: "absolute",
                top: 0,
                right: 0,
                textAlign: "right",
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: "#888", display: "block" }}
              >
                {formatPrice(chartData.maxPrice)}
              </Typography>
            </Box>
            <Box
              sx={{
                position: "absolute",
                bottom: 0,
                right: 0,
                textAlign: "right",
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: "#888", display: "block" }}
              >
                {formatPrice(chartData.minPrice)}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
            }}
          >
            <Typography>No data available</Typography>
          </Box>
        )}
      </Box>

      {/* Footer Stats */}
      <Box
        sx={{ p: 1.5, borderTop: "1px solid #333", backgroundColor: "#1a1a1a" }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "#888", fontSize: "0.7rem" }}
            >
              Volume 24h
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: "white", fontWeight: 600, fontSize: "0.8rem" }}
            >
              {formatVolume(volume)}
            </Typography>
          </Box>
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "#888", fontSize: "0.7rem" }}
            >
              Timeframe
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: "white", fontWeight: 600, fontSize: "0.8rem" }}
            >
              {timeframeOptions.find((t) => t.value === timeframe)?.label ||
                timeframe}
            </Typography>
          </Box>
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "#888", fontSize: "0.7rem" }}
            >
              Last Update
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: "white", fontWeight: 600, fontSize: "0.8rem" }}
            >
              {new Date().toLocaleTimeString()}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default LineChart;
