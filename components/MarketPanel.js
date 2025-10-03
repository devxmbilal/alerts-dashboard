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

// Mock data for demonstration - exact same as client
const mockCryptoData = [
  {
    symbol: "BTCUSDT",
    price: 45000,
    change: 2.5,
    volume: 1234567890,
    isFavorite: true,
  },
  {
    symbol: "ETHUSDT",
    price: 3000,
    change: -1.2,
    volume: 987654321,
    isFavorite: false,
  },
  {
    symbol: "ADAUSDT",
    price: 0.45,
    change: 5.8,
    volume: 456789123,
    isFavorite: true,
  },
  {
    symbol: "SOLUSDT",
    price: 100,
    change: 3.2,
    volume: 789123456,
    isFavorite: false,
  },
  {
    symbol: "DOTUSDT",
    price: 7.5,
    change: -2.1,
    volume: 321654987,
    isFavorite: true,
  },
  {
    symbol: "LINKUSDT",
    price: 15.2,
    change: 1.8,
    volume: 654321987,
    isFavorite: false,
  },
  {
    symbol: "UNIUSDT",
    price: 8.9,
    change: -0.5,
    volume: 321987654,
    isFavorite: true,
  },
  {
    symbol: "AVAXUSDT",
    price: 25.6,
    change: 4.2,
    volume: 789654321,
    isFavorite: false,
  },
  {
    symbol: "MATICUSDT",
    price: 0.85,
    change: -1.5,
    volume: 456123789,
    isFavorite: true,
  },
  {
    symbol: "ATOMUSDT",
    price: 12.3,
    change: 2.1,
    volume: 654789123,
    isFavorite: false,
  },
  {
    symbol: "NEARUSDT",
    price: 3.2,
    change: 6.5,
    volume: 321456789,
    isFavorite: true,
  },
  {
    symbol: "FTMUSDT",
    price: 0.35,
    change: -3.2,
    volume: 789321654,
    isFavorite: false,
  },
  {
    symbol: "ALGOUSDT",
    price: 0.18,
    change: 1.5,
    volume: 456789321,
    isFavorite: true,
  },
  {
    symbol: "VETUSDT",
    price: 0.025,
    change: -2.8,
    volume: 321789654,
    isFavorite: false,
  },
  {
    symbol: "ICPUSDT",
    price: 8.5,
    change: 4.1,
    volume: 654123789,
    isFavorite: true,
  },
];

const MarketPanel = forwardRef(
  ({ onSelectCoin, onCreateAlert, onAlertsCreated }, ref) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const isTablet = useMediaQuery(theme.breakpoints.down("lg"));

    // State management - exact same as client
    const [view, setView] = useState("market");
    const [searchTerm, setSearchTerm] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [cryptoData, setCryptoData] = useState(mockCryptoData);
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
        setTimeout(() => {
          setLoading(false);
        }, 1000);
      },
      getSelectedCoins: () => Array.from(checkedPairs),
    }));

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

    // Toggle favorite - exact same as client
    const toggleFavorite = useCallback((symbol) => {
      setCryptoData((prev) =>
        prev.map((coin) =>
          coin.symbol === symbol
            ? { ...coin, isFavorite: !coin.isFavorite }
            : coin
        )
      );
    }, []);

    // Check if coin is favorite
    const isFavorite = useCallback(
      (symbol) => {
        const coin = cryptoData.find((c) => c.symbol === symbol);
        return coin ? coin.isFavorite : false;
      },
      [cryptoData]
    );

    // Get favorite symbols
    const getFavoriteSymbols = useCallback(() => {
      return cryptoData
        .filter((coin) => coin.isFavorite)
        .map((coin) => coin.symbol);
    }, [cryptoData]);

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

    // Filter and sort data - exact same logic as client
    const filteredData = useMemo(() => {
      let filtered = cryptoData;

      // Apply view filter
      if (view === "favorites") {
        filtered = filtered.filter((coin) => coin.isFavorite);
      }

      // Apply search filter
      if (searchTerm) {
        filtered = filtered.filter((coin) =>
          coin.symbol.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }

      // Sort by symbol (default)
      filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));

      return filtered;
    }, [cryptoData, view, searchTerm]);

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
          </Box>
        </Box>

        {/* Coin List - exact same as client */}
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {loading ? (
            // Loading skeleton - exact same as client
            Array.from({ length: 10 }).map((_, index) => (
              <Box key={index} sx={{ p: 2, borderBottom: "1px solid #333" }}>
                <Skeleton variant="text" width="60%" height={20} />
                <Skeleton variant="text" width="40%" height={16} />
              </Box>
            ))
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

        {/* Footer Stats - exact same as client */}
        <Box
          sx={{ p: 2, borderTop: "1px solid #333", backgroundColor: "#1a1a1a" }}
        >
          <Typography variant="caption" sx={{ color: "#888" }}>
            {filteredData.length} coins • {getFavoriteSymbols().length}{" "}
            favorites
          </Typography>
        </Box>
      </Box>
    );
  }
);

MarketPanel.displayName = "MarketPanel";

export default memo(MarketPanel);
