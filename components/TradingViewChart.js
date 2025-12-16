"use client";

import React, { useEffect } from "react";
import { Box, Typography, ButtonGroup, Button, useTheme } from "@mui/material";
import { useThemeMode } from "../app/ThemeProvider";

const TradingViewChart = ({
  symbol = "BTCUSDT",
  timeframe = "5m",
  onTimeframeChange,
}) => {
  const theme = useTheme();
  const { mode } = useThemeMode();
  useEffect(() => {
    // Clear existing chart container
    const container = document.getElementById("tradingview_chart");
    if (container) {
      container.innerHTML = "";
    }

    // Check if TradingView script already loaded
    if (document.getElementById("tradingview-widget-script")) {
      createWidget();
      return;
    }

    // Create TradingView script tag dynamically
    const script = document.createElement("script");
    script.id = "tradingview-widget-script";
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => createWidget();
    document.body.appendChild(script);

    function createWidget() {
      if (typeof TradingView === "undefined") return;

      // Map timeframe to TradingView interval format
      const intervalMap = {
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "1h": "60",
        "4h": "240",
        "1d": "D",
        "1w": "W",
      };

      // Dynamically calculate height to fill available space
      const wrapper = document.getElementById("tradingview_chart_wrapper");
      const dynamicHeight = wrapper?.clientHeight
        ? wrapper.clientHeight
        : Math.max(300, window.innerHeight - 220);

      new TradingView.widget({
        width: "100%",
        height: dynamicHeight,
        symbol: symbol,
        interval: intervalMap[timeframe] || timeframe,
        timezone: "Etc/UTC",
        theme: mode === "dark" ? "dark" : "light",
        style: "1",
        locale: "en",
        toolbar_bg: mode === "dark" ? "#1a1a1a" : "#ffffff",
        enable_publishing: false,
        hide_top_toolbar: false,
        save_image: false,
        container_id: "tradingview_chart",
      });
    }

    // Optional: adjust chart on resize (lightweight recreate)
    const onResize = () => {
      const c = document.getElementById("tradingview_chart");
      if (c) c.innerHTML = "";
      createWidget();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [symbol, timeframe, mode]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "85%",
        minHeight: "400px",
        backgroundColor: "background.paper",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header with Symbol and Timeframe Selector */}
      <Box
        sx={{
          p: 1,
          borderBottom: 1,
          borderColor: "divider",
          backgroundColor: "background.paper",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography
          variant="h6"
          sx={{
            color: "text.primary",
            fontWeight: 600,
            fontSize: "1.1rem",
          }}
        >
          {symbol}
        </Typography>

        {/* Timeframe Selector */}
        {onTimeframeChange && (
          <ButtonGroup
            variant="outlined"
            size="small"
            sx={{
              "& .MuiButton-root": {
                color: "text.primary",
                borderColor: "divider",
                fontSize: "0.7rem",
                py: 0.5,
                px: 1,
                minWidth: "40px",
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
            {[
              { value: "1m", label: "1M" },
              { value: "5m", label: "5M" },
              { value: "15m", label: "15M" },
              { value: "1h", label: "1H" },
              { value: "4h", label: "4H" },
              { value: "1d", label: "1D" },
              { value: "1w", label: "1W" },
            ].map((option) => (
              <Button
                key={option.value}
                onClick={() => onTimeframeChange(option.value)}
                variant={timeframe === option.value ? "contained" : "outlined"}
              >
                {option.label}
              </Button>
            ))}
          </ButtonGroup>
        )}
      </Box>

      {/* Chart Container */}
      <Box
        sx={{
          flex: 1,
          position: "relative",
          minHeight: "300px",
        }}
        id="tradingview_chart_wrapper"
      >
        <div className="tradingview-widget-container w-full">
          <div id="tradingview_chart" />
        </div>
      </Box>
    </Box>
  );
};

export default TradingViewChart;
