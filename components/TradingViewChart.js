"use client";

import React, { useEffect } from "react";
import { Box, Typography } from "@mui/material";

const TradingViewChart = ({ symbol = "BTCUSDT", timeframe = "5m" }) => {
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
        theme: "dark",
        style: "1",
        locale: "en",
        toolbar_bg: "#1a1a1a",
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
  }, [symbol, timeframe]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "85%",
        minHeight: "400px",
        backgroundColor: "#1a1a1a",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header - Only show symbol */}
      <Box
        sx={{
          p: 1,
          borderBottom: "1px solid #333",
          backgroundColor: "#1a1a1a",
        }}
      >
        <Typography
          variant="h6"
          sx={{
            color: "white",
            fontWeight: 600,
            fontSize: "1.1rem",
          }}
        >
          {symbol}
        </Typography>
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
