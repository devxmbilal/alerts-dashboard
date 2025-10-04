"use client";

import React, { useEffect } from "react";
import { Box, Typography } from "@mui/material";

const TradingViewChart = ({ symbol = "BTCUSDT", timeframe = "1h" }) => {
  useEffect(() => {
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
        "1d": "D"
      };

      new TradingView.widget({
        width: "100%",
        height: 610,
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
  }, [symbol, timeframe]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
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
          minHeight: "400px",
        }}
      >
        <div className="tradingview-widget-container w-full">
          <div id="tradingview_chart" />
        </div>
      </Box>
    </Box>
  );
};

export default TradingViewChart;
