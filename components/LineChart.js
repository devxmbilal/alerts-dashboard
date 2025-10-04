"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSocket } from "../contexts/SocketContext";
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

// Mock data generator - CYBERUSDT pattern matching the image
const generateMockData = (symbol, timeframe) => {
  try {
    let basePrice, dataPoints, timeInterval;

    if (symbol === "CYBERUSDT") {
      basePrice = 1.74;
      // Generate data that matches the image pattern
      dataPoints = 30;
      timeInterval = 24 * 60 * 60 * 1000; // 1 day intervals
    } else {
      basePrice =
        symbol === "BTCUSDT"
          ? 45000
          : symbol === "ETHUSDT"
          ? 3000
          : symbol === "ADAUSDT"
          ? 0.45
          : symbol === "MIRAUSDT"
          ? 0.67
          : 100;

      dataPoints =
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
      timeInterval = 60000; // 1 minute intervals
    }

    const data = [];
    let currentPrice = basePrice;

    // Generate CYBERUSDT pattern that matches the image
    if (symbol === "CYBERUSDT") {
      const pricePattern = [
        2.3, 2.25, 2.2, 2.15, 2.1, 2.05, 2.0, 1.95, 1.9, 1.85, 1.8, 1.75, 1.7,
        1.65, 1.6, 1.55, 1.5, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.72, 1.74, 1.73,
        1.74, 1.74, 1.74, 1.74,
      ];

      for (let i = 0; i < dataPoints; i++) {
        const daysAgo = dataPoints - i - 1;
        const date = new Date(Date.now() - daysAgo * timeInterval);

        data.push({
          time: date.toISOString(),
          price: pricePattern[i] || basePrice,
          volume: 7300000 + Math.random() * 1000000, // ~7.3M volume
        });
      }
    } else {
      // Regular pattern for other symbols
      for (let i = 0; i < dataPoints; i++) {
        const change = (Math.random() - 0.5) * 0.02; // ±1% change
        currentPrice *= 1 + change;

        data.push({
          time: new Date(
            Date.now() - (dataPoints - i) * timeInterval
          ).toISOString(),
          price: Number(currentPrice.toFixed(4)),
          volume: Math.random() * 1000000,
        });
      }
    }

    return data;
  } catch (error) {
    console.error("Error generating mock data:", error);
    return [];
  }
};

