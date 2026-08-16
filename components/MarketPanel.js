"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  memo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useSocket } from "../contexts/SocketContext";
import { useAlert } from "../contexts/AlertContext";
import { useFavorites } from "../contexts/FavoritesContext";
import {
  Box,
  Paper,
  Typography,
  InputBase,
  ToggleButtonGroup,
  ToggleButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Chip,
  IconButton,
  alpha,
  Skeleton,
  Checkbox,
  FormControlLabel,
  Button,
  CircularProgress,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import CurrencyExchangeIcon from "@mui/icons-material/CurrencyExchange";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Tooltip from "@mui/material/Tooltip";

const MarketPanel = forwardRef(
  ({ onSelectCoin, onCreateAlert, onAlertsCreated }, ref) => {
    const theme = useTheme();
    const [isMobile, setIsMobile] = useState(false);
    const [isTablet, setIsTablet] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Use useEffect to set responsive states after hydration
    useEffect(() => {
      setMounted(true);
      const checkResponsive = () => {
        setIsMobile(window.innerWidth < theme.breakpoints.values.md);
        setIsTablet(window.innerWidth < theme.breakpoints.values.lg);
      };

      checkResponsive();
      window.addEventListener("resize", checkResponsive);

      return () => window.removeEventListener("resize", checkResponsive);
    }, [theme.breakpoints.values.md, theme.breakpoints.values.lg]);

    // Socket context for real-time data
    const {
      marketData,
      isConnected,
      subscribeToSymbols,
      fetchAllPairs,
      toggleFavorite: socketToggleFavorite,
      getFilteredMarketData,
    } = useSocket();

    const { removeAlert } = useAlert();
    const {
      favorites: userFavorites,
      favoriteCount,
      isFavorite,
      toggleFavorite: contextToggleFavorite,
      bulkUpdateFavorites,
      clearAllFavorites,
    } = useFavorites();

    // Debug market data (only log significant changes)
    useEffect(() => {
      if (marketData.length > 0) {
        console.log(`📊 MarketPanel loaded with ${marketData.length} pairs`);
      }
    }, [marketData.length > 400]); // Only log when we have substantial data

    // State management
    const [view, setView] = useState("market");
    const [searchTerm, setSearchTerm] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectAllChecked, setSelectAllChecked] = useState(false);
    const [checkedPairs, setCheckedPairs] = useState(new Set());
    const [meetingConditions, setMeetingConditions] = useState({});
    const [isCheckingConditions, setIsCheckingConditions] = useState(false);

    // Search timeout ref
    const searchTimeoutRef = useRef(null);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      refreshData: () => {
        setLoading(true);
        // Subscribe to all available symbols
        subscribeToSymbols([]);
        setTimeout(() => {
          setLoading(false);
        }, 1000);
      },
      getSelectedCoins: () => Array.from(checkedPairs),
    }));

    // Subscribe to market data on mount
    useEffect(() => {
      subscribeToSymbols([]); // Subscribe to all symbols
    }, []); // Empty dependency array to run only once

    // Handle search with debounce - exact same as client
    const handleSearchChange = useCallback((event) => {
      const value = event.target.value;
      setSearchInput(value);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(() => {
        setSearchTerm(value);
      }, 300);
    }, []);

    // State for UI
    const [favoritesLoading, setFavoritesLoading] = useState(false);
    const [bulkOperationLoading, setBulkOperationLoading] = useState(false);

    // Toggle favorite using context
    const toggleFavorite = useCallback(
      async (symbol) => {
        try {
          const success = await contextToggleFavorite(symbol);
          if (success) {
            // Also update socket context for real-time updates
            socketToggleFavorite(symbol);

            // If unfavoriting, remove any existing alerts for this symbol
            if (isFavorite(symbol)) {
              removeAlert(symbol);
            }
          }
        } catch (error) {
          console.error("Error toggling favorite:", error);
        }
      },
      [contextToggleFavorite, socketToggleFavorite, removeAlert, isFavorite]
    );

    // Get favorite symbols (using context)
    const getFavoriteSymbols = useCallback(() => {
      return Array.from(userFavorites);
    }, [userFavorites]);

    // Toggle pair selection
    const togglePairSelection = useCallback((symbol) => {
      setCheckedPairs((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(symbol)) {
          newSet.delete(symbol);
        } else {
          newSet.add(symbol);
        }
        return newSet;
      });
    }, []);

    // Check if pair is selected
    const isPairSelected = useCallback(
      (symbol) => {
        return checkedPairs.has(symbol);
      },
      [checkedPairs]
    );

    // Filter and sort data using socket context
    const filteredData = useMemo(() => {
      let data = getFilteredMarketData({
        search: searchTerm,
        favorites: false, // We'll handle favorites filtering manually
        sortBy: "symbol",
      });

      // If favorites view is selected, filter by user's favorites from MongoDB
      if (view === "favorites") {
        data = data.filter((coin) => userFavorites.has(coin.symbol));
      }

      return data;
    }, [
      getFilteredMarketData,
      searchTerm,
      view,
      marketData.length,
      userFavorites,
    ]);

    // Select all pairs
    const handleSelectAll = useCallback(() => {
      if (selectAllChecked) {
        setCheckedPairs(new Set());
        setSelectAllChecked(false);
      } else {
        const allSymbols = filteredData.map((coin) => coin.symbol);
        setCheckedPairs(new Set(allSymbols));
        setSelectAllChecked(true);
      }
    }, [selectAllChecked, filteredData]);

    // Add every visible pair to favorites. This used to toggle (add all when
    // none were favorited, remove all when they were), but the single toggle
    // button was replaced by a separate + and bin, so each one now does exactly
    // what its icon says — removal lives in handleClearAllFavorites.
    const handleAddAllFavorites = useCallback(async () => {
      try {
        setBulkOperationLoading(true);

        const symbolsToProcess = filteredData
          .filter((coin) => !isFavorite(coin.symbol))
          .map((coin) => coin.symbol);

        if (symbolsToProcess.length === 0) {
          return;
        }

        // Use context bulk update function
        await bulkUpdateFavorites(symbolsToProcess, "add");
      } catch (error) {
        console.error("Error adding all favorites:", error);
      } finally {
        setBulkOperationLoading(false);
      }
    }, [filteredData, isFavorite, bulkUpdateFavorites]);

    // Clear ALL favorites handler
    const handleClearAllFavorites = useCallback(async () => {
      try {
        setBulkOperationLoading(true);
        console.log("🧹 Clearing ALL favorites...");

        const success = await clearAllFavorites();
        if (success) {
          console.log("✅ All favorites cleared successfully");
        } else {
          console.error("❌ Failed to clear all favorites");
        }
      } catch (error) {
        console.error("Error clearing all favorites:", error);
      } finally {
        setBulkOperationLoading(false);
      }
    }, [clearAllFavorites]);

    // Check if all visible pairs are favorited (for button text)
    const allFavorited = useMemo(() => {
      return (
        filteredData.length > 0 &&
        filteredData.every((coin) => isFavorite(coin.symbol))
      );
    }, [filteredData, isFavorite]);

    // Update select all checkbox
    useEffect(() => {
      if (filteredData.length === 0) {
        setSelectAllChecked(false);
      } else {
        const allSelected = filteredData.every((coin) =>
          checkedPairs.has(coin.symbol)
        );
        setSelectAllChecked(allSelected);
      }
    }, [filteredData, checkedPairs]);

    // Handle coin click
    const handleCoinClick = useCallback(
      (coin) => {
        onSelectCoin?.(coin.symbol);
      },
      [onSelectCoin]
    );

    // Handle create alert for selected pairs
    const handleCreateAlert = useCallback(() => {
      if (checkedPairs.size === 0) return;

      const alerts = Array.from(checkedPairs).map((symbol) => ({
        symbol,
        type: "price",
        condition: "above",
        value: 0,
        timeframe: "1h",
      }));

      onCreateAlert?.(alerts);
      setCheckedPairs(new Set());
    }, [checkedPairs, onCreateAlert]);

    // Format price change - exact same as client
    const formatPriceChange = (change) => {
      // Handle undefined, null, or NaN values
      if (change === undefined || change === null || isNaN(change)) {
        return {
          value: "0.00%",
          color: "#888",
          icon: null,
        };
      }

      const numChange = parseFloat(change) || 0;
      const isPositive = numChange >= 0;
      return {
        value: `${isPositive ? "+" : ""}${numChange.toFixed(2)}%`,
        color: isPositive ? "#4caf50" : "#f44336",
        icon: isPositive ? <TrendingUpIcon /> : <TrendingDownIcon />,
      };
    };

    // Format volume - exact same as client
    const formatVolume = (volume) => {
      if (!volume || volume === undefined || volume === null) return "0";
      if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`;
      if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`;
      if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`;
      return volume.toFixed(0);
    };

    // Format price - exact same as client
    const formatPrice = (price) => {
      if (price >= 1000) return `$${price.toLocaleString()}`;
      if (price >= 1) return `$${price.toFixed(2)}`;
      return `$${price.toFixed(4)}`;
    };

    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header - exact same as client */}
        <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography
            variant="h6"
            sx={{ color: "text.primary", mb: 1, fontWeight: 600 }}
          >
            Market Panel
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", mb: 2, fontSize: "0.8rem" }}
          >
            USDT Pairs• {filteredData.length} pairs • Favorites•{" "}
            {userFavorites.size} coins
          </Typography>

          {/* View Toggle + favourite bulk actions, on one row */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mb: 2,
            }}
          >
          <ToggleButtonGroup
            value={view}
            onChange={(e, value) => value && setView(value)}
            exclusive
            size="small"
            sx={{
              "& .MuiToggleButton-root": {
                color: "text.primary",
                borderColor: "divider",
                fontSize: "0.75rem",
                px: 2,
                py: 0.5,
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                },
                "&.Mui-selected": {
                  backgroundColor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": {
                    backgroundColor: "#1565c0",
                  },
                },
              },
            }}
          >
            <ToggleButton value="market">Market</ToggleButton>
            <ToggleButton value="favorites">Favorites</ToggleButton>
          </ToggleButtonGroup>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Tooltip title="Add all to favorites">
                <span>
                  <IconButton
                    onClick={handleAddAllFavorites}
                    disabled={bulkOperationLoading || allFavorited}
                    sx={{
                      color: "#1976d2",
                      border: "1px solid",
                      borderColor: "#1976d2",
                      borderRadius: 1,
                      p: 0.75,
                      "&:hover": {
                        backgroundColor: "rgba(25, 118, 210, 0.12)",
                        borderColor: "#1565c0",
                      },
                      "&:disabled": { color: "#666", borderColor: "#444" },
                    }}
                  >
                    {bulkOperationLoading ? (
                      <CircularProgress size={24} />
                    ) : (
                      <AddIcon sx={{ fontSize: 24 }} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Remove all favorites">
                <span>
                  <IconButton
                    onClick={handleClearAllFavorites}
                    disabled={bulkOperationLoading || favoriteCount === 0}
                    sx={{
                      color: "#f44336",
                      border: "1px solid",
                      borderColor: "#f44336",
                      borderRadius: 1,
                      p: 0.75,
                      "&:hover": {
                        backgroundColor: "rgba(244, 67, 54, 0.12)",
                        borderColor: "#d32f2f",
                      },
                      "&:disabled": { color: "#666", borderColor: "#444" },
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 24 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>

          {/* Search - exact same as client */}
          <Box sx={{ position: "relative", mb: 2 }}>
            <InputBase
              placeholder="Search coins..."
              value={searchInput}
              onChange={handleSearchChange}
              sx={{
                width: "100%",
                backgroundColor: theme.palette.mode === "dark" ? "#2a2a2a" : "#f0f0f0",
                borderRadius: 1,
                px: 2,
                py: 1,
                color: "text.primary",
                fontSize: "0.875rem",
                "& input": {
                  color: "text.primary",
                  "&::placeholder": {
                    color: "text.secondary",
                  },
                },
              }}
              startAdornment={
                <SearchIcon sx={{ color: "text.secondary", mr: 1, fontSize: 20 }} />
              }
            />
          </Box>

          {/* Bulk actions. Add/remove-all favourites moved up next to the
              Market/Favorites toggle as a + and a bin, so this row only carries
              the Create Alert button and stays out of the layout without it. */}
          {checkedPairs.size > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <Button
                size="small"
                variant="contained"
                onClick={handleCreateAlert}
                startIcon={<NotificationsActiveIcon />}
                sx={{ fontSize: "0.75rem", ml: "auto" }}
              >
                Create Alert ({checkedPairs.size})
              </Button>
            </Box>
          )}
        </Box>

        {/* Coin List with fixed height and scrollbar */}
        <Box
          className="market-panel-scrollbar"
          sx={{
            flex: 1,
            height: "calc(100vh - 80px)", // Ultra reduced height
            minHeight: "150px", // Ultra reduced minimum height
            overflow: "auto",
          }}
        >
          {loading ? (
            // Loading skeleton - exact same as client
            Array.from({ length: 10 }).map((_, index) => (
              <Box key={index} sx={{ p: 2, borderBottom: "1px solid #333" }}>
                <Skeleton variant="text" width="60%" height={20} />
                <Skeleton variant="text" width="40%" height={16} />
              </Box>
            ))
          ) : filteredData.length === 0 ? (
            // Empty state
            <Box
              sx={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 2,
                p: 3,
              }}
            >
              <CurrencyExchangeIcon sx={{ fontSize: 48, color: "#666" }} />
              <Typography
                variant="h6"
                sx={{ color: "#888", textAlign: "center" }}
              >
                No Market Data
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "#666", textAlign: "center" }}
              >
                Market data will appear here when available
              </Typography>
            </Box>
          ) : (
            <List sx={{ p: 0 }}>
              {filteredData.map((coin, index) => {
                const priceChange = formatPriceChange(coin.change);
                const isSelected = isPairSelected(coin.symbol);
                const isFav = isFavorite(coin.symbol);

                return (
                  <ListItem
                    key={coin.symbol}
                    onClick={() => handleCoinClick(coin)}
                    sx={{
                      cursor: "pointer",
                      borderBottom: 1,
                      borderColor: "divider",
                      backgroundColor: isSelected
                        ? alpha("#1976d2", 0.1)
                        : "transparent",
                      "&:hover": {
                        backgroundColor: alpha("#1976d2", 0.05),
                      },
                      py: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                      }}
                    >
                      {/* Favorite Star - moved to left side */}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(coin.symbol);
                        }}
                        sx={{ mr: 1, color: isFav ? "#ffd700" : "#888" }}
                      >
                        {isFav ? <StarIcon /> : <StarBorderIcon />}
                      </IconButton>

                      {/* Coin Info */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mb: 0.5,
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.primary",
                              fontWeight: 600,
                              fontSize: "0.875rem",
                            }}
                          >
                            {coin.symbol}
                          </Typography>
                          {isFav && (
                            <Chip
                              label="★"
                              size="small"
                              sx={{
                                backgroundColor: "#ffd700",
                                color: "#000",
                                fontSize: "0.75rem",
                                height: 20,
                                minWidth: 20,
                              }}
                            />
                          )}
                        </Box>
                        <Typography
                          variant="caption"
                          sx={{ color: "text.secondary", fontSize: "0.75rem" }}
                        >
                          Vol: {formatVolume(coin.volume24h)}
                        </Typography>
                      </Box>

                      {/* Price Info - exact same as client */}
                      <Box sx={{ textAlign: "right", minWidth: 80 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            color: "text.primary",
                            fontWeight: 600,
                            fontSize: "0.875rem",
                          }}
                        >
                          {formatPrice(coin.price)}
                        </Typography>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 0.5,
                          }}
                        >
                          {priceChange.icon}
                          <Typography
                            variant="caption"
                            sx={{
                              color: priceChange.color,
                              fontSize: "0.75rem",
                              fontWeight: 600,
                            }}
                          >
                            {priceChange.value}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>

        {/* Footer Stats */}
        <Box
          sx={{
            p: 1,
            borderTop: 1,
            borderColor: "divider",
            backgroundColor: "background.paper",
            flexShrink: 0, // Prevent shrinking
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {filteredData.length} coins • {getFavoriteSymbols().length}{" "}
              favorites
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "text.disabled", fontSize: "0.7rem" }}
            >
              Scroll to see more
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  }
);

MarketPanel.displayName = "MarketPanel";

export default memo(MarketPanel);
