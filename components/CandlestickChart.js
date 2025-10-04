"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createChart } from "lightweight-charts";
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

// Mock candlestick data generator for testing
const generateMockCandlestickData = (symbol, timeframe) => {
  const data = [];
  const now = Date.now();
  let basePrice = symbol === "BTCUSDT" ? 45000 : symbol === "ETHUSDT" ? 3000 : 100;
  
  // Generate 100 candles
  const candleCount = 100;
  const intervalMs = getIntervalMs(timeframe);
  
  for (let i = 0; i < candleCount; i++) {
    const time = now - (candleCount - i) * intervalMs;
    const open = basePrice + (Math.random() - 0.5) * basePrice * 0.02;
    const close = open + (Math.random() - 0.5) * basePrice * 0.03;
    const high = Math.max(open, close) + Math.random() * basePrice * 0.01;
    const low = Math.min(open, close) - Math.random() * basePrice * 0.01;
    const volume = Math.random() * 1000000;
    
    data.push({
      time: Math.floor(time / 1000), // Convert to seconds
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Number(volume.toFixed(0)),
    });
    
    basePrice = close; // Use close price as base for next candle
  }
  
  return data;
};

const getIntervalMs = (timeframe) => {
  switch (timeframe) {
    case "1m": return 60 * 1000;
    case "5m": return 5 * 60 * 1000;
    case "15m": return 15 * 60 * 1000;
    case "1h": return 60 * 60 * 1000;
    case "4h": return 4 * 60 * 60 * 1000;
    case "1d": return 24 * 60 * 60 * 1000;
    default: return 60 * 1000;
  }
};

