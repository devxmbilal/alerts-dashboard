"use client";

import React, {
  useState,
  useEffect,
  memo,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Box,
  Paper,
  Typography,
  FormGroup,
  FormControlLabel,
  Checkbox,
  TextField,
  MenuItem,
  Button,
  Alert,
  InputAdornment,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
  useMediaQuery,
  Divider,
  Chip,
  Slider,
  Grid,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import {
  Check as CheckIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  NotificationsActive as NotificationsActiveIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Speed as SpeedIcon,
  Timeline as TimelineIcon,
  Star as StarIcon,
  ShowChart as ShowChartIcon,
  BarChart as BarChartIcon,
  CurrencyExchange as CurrencyExchangeIcon,
} from "@mui/icons-material";
import { useAlert } from "../contexts/AlertContext";
import { useSocket } from "../contexts/SocketContext";
import { useFavorites } from "../contexts/FavoritesContext";

// Custom styled components - exact same as client
const CustomCheckbox = styled((props) => (
  <Checkbox
    {...props}
    disableRipple
    icon={
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          backgroundColor: "white",
          border: "1px solid rgba(255,255,255,0.3)",
          display: "inline-block",
        }}
      />
    }
    checkedIcon={
      <span
        style={{
          width: 21,
          height: 21,
          borderRadius: 3,
          backgroundColor: "#1890ff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CheckIcon style={{ fontSize: 16, color: "white" }} />
      </span>
    }
  />
))({});

const DarkAccordion = styled(Accordion)({
  backgroundColor: "transparent",
  color: "white",
  boxShadow: "none",
  marginBottom: "8px",
  "&:before": {
    display: "none",
  },
  "& .MuiAccordionSummary-root": {
    minHeight: "48px",
    padding: "0 16px",
    borderRadius: "6px",
    "&:hover": {
      backgroundColor: "rgba(255, 255, 255, 0.04)",
    },
  },
  "& .MuiAccordionSummary-content": {
    margin: "12px 0",
    fontSize: "14px",
    fontWeight: "500",
    letterSpacing: "0.5px",
  },
  "& .MuiAccordionDetails-root": {
    padding: "0 16px 16px",
  },
});

const CustomTextField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-root": {
    backgroundColor: "#2a2a2a",
    color: "white",
    "& fieldset": {
      borderColor: "#444",
    },
    "&:hover fieldset": {
      borderColor: "#666",
    },
    "&.Mui-focused fieldset": {
      borderColor: theme.palette.primary.main,
    },
  },
  "& .MuiInputLabel-root": {
    color: "#888",
  },
}));

