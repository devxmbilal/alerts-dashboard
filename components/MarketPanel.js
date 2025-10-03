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
  useMediaQuery,
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
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const isTablet = useMediaQuery(theme.breakpoints.down("lg"));

    // Socket context for real-time data
    const {
      marketData,
      isConnected,
      subscribeToSymbols,
      fetchAllPairs,
      toggleFavorite: socketToggleFavorite,
      getFilteredMarketData,
    } = useSocket();

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
    }, [selectAllChecked]);

    // Filter and sort data using socket context
    const filteredData = useMemo(() => {
      return getFilteredMarketData({
        search: searchTerm,
        favorites: view === "favorites",
        sortBy: "symbol",
      });
    }, [getFilteredMarketData, searchTerm, view]);

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
            sx={{ color: "white", mb: 2, fontWeight: 600 }}
          >
            Market Panel
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

          {/* Select All and Actions - exact same as client */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectAllChecked}
                  onChange={handleSelectAll}
                  sx={{ color: "#1976d2" }}
                  size="small"
                />
              }
              label="Select All"
              sx={{ color: "white", fontSize: "0.75rem" }}
            />

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
            <Box
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
            </Box>
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
                      {/* Selection Checkbox - exact same as client */}
                      <Checkbox
                        checked={isSelected}
                        onChange={() => togglePairSelection(coin.symbol)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ color: "#1976d2", mr: 1 }}
                        size="small"
                      />

                      {/* Coin Info - exact same as client */}
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

                      {/* Favorite Toggle - exact same as client */}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(coin.symbol);
                        }}
                        sx={{ ml: 1, color: isFav ? "#ffd700" : "#888" }}
                      >
                        {isFav ? <StarIcon /> : <StarBorderIcon />}
                      </IconButton>
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
