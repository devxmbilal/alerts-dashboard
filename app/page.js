"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Grid,
  Paper,
  Typography,
  Button,
  Drawer,
  IconButton,
  useTheme,
  useMediaQuery,
  BottomNavigation,
  BottomNavigationAction,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import FilterListIcon from "@mui/icons-material/FilterList";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ListIcon from "@mui/icons-material/List";
import LineChart from "../components/LineChart";
import MarketPanel from "../components/MarketPanel";
import FilterSidebar from "../components/FilterSidebar";
import TriggeredAlertsPanel from "../components/TriggeredAlertsPanel";

export default function Dashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // State management
  const [selectedCoin, setSelectedCoin] = useState("BTCUSDT");
  const [selectedTimeframe, setSelectedTimeframe] = useState("1h");
  const [lastTriggeredSymbol, setLastTriggeredSymbol] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // Mobile responsive state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileBottomNav, setMobileBottomNav] = useState(0);
  const [currentMobileView, setCurrentMobileView] = useState("chart"); // 'chart', 'filters', 'market'

  // References
  const filterSidebarRef = useRef();
  const marketPanelRef = useRef();

  // Mock data for demonstration
  const mockCryptoData = [
    { symbol: "BTCUSDT", price: 45000, change: 2.5, volume: 1234567890 },
    { symbol: "ETHUSDT", price: 3000, change: -1.2, volume: 987654321 },
    { symbol: "ADAUSDT", price: 0.45, change: 5.8, volume: 456789123 },
    { symbol: "SOLUSDT", price: 100, change: 3.2, volume: 789123456 },
    { symbol: "DOTUSDT", price: 7.5, change: -2.1, volume: 321654987 },
  ];

  const mockAlerts = [
    {
      id: 1,
      symbol: "BTCUSDT",
      type: "price",
      condition: "above",
      value: 46000,
      triggered: true,
      timestamp: new Date(),
    },
    {
      id: 2,
      symbol: "ETHUSDT",
      type: "percentage",
      condition: "above",
      value: 5,
      triggered: false,
      timestamp: new Date(),
    },
  ];

  // Mobile navigation handlers
  const handleMobileNavChange = (event, newValue) => {
    setMobileBottomNav(newValue);
    switch (newValue) {
      case 0:
        setCurrentMobileView("chart");
        break;
      case 1:
        setCurrentMobileView("filters");
        break;
      case 2:
        setCurrentMobileView("market");
        break;
      default:
        setCurrentMobileView("chart");
    }
  };

  const handleCoinSelect = (symbol) => {
    setSelectedCoin(symbol);
    if (isMobile) {
      setCurrentMobileView("chart");
      setMobileBottomNav(0);
    }
  };

  const handleCreateAlert = (alertData) => {
    const newAlert = {
      id: Date.now(),
      ...alertData,
      triggered: false,
      timestamp: new Date(),
    };
    setAlerts((prev) => [...prev, newAlert]);
  };

  const handleAlertsCreated = (alerts) => {
    setAlerts((prev) => [...prev, ...alerts]);
  };

  // Mobile drawer content
  const renderMobileDrawer = () => (
    <Drawer
      anchor="left"
      open={mobileDrawerOpen}
      onClose={() => setMobileDrawerOpen(false)}
      sx={{
        "& .MuiDrawer-paper": {
          width: 280,
          backgroundColor: "#1a1a1a",
          color: "white",
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Navigation
        </Typography>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<TrendingUpIcon />}
          onClick={() => {
            setCurrentMobileView("chart");
            setMobileDrawerOpen(false);
          }}
          sx={{ mb: 1 }}
        >
          Chart View
        </Button>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<FilterListIcon />}
          onClick={() => {
            setCurrentMobileView("filters");
            setMobileDrawerOpen(false);
          }}
          sx={{ mb: 1 }}
        >
          Filters
        </Button>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<ListIcon />}
          onClick={() => {
            setCurrentMobileView("market");
            setMobileDrawerOpen(false);
          }}
          sx={{ mb: 1 }}
        >
          Market Panel
        </Button>
      </Box>
    </Drawer>
  );

  // Main content renderer
  const renderMainContent = () => {
    if (isMobile) {
      switch (currentMobileView) {
        case "chart":
          return (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <LineChart
                symbol={selectedCoin}
                timeframe={selectedTimeframe}
                onTimeframeChange={setSelectedTimeframe}
              />
              <Box sx={{ height: "300px", mt: 1 }}>
                <TriggeredAlertsPanel />
              </Box>
            </Box>
          );
        case "filters":
          return (
            <FilterSidebar
              ref={filterSidebarRef}
              selectedSymbol={selectedCoin}
              onCreateAlert={handleCreateAlert}
              onAlertsCreated={handleAlertsCreated}
            />
          );
        case "market":
          return (
            <MarketPanel
              ref={marketPanelRef}
              onSelectCoin={handleCoinSelect}
              onCreateAlert={handleCreateAlert}
              onAlertsCreated={handleAlertsCreated}
            />
          );
        default:
          return (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <LineChart
                symbol={selectedCoin}
                timeframe={selectedTimeframe}
                onTimeframeChange={setSelectedTimeframe}
              />
              <Box sx={{ height: "300px", mt: 1 }}>
                <TriggeredAlertsPanel />
              </Box>
            </Box>
          );
      }
    }

    // Desktop layout
    return (
      <Grid container spacing={2} sx={{ height: "100vh" }}>
        {/* Left Sidebar - Filters */}
        <Grid item xs={12} md={3}>
          <Paper
            sx={{
              height: "100%",
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <FilterSidebar
              ref={filterSidebarRef}
              selectedSymbol={selectedCoin}
              onCreateAlert={handleCreateAlert}
              onAlertsCreated={handleAlertsCreated}
            />
          </Paper>
        </Grid>

        {/* Main Content Area */}
        <Grid item xs={12} md={6}>
          <Box
            sx={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            {/* Chart Section */}
            <Paper
              sx={{
                flex: 1,
                backgroundColor: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 2,
                overflow: "hidden",
                minHeight: "250px",
                maxHeight: "300px",
              }}
            >
              <LineChart
                symbol={selectedCoin}
                timeframe={selectedTimeframe}
                onTimeframeChange={setSelectedTimeframe}
              />
            </Paper>

            {/* Triggered Alerts History Section */}
            <Paper
              sx={{
                height: "300px",
                backgroundColor: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 2,
                overflow: "hidden",
                mt: 1,
              }}
            >
              <TriggeredAlertsPanel />
            </Paper>
          </Box>
        </Grid>

        {/* Right Sidebar - Market Panel */}
        <Grid item xs={12} md={3}>
          <Paper
            sx={{
              height: "100%",
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <MarketPanel
              ref={marketPanelRef}
              onSelectCoin={handleCoinSelect}
              onCreateAlert={handleCreateAlert}
              onAlertsCreated={handleAlertsCreated}
            />
          </Paper>
        </Grid>
      </Grid>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "#0a0a0a" }}>
      {/* Header */}
      <Box
        sx={{
          backgroundColor: "#1a1a1a",
          borderBottom: "1px solid #333",
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          {isMobile && (
            <IconButton
              color="inherit"
              onClick={() => setMobileDrawerOpen(true)}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h5" component="h1" sx={{ color: "white" }}>
            Crypto Alerts Dashboard
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="body2" sx={{ color: "#888" }}>
            {selectedCoin} - {selectedTimeframe}
          </Typography>
        </Box>
      </Box>

      {/* Main Content */}
      <Box sx={{ p: 2 }}>{renderMainContent()}</Box>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <BottomNavigation
          value={mobileBottomNav}
          onChange={handleMobileNavChange}
          sx={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "#1a1a1a",
            borderTop: "1px solid #333",
            "& .MuiBottomNavigationAction-root": {
              color: "#888",
              "&.Mui-selected": {
                color: "#1976d2",
              },
            },
          }}
        >
          <BottomNavigationAction label="Chart" icon={<TrendingUpIcon />} />
          <BottomNavigationAction label="Filters" icon={<FilterListIcon />} />
          <BottomNavigationAction label="Market" icon={<ListIcon />} />
        </BottomNavigation>
      )}

      {/* Mobile Drawer */}
      {renderMobileDrawer()}
    </Box>
  );
}
