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

    // Debug market data
    useEffect(() => {
      console.log("📊 MarketPanel marketData size:", marketData.length);
      console.log("📊 MarketPanel isConnected:", isConnected);
      console.log("📊 MarketPanel mounted:", mounted);
    }, [marketData.length, isConnected, mounted]);

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
    }, [subscribeToSymbols]);

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

    // Toggle favorite using socket context
    const toggleFavorite = useCallback(
      (symbol) => {
        socketToggleFavorite(symbol);
      },
      [socketToggleFavorite]
    );

    // Check if coin is favorite
    const isFavorite = useCallback(
      (symbol) => {
        const coin = marketData.find((c) => c.symbol === symbol);
        return coin ? coin.isFavorite : false;
      },
      [marketData]
    );

    // Get favorite symbols
    const getFavoriteSymbols = useCallback(() => {
      return marketData
        .filter((coin) => coin.isFavorite)
        .map((coin) => coin.symbol);
    }, [marketData]);

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
      const data = getFilteredMarketData({
        search: searchTerm,
        favorites: view === "favorites",
        sortBy: "symbol",
      });
      console.log("📊 MarketPanel filteredData updated:", data.length, "items");
      console.log("📊 MarketPanel marketData size:", marketData.length);
      return data;
    }, [getFilteredMarketData, searchTerm, view, marketData.length]);

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

    // Toggle all visible pairs favorites (add all or remove all)
    const handleAddAllFavorites = useCallback(() => {
      // Check if all visible pairs are already favorited
      const allFavorited = filteredData.every((coin) =>
        isFavorite(coin.symbol)
      );

      if (allFavorited) {
        // Remove all from favorites
        filteredData.forEach((coin) => {
          if (isFavorite(coin.symbol)) {
            toggleFavorite(coin.symbol);
          }
        });
      } else {
        // Add all to favorites
        filteredData.forEach((coin) => {
          if (!isFavorite(coin.symbol)) {
            toggleFavorite(coin.symbol);
          }
        });
      }
    }, [filteredData, isFavorite, toggleFavorite]);

    // Check if all visible pairs are favorited (for button text)
    const allFavorited = useMemo(() => {
      return (
        filteredData.length > 0 &&
        filteredData.every((coin) => isFavorite(coin.symbol))
      );
    }, [filteredData, isFavorite]);

    // Debug filtered data
    useEffect(() => {
      console.log(
        "📊 MarketPanel filteredData (USDT spot pairs only):",
        filteredData.length
      );
      if (filteredData.length > 0) {
        console.log(
          "📊 Sample filtered pairs:",
          filteredData.slice(0, 5).map((item) => item.symbol)
        );
      }
    }, [filteredData.length]);

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
      const isPositive = change >= 0;
      return {
        value: `${isPositive ? "+" : ""}${change.toFixed(2)}%`,
        color: isPositive ? "#4caf50" : "#f44336",
        icon: isPositive ? <TrendingUpIcon /> : <TrendingDownIcon />,
      };
    };

    // Format volume - exact same as client
    const formatVolume = (volume) => {
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
        <Box sx={{ p: 2, borderBottom: "1px solid #333" }}>
          <Typography
            variant="h6"
            sx={{ color: "white", mb: 1, fontWeight: 600 }}
          >
            Market Panel
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "#888", mb: 2, fontSize: "0.8rem" }}
          >
            USDT Pairs• {filteredData.length} pairs
          </Typography>

          {/* View Toggle - exact same as client */}
          <ToggleButtonGroup
            value={view}
            onChange={(e, value) => value && setView(value)}
            exclusive
            size="small"
            sx={{
              mb: 2,
              "& .MuiToggleButton-root": {
                color: "white",
                borderColor: "#444",
                fontSize: "0.75rem",
                px: 2,
                py: 0.5,
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
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
            <ToggleButton value="market">Market</ToggleButton>
            <ToggleButton value="favorites">Favorites</ToggleButton>
          </ToggleButtonGroup>

          {/* Search - exact same as client */}
          <Box sx={{ position: "relative", mb: 2 }}>
            <InputBase
              placeholder="Search coins..."
              value={searchInput}
              onChange={handleSearchChange}
              sx={{
                width: "100%",
                backgroundColor: "#2a2a2a",
                borderRadius: 1,
                px: 2,
                py: 1,
                color: "white",
                fontSize: "0.875rem",
                "& input": {
                  color: "white",
                  "&::placeholder": {
                    color: "#888",
                  },
                },
              }}
              startAdornment={
                <SearchIcon sx={{ color: "#888", mr: 1, fontSize: 20 }} />
              }
            />
          </Box>

          {/* Add All Favorites and Actions */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={handleAddAllFavorites}
              startIcon={allFavorited ? <StarBorderIcon /> : <StarIcon />}
              sx={{
                color: allFavorited ? "#ff6b6b" : "#ffd700",
                borderColor: allFavorited ? "#ff6b6b" : "#ffd700",
                "&:hover": {
                  borderColor: allFavorited ? "#ff6b6b" : "#ffd700",
                  backgroundColor: allFavorited
                    ? "rgba(255, 107, 107, 0.1)"
                    : "rgba(255, 215, 0, 0.1)",
                },
                fontSize: "0.8rem",
                px: 2,
              }}
            >
              {allFavorited ? "Remove All Favorites" : "Add All Favorites"}
            </Button>

            {checkedPairs.size > 0 && (
              <Button
                size="small"
                variant="contained"
                onClick={handleCreateAlert}
                startIcon={<NotificationsActiveIcon />}
                sx={{ fontSize: "0.75rem", ml: "auto" }}
              >
                Create Alert ({checkedPairs.size})
              </Button>
            )}

            {/* Connection Status */}
            {/* <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}
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
                sx={{ color: "#888", fontSize: "0.7rem" }}
              >
                {isConnected ? "Live" : "Offline"} • {marketData.length} pairs
              </Typography>
            </Box> */}
          </Box>
        </Box>

        {/* Coin List with fixed height and scrollbar */}
        <Box
          className="market-panel-scrollbar"
          sx={{
            flex: 1,
            height: "calc(100vh - 300px)", // Fixed height
            minHeight: "400px", // Minimum height
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
                      borderBottom: "1px solid #333",
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
                              color: "white",
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
                          sx={{ color: "#888", fontSize: "0.75rem" }}
                        >
                          Vol: {formatVolume(coin.volume)}
                        </Typography>
                      </Box>

                      {/* Price Info - exact same as client */}
                      <Box sx={{ textAlign: "right", minWidth: 80 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            color: "white",
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
            p: 2,
            borderTop: "1px solid #333",
            backgroundColor: "#1a1a1a",
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
            <Typography variant="caption" sx={{ color: "#888" }}>
              {filteredData.length} coins • {getFavoriteSymbols().length}{" "}
              favorites
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "#666", fontSize: "0.7rem" }}
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