const CandlestickChart = ({ symbol, timeframe, onTimeframeChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  
  // Socket context for real-time data
  const { getSymbolData, isConnected } = useSocket();
  
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [priceChange, setPriceChange] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [volume, setVolume] = useState(0);
  const [isClient, setIsClient] = useState(false);
  
  // Chart references
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  
  // Timeframe options
  const timeframeOptions = [
    { value: "1m", label: "1M" },
    { value: "5m", label: "5M" },
    { value: "15m", label: "15M" },
    { value: "1h", label: "1H" },
    { value: "4h", label: "4H" },
    { value: "1d", label: "1D" },
  ];
  
  // Set client-side flag
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize chart
  useEffect(() => {
    if (!isClient || !chartContainerRef.current) return;
    
    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: "#1a1a1a" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#2a2a2a" },
        horzLines: { color: "#2a2a2a" },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "#2a2a2a",
      },
      timeScale: {
        borderColor: "#2a2a2a",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    
    // Create candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#4caf50",
      downColor: "#f44336",
      borderDownColor: "#f44336",
      borderUpColor: "#4caf50",
      wickDownColor: "#f44336",
      wickUpColor: "#4caf50",
    });
    
    // Create volume series
    const volumeSeries = chart.addHistogramSeries({
      color: "#26a69a",
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "volume",
    });
    
    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    
    // Configure volume scale
    chart.priceScale("volume").applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    
    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    
    window.addEventListener("resize", handleResize);
    
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [isClient]);
  
  // Load data from real API
  const loadData = async () => {
    setLoading(true);
    try {
      console.log(`📊 Loading candlestick data for ${symbol} ${timeframe}`);
      
      // Fetch real candlestick data from our API
      const response = await fetch(
        `/api/market/klines?symbol=${symbol}&timeframe=${timeframe}&limit=100`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        const newData = result.data;
        setData(newData);
        
        // Update chart
        if (candlestickSeriesRef.current) {
          candlestickSeriesRef.current.setData(newData);
        }
        
        if (volumeSeriesRef.current) {
          const volumeData = newData.map(candle => ({
            time: candle.time,
            value: candle.volume,
            color: candle.close >= candle.open ? "#4caf50" : "#f44336",
          }));
          volumeSeriesRef.current.setData(volumeData);
        }
        
        // Fit content to show all data
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
        
        const latest = newData[newData.length - 1];
        const first = newData[0];
        
        if (latest && first) {
          setCurrentPrice(latest.close);
          setVolume(latest.volume || 0);
          setPriceChange(((latest.close - first.open) / first.open) * 100);
        }
        
        console.log(`✅ Loaded ${newData.length} candles for ${symbol}`);
      } else {
        console.warn("No valid data received from API, using mock data");
        // Fallback to mock data if API fails
        const mockData = generateMockCandlestickData(symbol, timeframe);
        setData(mockData);
        
        if (candlestickSeriesRef.current) {
          candlestickSeriesRef.current.setData(mockData);
        }
        
        if (volumeSeriesRef.current) {
          const volumeData = mockData.map(candle => ({
            time: candle.time,
            value: candle.volume,
            color: candle.close >= candle.open ? "#4caf50" : "#f44336",
          }));
          volumeSeriesRef.current.setData(volumeData);
        }
        
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
        
        const latest = mockData[mockData.length - 1];
        const first = mockData[0];
        
        if (latest && first) {
          setCurrentPrice(latest.close);
          setVolume(latest.volume || 0);
          setPriceChange(((latest.close - first.open) / first.open) * 100);
        }
      }
    } catch (error) {
      console.error("Error loading chart data:", error);
      console.log("Falling back to mock data");
      
      // Fallback to mock data on error
      const mockData = generateMockCandlestickData(symbol, timeframe);
      setData(mockData);
      
      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData(mockData);
      }
      
      if (volumeSeriesRef.current) {
        const volumeData = mockData.map(candle => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? "#4caf50" : "#f44336",
        }));
        volumeSeriesRef.current.setData(volumeData);
      }
      
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
      
      const latest = mockData[mockData.length - 1];
      const first = mockData[0];
      
      if (latest && first) {
        setCurrentPrice(latest.close);
        setVolume(latest.volume || 0);
        setPriceChange(((latest.close - first.open) / first.open) * 100);
      }
    } finally {
      setLoading(false);
    }
  };
  
  // Load data when symbol or timeframe changes
  useEffect(() => {
    if (isClient) {
      loadData();
    }
  }, [symbol, timeframe, isClient]);
  
  // Update chart with real-time data
  useEffect(() => {
    if (!isClient) return;
    
    const symbolData = getSymbolData(symbol);
    if (symbolData && candlestickSeriesRef.current) {
      setCurrentPrice(symbolData.price);
      setVolume(symbolData.volume);
      setPriceChange(symbolData.change);
      
      // Create a new candle from real-time data
      const now = Math.floor(Date.now() / 1000);
      const newCandle = {
        time: now,
        open: symbolData.price,
        high: symbolData.price,
        low: symbolData.price,
        close: symbolData.price,
        volume: symbolData.volume,
      };
      
      // Update the last candle or add new one
      setData((prev) => {
        const newData = [...prev];
        const lastCandle = newData[newData.length - 1];
        
        if (lastCandle && lastCandle.time === now) {
          // Update existing candle
          newData[newData.length - 1] = {
            ...lastCandle,
            high: Math.max(lastCandle.high, symbolData.price),
            low: Math.min(lastCandle.low, symbolData.price),
            close: symbolData.price,
            volume: symbolData.volume,
          };
        } else {
          // Add new candle
          newData.push(newCandle);
          // Keep only last 100 candles
          if (newData.length > 100) {
            newData.shift();
          }
        }
        
        // Update chart
        candlestickSeriesRef.current.setData(newData);
        
        if (volumeSeriesRef.current) {
          const volumeData = newData.map(candle => ({
            time: candle.time,
            value: candle.volume,
            color: candle.close >= candle.open ? "#4caf50" : "#f44336",
          }));
          volumeSeriesRef.current.setData(volumeData);
        }
        
        return newData;
      });
    }
  }, [getSymbolData, symbol, isClient]);
  
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
      </Box>
      
      {/* Chart Area */}
      <Box sx={{ flex: 1, p: 1.5, position: "relative", minHeight: "400px" }}>
        {!isClient || loading ? (
          <Skeleton variant="rectangular" height="100%" animation="wave" />
        ) : (
          <Box sx={{ height: "100%", position: "relative" }}>
            <div
              ref={chartContainerRef}
              style={{
                width: "100%",
                height: "100%",
                minHeight: "400px",
              }}
            />
            
            {/* Connection Status */}
            <Box
              sx={{
                position: "absolute",
                top: "8px",
                left: "8px",
                display: "flex",
                alignItems: "center",
                gap: 1,
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                padding: "4px 8px",
                borderRadius: "4px",
              }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: isConnected ? "#4caf50" : "#f44336",
                }}
              />
              <Typography
                variant="caption"
                sx={{ color: "white", fontSize: "0.7rem" }}
              >
                {isConnected ? "Live" : "Offline"}
              </Typography>
            </Box>
            
            {/* Current Price */}
            {currentPrice > 0 && (
              <Box
                sx={{
                  position: "absolute",
                  top: "8px",
                  right: "8px",
                  backgroundColor: "rgba(0, 0, 0, 0.7)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  fontFamily: "monospace",
                  fontWeight: "bold",
                }}
              >
                {formatPrice(currentPrice)}
                <Box
                  sx={{
                    color: formatPercentage(priceChange).color,
                    fontSize: "0.7rem",
                    ml: 0.5,
                  }}
                >
                  {formatPercentage(priceChange).value}
                </Box>
              </Box>
            )}
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
                {formatPrice(currentPrice)}
              </Typography>
            </Box>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "#888", fontSize: "0.8rem" }}
              >
                Change
              </Typography>
              <Typography
                variant="body2"
                sx={{ 
                  color: formatPercentage(priceChange).color, 
                  fontWeight: 600, 
                  fontSize: "0.9rem" 
                }}
              >
                {formatPercentage(priceChange).value}
              </Typography>
            </Box>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "#888", fontSize: "0.8rem" }}
              >
                Volume
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}
              >
                {formatVolume(volume)}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default CandlestickChart;