const LineChart = ({ symbol, timeframe, onTimeframeChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Socket context for real-time data
  const { getSymbolData, isConnected } = useSocket();

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

      if (Array.isArray(newData) && newData.length > 0) {
        setData(newData);

        const latest = newData[newData.length - 1];
        const first = newData[0];

        if (
          latest &&
          first &&
          typeof latest.price === "number" &&
          typeof first.price === "number"
        ) {
          setCurrentPrice(latest.price);
          setVolume(latest.volume || 0);
          setPriceChange(((latest.price - first.price) / first.price) * 100);
        }
      } else {
        console.warn("No valid data received");
        setData([]);
        setCurrentPrice(0);
        setVolume(0);
        setPriceChange(0);
      }
    } catch (error) {
      console.error("Error loading chart data:", error);
      setData([]);
      setCurrentPrice(0);
      setVolume(0);
      setPriceChange(0);
    } finally {
      setLoading(false);
    }
  };

  // Load data when symbol or timeframe changes
  useEffect(() => {
    loadData();
  }, [symbol, timeframe]);

  // Update chart with real-time data
  useEffect(() => {
    const symbolData = getSymbolData(symbol);
    if (symbolData) {
      setCurrentPrice(symbolData.price);
      setVolume(symbolData.volume);
      setPriceChange(symbolData.change);

      // Update chart data with new price point
      const newDataPoint = {
        time: Date.now(),
        price: symbolData.price,
        volume: symbolData.volume,
      };

      setData((prev) => {
        const newData = [...prev, newDataPoint];
        // Keep only last 100 data points for performance
        return newData.slice(-100);
      });
    }
  }, [getSymbolData, symbol]);

  // Chart data for rendering
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return null;

    try {
      const prices = data
        .map((d) => d.price)
        .filter((price) => typeof price === "number" && !isNaN(price));
      if (prices.length === 0) return null;

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice;

      if (priceRange === 0) return null; // Avoid division by zero

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
    } catch (error) {
      console.error("Error processing chart data:", error);
      return null;
    }
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
      <Box sx={{ p: 1, borderBottom: "1px solid #333" }}>
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
              variant="body2"
              sx={{ color: "white", fontSize: "0.8rem", mb: 0.5 }}
            >
              Volume (24h): {formatVolume(volume)}
            </Typography>
          </Box>

          {/* Timeframe Selector moved to right side */}
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
      </Box>

      {/* Chart Area */}
      <Box sx={{ flex: 1, p: 1.5, position: "relative", minHeight: "500px" }}>
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
              {chartData.points && chartData.points.length > 0 && (
                <polyline
                  points={chartData.points
                    .map((p) => `${p.x},${100 - p.y}`)
                    .join(" ")}
                  fill="none"
                  stroke="#1976d2"
                  strokeWidth="2"
                />
              )}

              {/* Price dots */}
              {chartData.points &&
                chartData.points.length > 0 &&
                chartData.points.map((point, index) => (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={100 - point.y}
                    r="1"
                    fill="#1976d2"
                  />
                ))}

              {/* Area under curve */}
              {chartData.points && chartData.points.length > 0 && (
                <polygon
                  points={`0,100 ${chartData.points
                    .map((p) => `${p.x},${100 - p.y}`)
                    .join(" ")} 100,100`}
                  fill="url(#gradient)"
                  opacity="0.1"
                />
              )}

              {/* Gradient definition */}
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#1976d2" />
                  <stop offset="100%" stopColor="#1976d2" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Price levels on Y-axis */}
            <Box
              sx={{
                position: "absolute",
                right: "8px",
                top: "8px",
                bottom: "8px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              {[2.5, 2.3, 2.1, 1.9, 1.7, 1.5, 1.3].map((price) => (
                <Typography
                  key={price}
                  variant="caption"
                  sx={{
                    color: "#888",
                    fontSize: "0.7rem",
                    fontFamily: "monospace",
                  }}
                >
                  {price.toFixed(2)}
                </Typography>
              ))}
            </Box>

            {/* Time labels on X-axis */}
            <Box
              sx={{
                position: "absolute",
                bottom: "8px",
                left: "8px",
                right: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {chartData &&
                chartData.points &&
                chartData.points.length > 0 &&
                [0, 4, 8, 12, 16, 20, 24, 28].map((index) => {
                  if (index >= chartData.points.length) return null;
                  const point = chartData.points[index];
                  const date = new Date(point.time);
                  const day = date.getDate();
                  const month = date.toLocaleDateString("en", {
                    month: "short",
                  });

                  return (
                    <Typography
                      key={index}
                      variant="caption"
                      sx={{
                        color: "#888",
                        fontSize: "0.7rem",
                        fontFamily: "monospace",
                      }}
                    >
                      {day} {month}
                    </Typography>
                  );
                })}
            </Box>

            {/* Current price indicator */}
            {chartData && chartData.points && chartData.points.length > 0 && (
              <Box
                sx={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  backgroundColor: "#1976d2",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "2px",
                  fontSize: "0.7rem",
                  fontFamily: "monospace",
                  fontWeight: "bold",
                }}
              >
                {chartData.points[chartData.points.length - 1].price.toFixed(2)}
              </Box>
            )}

            {/* TradingView logo placeholder */}
            <Box
              sx={{
                position: "absolute",
                bottom: "8px",
                left: "8px",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: "bold",
                fontFamily: "monospace",
              }}
            >
              TV
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
              flexDirection: "column",
              gap: 1,
            }}
          >
            <Typography variant="h6" sx={{ color: "#888" }}>
              No data available
            </Typography>
            <Typography variant="body2" sx={{ color: "#666" }}>
              Loading chart data...
            </Typography>
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
          {/* Alert Information */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  backgroundColor: "#f44336",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography
                  sx={{ color: "white", fontSize: "8px", fontWeight: "bold" }}
                >
                  !
                </Typography>
              </Box>
              <Typography
                variant="body2"
                sx={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}
              >
                Alert Triggered - CYBERUSDT
              </Typography>
            </Box>
            <Box sx={{ ml: 1 }}>
              <Typography
                variant="caption"
                sx={{ color: "#888", fontSize: "0.8rem", display: "block" }}
              >
                Target: 1 | Actual: 1.5160349854227417 | Timeframe: 5MIN
              </Typography>
            </Box>
          </Box>

          {/* Market Data */}
          <Box sx={{ display: "flex", gap: 4 }}>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "#888", fontSize: "0.8rem" }}
              >
                Last Price
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}
              >
                $1.741
              </Typography>
            </Box>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "#888", fontSize: "0.8rem" }}
              >
                Time
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}
              >
                01:42:41
              </Typography>
            </Box>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "#888", fontSize: "0.8rem" }}
              >
                Date
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}
              >
                Oct 04, 2025
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default LineChart;
