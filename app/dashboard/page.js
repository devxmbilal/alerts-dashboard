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
  BottomNavigation,
  BottomNavigationAction,
  CircularProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import FilterListIcon from "@mui/icons-material/FilterList";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ListIcon from "@mui/icons-material/List";
import LogoutIcon from "@mui/icons-material/Logout";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import SettingsIcon from "@mui/icons-material/Settings";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import TradingViewChart from "../../components/TradingViewChart";
import MarketPanel from "../../components/MarketPanel";
import FilterSidebar from "../../components/FilterSidebar";
import RealTimeNotifications from "../../components/RealTimeNotifications";
import UserSettingsModal from "../../components/UserSettingsModal";
// import ConditionPanel from "../../components/ConditionPanel"; // Removed per client request
import { SocketProvider } from "../../contexts/SocketContext";
import { AlertProvider } from "../../contexts/AlertContext";
import { FavoritesProvider } from "../../contexts/FavoritesContext";
import { useThemeMode } from "../ThemeProvider";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const router = useRouter();
  const theme = useTheme();
  const { mode, toggleTheme } = useThemeMode();
  const [isMobile, setIsMobile] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Authentication check
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        router.push("/login");
        return;
      }

      // Verify token with server
      const response = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.data);

        // Load user's preferred timeframe from database
        await loadUserPreferredTimeframe(token);

        // Load latest triggered alert after successful auth
        await loadLatestTriggeredAlert(token);
      } else {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        router.push("/login");
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  // Load user's preferred timeframe from database
  const loadUserPreferredTimeframe = async (token) => {
    try {
      const response = await fetch("/api/user/settings", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user?.preferredTimeframe) {
          setSelectedTimeframe(data.user.preferredTimeframe);
          console.log(
            `✅ Loaded preferred timeframe: ${data.user.preferredTimeframe}`
          );
        }
      }
    } catch (error) {
      console.error("Error loading preferred timeframe:", error);
    }
  };

  // Handle timeframe change - save to database
  const handleTimeframeChange = async (newTimeframe) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      setSelectedTimeframe(newTimeframe);

      // Save to database
      const response = await fetch("/api/user/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          preferredTimeframe: newTimeframe,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          console.log(`✅ Timeframe saved to database: ${newTimeframe}`);
          // Update user state
          setUser((prev) => ({
            ...prev,
            preferredTimeframe: newTimeframe,
          }));
        }
      } else {
        console.error("Failed to save timeframe");
      }
    } catch (error) {
      console.error("Error saving timeframe:", error);
    }
  };

  // Load the latest triggered alert and switch chart to that symbol
  const loadLatestTriggeredAlert = async (token) => {
    try {
      setIsLoadingLatestAlert(true);
      console.log("🔍 Loading latest triggered alert...");

      const response = await fetch("/api/alerts/latest-triggered", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.data) {
          const latestAlert = data.data;
          console.log("✅ Latest triggered alert found:", latestAlert);

          // Switch chart to the latest triggered symbol
          setSelectedCoin(latestAlert.symbol);
          setLastTriggeredSymbol(latestAlert.symbol);

          // Show notification about the switch
          setChartSwitchNotification({
            symbol: latestAlert.symbol,
            price: latestAlert.price,
            priceChangePercent: latestAlert.priceChangePercent,
            timestamp: new Date(latestAlert.triggeredAt),
          });

          // Auto-hide notification after 5 seconds
          setTimeout(() => {
            setChartSwitchNotification(null);
          }, 5000);

          console.log(
            `📊 Chart switched to ${latestAlert.symbol} (latest triggered alert)`
          );
        } else {
          console.log("📭 No triggered alerts found, keeping default chart");
        }
      } else {
        console.warn(
          "⚠️ Failed to load latest triggered alert:",
          response.status
        );
      }
    } catch (error) {
      console.error("❌ Error loading latest triggered alert:", error);
    } finally {
      setIsLoadingLatestAlert(false);
    }
  };

  // Use useEffect to set mobile state after hydration
  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < theme.breakpoints.values.md);
    };

    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);

    return () => window.removeEventListener("resize", checkIsMobile);
  }, [theme.breakpoints.values.md]);

  // State management
  const [selectedCoin, setSelectedCoin] = useState("BTCUSDT");
  const [selectedTimeframe, setSelectedTimeframe] = useState("5m"); // Will be loaded from user preferences
  const [lastTriggeredSymbol, setLastTriggeredSymbol] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [chartSwitchNotification, setChartSwitchNotification] = useState(null);
  const [isLoadingLatestAlert, setIsLoadingLatestAlert] = useState(false);

  // Mobile responsive state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileBottomNav, setMobileBottomNav] = useState(0);
  const [currentMobileView, setCurrentMobileView] = useState("chart"); // 'chart', 'filters', 'market'

  // Filter sidebar state
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);

  // User menu state
  const [userMenuAnchor, setUserMenuAnchor] = useState(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

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

  // Handle alert trigger - switch chart to triggered pair
  const handleAlertTrigger = (alertData) => {
    if (alertData && alertData.symbol) {
      console.log(
        `🚨 Alert triggered for ${alertData.symbol}, switching chart...`
      );
      console.log("🔍 Alert trigger data:", alertData);

      setSelectedCoin(alertData.symbol);
      setLastTriggeredSymbol(alertData.symbol);

      // Show notification with proper data
      setChartSwitchNotification({
        symbol: alertData.symbol,
        price: alertData.price || alertData.triggeredPrice,
        priceChangePercent:
          alertData.priceChangePercent || alertData.triggeredChange,
        timestamp: new Date(),
      });

      // Auto-hide notification after 5 seconds
      setTimeout(() => {
        setChartSwitchNotification(null);
      }, 5000);

      // Switch to chart view on mobile
      if (isMobile) {
        setCurrentMobileView("chart");
        setMobileBottomNav(0);
      }

      // Force chart re-render with new symbol
      setSelectedTimeframe((prev) => prev); // Trigger re-render
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

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
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
          backgroundColor: "background.paper",
          color: "text.primary",
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
          startIcon={<FilterListIcon />}
          onClick={() => {
            setFilterSidebarOpen(!filterSidebarOpen);
            setMobileDrawerOpen(false);
          }}
          sx={{ mb: 1 }}
        >
          {filterSidebarOpen ? "Hide Filter Sidebar" : "Show Filter Sidebar"}
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
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                height: "100%",
              }}
            >
              <TradingViewChart
                key={`${selectedCoin}-${selectedTimeframe}`}
                symbol={selectedCoin}
                timeframe={selectedTimeframe}
                onTimeframeChange={handleTimeframeChange}
              />

            </Box>
          );
        case "filters":
          return (
            <Box sx={{ height: "calc(100dvh - 100px)", minHeight: "250px" }}>
              <FilterSidebar
                ref={filterSidebarRef}
                selectedSymbol={selectedCoin}
                onCreateAlert={handleCreateAlert}
                onAlertsCreated={handleAlertsCreated}
                onClose={() => setFilterSidebarOpen(false)}
              />
            </Box>
          );
        case "market":
          return (
            <Box sx={{ height: "calc(100dvh - 100px)", minHeight: "250px" }}>
              <MarketPanel
                ref={marketPanelRef}
                onSelectCoin={handleCoinSelect}
                onCreateAlert={handleCreateAlert}
                onAlertsCreated={handleAlertsCreated}
              />
            </Box>
          );
        default:
          return (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                height: "100%",
              }}
            >
              <TradingViewChart
                key={`${selectedCoin}-${selectedTimeframe}`}
                symbol={selectedCoin}
                timeframe={selectedTimeframe}
                onTimeframeChange={handleTimeframeChange}
              />
            </Box>
          );
      }
    }

    // Desktop layout
    return (
      <Grid container spacing={1} sx={{ height: "100dvh" }}>
        {/* Left Sidebar - Filters (Conditional) */}
        {filterSidebarOpen && (
          <Grid item xs={12} md={3}>
            <Paper
              sx={{
                height: "100dvh",
                maxHeight: "100dvh",
                backgroundColor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <FilterSidebar
                ref={filterSidebarRef}
                selectedSymbol={selectedCoin}
                onCreateAlert={handleCreateAlert}
                onAlertsCreated={handleAlertsCreated}
                onClose={() => setFilterSidebarOpen(false)}
              />
            </Paper>
          </Grid>
        )}

        {/* Main Content Area - Dynamic width based on filter sidebar */}
        <Grid item xs={12} md={filterSidebarOpen ? 6 : 9}>
          <Box
            sx={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            {/* Chart Section - Full Height */}
            <Paper
              sx={{
                flex: 1,
                backgroundColor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                overflow: "hidden",
                minHeight: "200px",
                height: "100%",
              }}
            >
              <TradingViewChart
                key={`${selectedCoin}-${selectedTimeframe}`}
                symbol={selectedCoin}
                timeframe={selectedTimeframe}
                onTimeframeChange={handleTimeframeChange}
              />

            </Paper>
          </Box>
        </Grid>

        {/* Right Sidebar - Market Panel */}
        <Grid item xs={12} md={3}>
          <Paper
            sx={{
              height: "100dvh",
              maxHeight: "100dvh",
              backgroundColor: "background.paper",
              border: 1,
              borderColor: "divider",
              borderRadius: 2,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
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

  // Show loading screen while checking authentication
  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        }}
      >
        <CircularProgress size={60} sx={{ color: "white", mb: 2 }} />
        <Typography variant="h6" sx={{ color: "white" }}>
          Loading Alerts Dashboard...
        </Typography>
      </Box>
    );
  }

  // If not authenticated, will redirect to login
  if (!user) {
    return null;
  }

  return (
    <SocketProvider>
      <AlertProvider>
        <FavoritesProvider>
          <Box
            sx={{
              minHeight: "100vh",
              backgroundColor: "background.default",
              // Slightly increase font sizes only on dashboard
              "& .MuiTypography-root": {
                fontSize: {
                  xs: "1.02rem",
                  sm: "1.04rem",
                  md: "1.06rem",
                },
              },
              "& .MuiTypography-h5": {
                fontSize: {
                  xs: "1.25rem",
                  sm: "1.3rem",
                  md: "1.35rem",
                },
              },
            }}
          >
            {/* Header */}
            <Box
              sx={{
                backgroundColor: "background.paper",
                borderBottom: 1,
                borderColor: "divider",
                p: 0.5,
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
                {!isMobile && (
                  <IconButton
                    color="inherit"
                    onClick={() => setFilterSidebarOpen(!filterSidebarOpen)}
                    sx={{ mr: 2 }}
                    title={
                      filterSidebarOpen
                        ? "Hide Filter Sidebar"
                        : "Show Filter Sidebar"
                    }
                  >
                    <FilterListIcon />
                  </IconButton>
                )}
                <Typography variant="h5" component="h1" sx={{ color: "text.primary" }}>
                  Crypto Alerts Dashboard
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {selectedCoin} - {selectedTimeframe}
                </Typography>

                {/* Theme Toggle Button */}
                <IconButton
                  onClick={toggleTheme}
                  color="inherit"
                  sx={{
                    color: "text.secondary",
                    transition: "all 0.3s ease",
                    "&:hover": {
                      color: "primary.main",
                      transform: "rotate(180deg)",
                    },
                  }}
                  title={mode === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                >
                  {mode === "dark" ? <Brightness7Icon /> : <Brightness4Icon />}
                </IconButton>
                {chartSwitchNotification && (
                  <Box
                    sx={{
                      backgroundColor: "#ff6b35",
                      color: "white",
                      p: 2,
                      borderRadius: 2,
                      fontSize: "0.5rem",
                      fontWeight: 400,
                      textAlign: "center",
                      animation: "pulse 2s infinite",
                      border: "2px solid #ff8c42",
                      boxShadow: "0 0 20px rgba(255, 107, 53, 0.5)",
                      maxWidth: "200px",
                    }}
                  >
                    🚨 Alert triggered and switched to{" "}
                    {chartSwitchNotification.symbol}
                  </Box>
                )}
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Welcome, {user.name}
                </Typography>
                <RealTimeNotifications
                  token={localStorage.getItem("token")}
                  onAlertTrigger={handleAlertTrigger}
                />

                {/* User Icon with Menu */}
                <IconButton
                  color="inherit"
                  onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                  sx={{ color: "text.secondary" }}
                  title="User Menu"
                >
                  <AccountCircleIcon />
                </IconButton>

                {/* User Menu */}
                <Menu
                  anchorEl={userMenuAnchor}
                  open={Boolean(userMenuAnchor)}
                  onClose={() => setUserMenuAnchor(null)}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                  keepMounted
                  marginThreshold={8}
                  PaperProps={{
                    sx: {
                      backgroundColor: "background.paper",
                      color: "text.primary",
                      border: 1,
                      borderColor: "divider",
                      mt: 1,
                      minWidth: 180,
                    },
                    elevation: 8,
                  }}
                >
                  <MenuItem
                    onClick={() => {
                      setUserMenuAnchor(null);
                      setSettingsModalOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <SettingsIcon sx={{ color: "#1976d2" }} />
                    </ListItemIcon>
                    <ListItemText>Settings</ListItemText>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setUserMenuAnchor(null);
                      handleLogout();
                    }}
                  >
                    <ListItemIcon>
                      <LogoutIcon sx={{ color: "#f44336" }} />
                    </ListItemIcon>
                    <ListItemText>Logout</ListItemText>
                  </MenuItem>
                </Menu>

                {/* User Settings Modal */}
                <UserSettingsModal
                  open={settingsModalOpen}
                  onClose={() => setSettingsModalOpen(false)}
                  user={user}
                />
              </Box>
            </Box>

            {/* Main Content */}
            <Box sx={{ p: 0.5 }}>{renderMainContent()}</Box>

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
                  backgroundColor: "background.paper",
                  borderTop: 1,
                  borderColor: "divider",
                  "& .MuiBottomNavigationAction-root": {
                    color: "#888",
                    "&.Mui-selected": {
                      color: "#1976d2",
                    },
                  },
                }}
              >
                <BottomNavigationAction
                  label="Chart"
                  icon={<TrendingUpIcon />}
                />
                <BottomNavigationAction
                  label="Filters"
                  icon={<FilterListIcon />}
                />
                <BottomNavigationAction label="Market" icon={<ListIcon />} />
              </BottomNavigation>
            )}

            {/* Mobile Drawer */}
            {renderMobileDrawer()}
          </Box>
        </FavoritesProvider>
      </AlertProvider>
    </SocketProvider>
  );
}