const FilterSidebar = forwardRef(
  ({ selectedSymbol, onCreateAlert, onAlertsCreated }, ref) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    // Alert, Socket, and Favorites contexts
    const { removeAlertsForSymbols, hasAlert } = useAlert();
    const { marketData } = useSocket();
    const { favoriteCount, getFavoriteSymbols } = useFavorites();

    // State management - exact same as client
    const [filters, setFilters] = useState({
      // Market filters - default selections matching the image
      market: { SPOT: true },
      exchange: { BINANCE: true },
      pair: { USDT: true },

      // Price filters
      minDaily: {},
      changePercent: {},
      alertCount: {},

      // Technical filters
      candle: {},
      rsiRange: {},
      volume: {},
      ema: {},
    });

    const [alertSettings, setAlertSettings] = useState({
      timeframe: "1h",
      notificationType: "both",
      email: "",
      telegram: "",
    });

    const [isCreating, setIsCreating] = useState(false);
    const [createdAlerts, setCreatedAlerts] = useState([]);
    const [errorMessage, setErrorMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      createAlert: () => {
        handleCreateAlert();
      },
      getFilters: () => filters,
      resetFilters: () => {
        setFilters({
          market: { SPOT: true },
          exchange: { BINANCE: true },
          pair: { USDT: true },
          minDaily: {},
          changePercent: {},
          alertCount: {},
          candle: {},
          rsiRange: {},
          volume: {},
          ema: {},
        });
      },
    }));

    // Handle checkbox changes - exact same logic as client
    const handleCheckboxChange = useCallback(
      (category, value) => {
        // Define single selection categories
        const singleSelectionCategories = [
          "market",
          "exchange",
          "pair",
          "minDaily",
          "changePercent",
          "alertCount",
        ];

        let newFilters = { ...filters };

        if (singleSelectionCategories.includes(category)) {
          // Single selection: if clicking the same option, uncheck it; otherwise clear all others and select only this one
          const isCurrentlyChecked = filters[category]?.[value] || false;

          if (isCurrentlyChecked) {
            // If currently checked, uncheck it (clear the entire category)
            newFilters[category] = {};
          } else {
            // If not checked, clear all others and select only this one
            newFilters[category] = {};
            newFilters[category][value] = true;
          }
        } else {
          // Multiple selection: toggle the current value
          newFilters[category] = {
            ...filters[category],
            [value]: !filters[category]?.[value],
          };
        }

        setFilters(newFilters);
      },
      [filters]
    );

    // Handle input changes
    const handleInputChange = useCallback((category, field, value) => {
      setFilters((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          [field]: value,
        },
      }));
    }, []);

    // Handle alert creation for favorites
    const handleCreateAlert = useCallback(async () => {
      const favoriteSymbols = await getFavoriteSymbols();

      if (favoriteSymbols.length === 0) {
        setErrorMessage("Please add some coins to favorites first");
        return;
      }

      // Check if Min Daily and Change % conditions are set
      const hasMinDaily = Object.keys(filters.minDaily).length > 0;
      const hasChangePercent =
        Object.keys(filters.changePercent).length > 0 &&
        filters.changePercent.percentage;

      if (!hasMinDaily || !hasChangePercent) {
        setErrorMessage("Please set both Min Daily and Change % conditions");
        return;
      }

      setIsCreating(true);
      setErrorMessage("");

      try {
        const token = localStorage.getItem("token");
        if (!token) {
          setErrorMessage("Authentication token not found");
          return;
        }

        // Create alert conditions - include ALL conditions from filters
        const alertConditions = {
          // Basic conditions (required)
          minDaily: Object.keys(filters.minDaily)[0], // Get selected min daily value
          changePercent: {
            timeframe: Object.keys(filters.changePercent)[0], // Get selected timeframe
            percentage: filters.changePercent.percentage,
          },

          // Additional conditions (optional but will be saved if set)
          alertCount:
            Object.keys(filters.alertCount).length > 0
              ? {
                  timeframe: Object.keys(filters.alertCount)[0],
                }
              : undefined,
          candle:
            Object.keys(filters.candle).length > 0
              ? {
                  timeframes: Object.keys(filters.candle).filter(
                    (key) => key !== "condition"
                  ),
                  condition: filters.candle.condition || "CANDLE_ABOVE_OPEN",
                }
              : undefined,
          rsiRange:
            Object.keys(filters.rsiRange).length > 0
              ? {
                  timeframes: Object.keys(filters.rsiRange).filter(
                    (key) => !["period", "level", "condition"].includes(key)
                  ),
                  period: filters.rsiRange.period || "14",
                  level: filters.rsiRange.level || "70",
                  condition: filters.rsiRange.condition || "ABOVE",
                }
              : undefined,
          volume:
            Object.keys(filters.volume).length > 0
              ? {
                  timeframes: Object.keys(filters.volume).filter(
                    (key) => !["condition", "percentage"].includes(key)
                  ),
                  condition: filters.volume.condition || "INCREASING",
                  percentage: filters.volume.percentage || "",
                }
              : undefined,
          ema:
            Object.keys(filters.ema).length > 0
              ? {
                  timeframes: Object.keys(filters.ema).filter(
                    (key) => !["fast", "slow", "condition"].includes(key)
                  ),
                  fast: filters.ema.fast || "12",
                  slow: filters.ema.slow || "26",
                  condition: filters.ema.condition || "ABOVE",
                }
              : undefined,
        };

        // Remove undefined conditions
        Object.keys(alertConditions).forEach((key) => {
          if (alertConditions[key] === undefined) {
            delete alertConditions[key];
          }
        });

        console.log(
          `🚀 Creating alerts for ${favoriteSymbols.length} favorite pairs...`
        );

        // Single API call to create alerts for all favorite pairs
        const response = await fetch("/api/alerts/bulk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            conditions: alertConditions,
            notificationSettings: {
              email:
                alertSettings.notificationType === "email" ||
                alertSettings.notificationType === "both",
              telegram:
                alertSettings.notificationType === "telegram" ||
                alertSettings.notificationType === "both",
              webhook: false,
            },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Bulk alerts created:`, data.message);

          setCreatedAlerts((prev) => [...prev, ...data.data.alerts]);
          onCreateAlert?.(data.data.alerts);
          setSuccessMessage(data.message);

          // Clear success message after 5 seconds
          setTimeout(() => setSuccessMessage(""), 5000);
        } else {
          const errorData = await response.json();
          setErrorMessage(errorData.error || "Failed to create alerts");
        }
      } catch (error) {
        console.error("Error creating alerts:", error);
        setErrorMessage("Failed to create alerts");
      } finally {
        setIsCreating(false);
      }
    }, [getFavoriteSymbols, filters, alertSettings, onCreateAlert]);

    // Get active filters count
    const activeFiltersCount = useMemo(() => {
      return Object.values(filters).filter((filter) =>
        Object.values(filter).some(
          (value) =>
            value === true || (typeof value === "string" && value.trim() !== "")
        )
      ).length;
    }, [filters]);

    // Market options
    const marketOptions = [{ value: "SPOT", label: "Spot" }];

    // Exchange options
    const exchangeOptions = [{ value: "BINANCE", label: "Binance" }];

    // Pair options
    const pairOptions = [{ value: "USDT", label: "USDT" }];

    // Min Daily Volume options - matching the image
    const minDailyOptions = [
      { value: "10000", label: "10k" },
      { value: "100000", label: "100K" },
      { value: "500000", label: "500K" },
      { value: "1000000", label: "1M" },
      { value: "2000000", label: "2M" },
      { value: "5000000", label: "5M" },
      { value: "10000000", label: "10M" },
      { value: "25000000", label: "25M" },
      { value: "50000000", label: "50M and Above" },
    ];

    // Change % options - matching the image
    const changePercentOptions = [
      { value: "1MIN", label: "1MIN" },
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
    ];

    // Alert Count options - matching the image
    const alertCountOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
    ];

    // Candle time options - matching the image
    const candleTimeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
      { value: "W", label: "W" },
    ];

    // Candle condition options - matching the image
    const candleConditionOptions = [
      { value: "CANDLE_ABOVE_OPEN", label: "Candle Above Open" },
      { value: "CANDLE_BELOW_OPEN", label: "Candle Below Open" },
      { value: "GREEN_CANDLE", label: "Green Candle (Close > Open)" },
      { value: "RED_CANDLE", label: "Red Candle (Close < Open)" },
      { value: "BULLISH_HAMMER", label: "Bullish Hammer" },
      { value: "BEARISH_HAMMER", label: "Bearish Hammer" },
      { value: "DOJI", label: "Doji (Open ≈ Close)" },
      { value: "LONG_UPPER_WICK", label: "Long Upper Wick" },
      { value: "LONG_LOWER_WICK", label: "Long Lower Wick" },
      { value: "NONE", label: "None" },
    ];

    // RSI Range timeframe options - matching the image
    const rsiTimeframeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
    ];

    // RSI Range condition options - matching the image
    const rsiConditionOptions = [
      { value: "ABOVE", label: "ABOVE" },
      { value: "BELOW", label: "BELOW" },
      { value: "CROSSING_UP", label: "CROSSING UP" },
      { value: "CROSSING_DOWN", label: "CROSSING DOWN" },
    ];

    // Volume timeframe options - matching the image
    const volumeTimeframeOptions = [
      { value: "1MIN", label: "1MIN" },
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
    ];

    // Volume condition options - matching the image
    const volumeConditionOptions = [
      { value: "INCREASING", label: "INCREASING" },
      { value: "DECREASING", label: "DECREASING" },
      { value: "ABOVE", label: "ABOVE" },
      { value: "BELOW", label: "BELOW" },
    ];

    // EMA timeframe options - matching the image
    const emaTimeframeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
    ];

    // EMA condition options - matching the image
    const emaConditionOptions = [
      { value: "ABOVE", label: "ABOVE" },
      { value: "BELOW", label: "BELOW" },
      { value: "CROSSING_UP", label: "CROSSING UP" },
      { value: "CROSSING_DOWN", label: "CROSSING DOWN" },
    ];

    // Timeframe options
    const timeframeOptions = [
      { value: "1m", label: "1 Minute" },
      { value: "5m", label: "5 Minutes" },
      { value: "15m", label: "15 Minutes" },
      { value: "1h", label: "1 Hour" },
      { value: "4h", label: "4 Hours" },
      { value: "1d", label: "1 Day" },
    ];

    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: "1px solid #333" }}>
          <Typography variant="h6" sx={{ color: "white", fontWeight: 600 }}>
            Alert Filters
          </Typography>
        </Box>

        {/* Filters */}
        <Box
          sx={{
            flex: 1,
            p: 2,
            overflow: "auto",
            height: "calc(100vh - 120px)",
            minHeight: "500px",
            maxHeight: "calc(100vh - 120px)",
          }}
          className="filter-sidebar-scrollbar"
        >
          {/* Market Filter */}
          <DarkAccordion defaultExpanded>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <ShowChartIcon sx={{ color: "#1976d2" }} />
                <Typography sx={{ color: "white" }}>Market</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <FormGroup>
                {marketOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.market[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("market", option.value)
                        }
                      />
                    }
                    label={option.label}
                    sx={{ color: "white" }}
                  />
                ))}
              </FormGroup>
            </AccordionDetails>
          </DarkAccordion>

          {/* Exchange Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CurrencyExchangeIcon sx={{ color: "#4caf50" }} />
                <Typography sx={{ color: "white" }}>Exchange</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <FormGroup>
                {exchangeOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.exchange[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("exchange", option.value)
                        }
                      />
                    }
                    label={option.label}
                    sx={{ color: "white" }}
                  />
                ))}
              </FormGroup>
            </AccordionDetails>
          </DarkAccordion>

          {/* Pair Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <BarChartIcon sx={{ color: "#ff9800" }} />
                <Typography sx={{ color: "white" }}>Pair</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <FormGroup>
                {pairOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.pair[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("pair", option.value)
                        }
                      />
                    }
                    label={option.label}
                    sx={{ color: "white" }}
                  />
                ))}
              </FormGroup>
            </AccordionDetails>
          </DarkAccordion>

          {/* Min Daily Volume Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SpeedIcon sx={{ color: "#9c27b0" }} />
                <Typography sx={{ color: "white" }}>Min. Daily</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={1}>
                {minDailyOptions.map((option, index) => (
                  <Grid item xs={6} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.minDaily[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("minDaily", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </AccordionDetails>
          </DarkAccordion>

          {/* Change % Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TrendingUpIcon sx={{ color: "#f44336" }} />
                <Typography sx={{ color: "white" }}>Change %</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {changePercentOptions.map((option) => (
                  <Grid item xs={6} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.changePercent[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("changePercent", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
              <CustomTextField
                fullWidth
                size="small"
                label="Percentage %"
                placeholder="Enter percentage"
                value={filters.changePercent.percentage || ""}
                onChange={(e) =>
                  handleInputChange(
                    "changePercent",
                    "percentage",
                    e.target.value
                  )
                }
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">%</InputAdornment>
                  ),
                }}
              />
            </AccordionDetails>
          </DarkAccordion>

          {/* Alert Count Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <NotificationsActiveIcon sx={{ color: "#e91e63" }} />
                <Typography sx={{ color: "white" }}>Alert Count</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={1}>
                {alertCountOptions.map((option) => (
                  <Grid item xs={6} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.alertCount[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("alertCount", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </AccordionDetails>
          </DarkAccordion>

          {/* Candle Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#795548" }} />
                <Typography sx={{ color: "white" }}>Candle</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Time options in two rows */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {candleTimeOptions.map((option) => (
                  <Grid item xs={3} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.candle[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("candle", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Condition dropdown */}
              <Typography variant="body2" sx={{ color: "#888", mb: 1 }}>
                Condition:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters.candle.condition || "CANDLE_ABOVE_OPEN"}
                onChange={(e) =>
                  handleInputChange("candle", "condition", e.target.value)
                }
                sx={{ mb: 1 }}
              >
                {candleConditionOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>
            </AccordionDetails>
          </DarkAccordion>

          {/* RSI Range Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#ff5722" }} />
                <Typography sx={{ color: "white" }}>
                  RSI Range (Multiple)
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframe checkboxes */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {rsiTimeframeOptions.map((option) => (
                  <Grid item xs={2} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.rsiRange[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("rsiRange", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Input fields */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6}>
                  <CustomTextField
                    fullWidth
                    size="small"
                    label="RSI Period"
                    value={filters.rsiRange.period || "14"}
                    onChange={(e) =>
                      handleInputChange("rsiRange", "period", e.target.value)
                    }
                  />
                </Grid>
                <Grid item xs={6}>
                  <CustomTextField
                    fullWidth
                    size="small"
                    label="Level (1-100)"
                    value={filters.rsiRange.level || "70"}
                    onChange={(e) =>
                      handleInputChange("rsiRange", "level", e.target.value)
                    }
                  />
                </Grid>
              </Grid>

              {/* Condition buttons */}
              <Grid container spacing={1}>
                {rsiConditionOptions.map((option) => (
                  <Grid item xs={6} key={option.value}>
                    <Button
                      fullWidth
                      variant={
                        filters.rsiRange.condition === option.value
                          ? "contained"
                          : "outlined"
                      }
                      onClick={() =>
                        handleInputChange("rsiRange", "condition", option.value)
                      }
                      sx={{
                        mb: 1,
                        fontSize: "12px",
                        textTransform: "none",
                        borderColor: "#444",
                        color: "white",
                        "&:hover": {
                          borderColor: "#666",
                        },
                      }}
                    >
                      {option.label}
                    </Button>
                  </Grid>
                ))}
              </Grid>
            </AccordionDetails>
          </DarkAccordion>

          {/* Volume Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SpeedIcon sx={{ color: "#607d8b" }} />
                <Typography sx={{ color: "white" }}>Volume</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframe checkboxes */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {volumeTimeframeOptions.map((option) => (
                  <Grid item xs={2.4} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.volume[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("volume", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Condition buttons */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {volumeConditionOptions.map((option) => (
                  <Grid item xs={6} key={option.value}>
                    <Button
                      fullWidth
                      variant={
                        filters.volume.condition === option.value
                          ? "contained"
                          : "outlined"
                      }
                      onClick={() =>
                        handleInputChange("volume", "condition", option.value)
                      }
                      sx={{
                        mb: 1,
                        fontSize: "12px",
                        textTransform: "none",
                        borderColor: "#444",
                        color: "white",
                        "&:hover": {
                          borderColor: "#666",
                        },
                      }}
                    >
                      {option.label}
                    </Button>
                  </Grid>
                ))}
              </Grid>

              {/* Percentage input */}
              <Typography variant="body2" sx={{ color: "#888", mb: 1 }}>
                Percentage %:
              </Typography>
              <CustomTextField
                fullWidth
                size="small"
                placeholder="Enter percentage"
                value={filters.volume.percentage || ""}
                onChange={(e) =>
                  handleInputChange("volume", "percentage", e.target.value)
                }
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">%</InputAdornment>
                  ),
                }}
              />
            </AccordionDetails>
          </DarkAccordion>

          {/* EMA Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <ShowChartIcon sx={{ color: "#3f51b5" }} />
                <Typography sx={{ color: "white" }}>
                  EMA Fast / Slow (Multiple)
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframe checkboxes in two rows */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {emaTimeframeOptions.map((option) => (
                  <Grid item xs={4} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.ema[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("ema", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "white",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Input fields */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6}>
                  <CustomTextField
                    fullWidth
                    size="small"
                    label="Fast"
                    value={filters.ema.fast || "12"}
                    onChange={(e) =>
                      handleInputChange("ema", "fast", e.target.value)
                    }
                  />
                </Grid>
                <Grid item xs={6}>
                  <CustomTextField
                    fullWidth
                    size="small"
                    label="Slow"
                    value={filters.ema.slow || "26"}
                    onChange={(e) =>
                      handleInputChange("ema", "slow", e.target.value)
                    }
                  />
                </Grid>
              </Grid>

              {/* Condition buttons */}
              <Grid container spacing={1}>
                {emaConditionOptions.map((option) => (
                  <Grid item xs={12} key={option.value}>
                    <Button
                      fullWidth
                      variant={
                        filters.ema.condition === option.value
                          ? "contained"
                          : "outlined"
                      }
                      onClick={() =>
                        handleInputChange("ema", "condition", option.value)
                      }
                      sx={{
                        mb: 1,
                        fontSize: "12px",
                        textTransform: "none",
                        borderColor: "#444",
                        color: "white",
                        "&:hover": {
                          borderColor: "#666",
                        },
                      }}
                    >
                      {option.label}
                    </Button>
                  </Grid>
                ))}
              </Grid>
            </AccordionDetails>
          </DarkAccordion>

          {/* Alert Settings */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <NotificationsActiveIcon sx={{ color: "#1976d2" }} />
                <Typography sx={{ color: "white" }}>Alert Settings</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <CustomTextField
                select
                fullWidth
                size="small"
                label="Timeframe"
                value={alertSettings.timeframe}
                onChange={(e) =>
                  setAlertSettings((prev) => ({
                    ...prev,
                    timeframe: e.target.value,
                  }))
                }
                sx={{ mb: 2 }}
              >
                {timeframeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>

              <CustomTextField
                select
                fullWidth
                size="small"
                label="Notification Type"
                value={alertSettings.notificationType}
                onChange={(e) =>
                  setAlertSettings((prev) => ({
                    ...prev,
                    notificationType: e.target.value,
                  }))
                }
                sx={{ mb: 2 }}
              >
                <MenuItem value="email">Email Only</MenuItem>
                <MenuItem value="telegram">Telegram Only</MenuItem>
                <MenuItem value="both">Both</MenuItem>
              </CustomTextField>

              <CustomTextField
                fullWidth
                size="small"
                label="Email"
                value={alertSettings.email}
                onChange={(e) =>
                  setAlertSettings((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
                sx={{ mb: 2 }}
              />

              <CustomTextField
                fullWidth
                size="small"
                label="Telegram Chat ID"
                value={alertSettings.telegram}
                onChange={(e) =>
                  setAlertSettings((prev) => ({
                    ...prev,
                    telegram: e.target.value,
                  }))
                }
              />
            </AccordionDetails>
          </DarkAccordion>
        </Box>

        {/* Actions */}
        <Box sx={{ p: 2, borderTop: "1px solid #333" }}>
          <Button
            fullWidth
            variant="contained"
            onClick={handleCreateAlert}
            disabled={favoriteCount === 0 || isCreating}
            startIcon={<NotificationsActiveIcon />}
            sx={{ mb: 1 }}
          >
            {isCreating
              ? "Creating..."
              : `Create Alerts for ${favoriteCount} Favorites`}
          </Button>

          <Button
            fullWidth
            variant="outlined"
            onClick={() => {
              setFilters({
                market: { SPOT: true },
                exchange: { BINANCE: true },
                pair: { USDT: true },
                minDaily: {},
                changePercent: {},
                alertCount: {},
                candle: {},
                rsiRange: {},
                volume: {},
                ema: {},
              });
            }}
            sx={{ mb: 1 }}
          >
            Reset Filters
          </Button>

          {/* Messages */}
          {errorMessage && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {errorMessage}
            </Alert>
          )}

          {successMessage && (
            <Alert severity="success" sx={{ mt: 1 }}>
              {successMessage}
            </Alert>
          )}

          {createdAlerts.length > 0 && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {createdAlerts.length} alert(s) created
            </Alert>
          )}
        </Box>
      </Box>
    );
  }
);

FilterSidebar.displayName = "FilterSidebar";

export default memo(FilterSidebar);
