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
          "candle",
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

    // Handle alert creation
    const handleCreateAlert = useCallback(async () => {
      if (!selectedSymbol) {
        setErrorMessage("Please select a coin first");
        return;
      }

      setIsCreating(true);
      setErrorMessage("");

      try {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const newAlert = {
          id: Date.now(),
          symbol: selectedSymbol,
          filters: { ...filters },
          settings: { ...alertSettings },
          createdAt: new Date(),
          status: "active",
        };

        setCreatedAlerts((prev) => [...prev, newAlert]);
        onCreateAlert?.(newAlert);
        setSuccessMessage(`Alert created for ${selectedSymbol}`);

        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(""), 3000);
      } catch (error) {
        console.error("Error creating alert:", error);
        setErrorMessage("Failed to create alert");
      } finally {
        setIsCreating(false);
      }
    }, [selectedSymbol, filters, alertSettings, onCreateAlert]);

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
    const marketOptions = [
      { value: "SPOT", label: "Spot" },
      { value: "FUTURES", label: "Futures" },
    ];

    // Exchange options
    const exchangeOptions = [
      { value: "BINANCE", label: "Binance" },
      { value: "COINBASE", label: "Coinbase" },
      { value: "KRAKEN", label: "Kraken" },
    ];

    // Pair options
    const pairOptions = [
      { value: "USDT", label: "USDT" },
      { value: "BTC", label: "BTC" },
      { value: "ETH", label: "ETH" },
      { value: "BNB", label: "BNB" },
    ];

    // Min Daily Volume options - matching the image
    const minDailyOptions = [
      { value: "10000", label: "10k" },
      { value: "100000", label: "100K" },
      { value: "500000", label: "500K" },
      { value: "1000000", label: "1MN" },
      { value: "2000000", label: "2MN" },
      { value: "5000000", label: "5MN" },
      { value: "10000000", label: "10MN" },
      { value: "25000000", label: "25MN" },
      { value: "50000000", label: "50MN and Above" },
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

    // Candle options
    const candleOptions = [
      { value: "GREEN_CANDLE", label: "Green Candle" },
      { value: "RED_CANDLE", label: "Red Candle" },
      { value: "DOJI", label: "Doji" },
      { value: "HAMMER", label: "Hammer" },
      { value: "SHOOTING_STAR", label: "Shooting Star" },
    ];

    // RSI Range options
    const rsiRangeOptions = [
      { value: "OVERSOLD", label: "Oversold (<30)" },
      { value: "OVERBOUGHT", label: "Overbought (>70)" },
      { value: "NEUTRAL", label: "Neutral (30-70)" },
    ];

    // Volume options
    const volumeOptions = [
      { value: "HIGH", label: "High Volume" },
      { value: "LOW", label: "Low Volume" },
      { value: "SPIKE", label: "Volume Spike" },
    ];

    // EMA options
    const emaOptions = [
      { value: "FAST_ABOVE_SLOW", label: "Fast Above Slow" },
      { value: "FAST_BELOW_SLOW", label: "Fast Below Slow" },
      { value: "CROSSOVER", label: "Crossover" },
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
          <Typography
            variant="h6"
            sx={{ color: "white", mb: 1, fontWeight: 600 }}
          >
            Alert Filters
          </Typography>
          <Typography variant="body2" sx={{ color: "#888" }}>
            Selected: {selectedSymbol || "None"}
          </Typography>
          {activeFiltersCount > 0 && (
            <Chip
              label={`${activeFiltersCount} active filters`}
              size="small"
              color="primary"
              sx={{ mt: 1 }}
            />
          )}
        </Box>

        {/* Filters */}
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
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
              <FormGroup>
                {candleOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.candle[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("candle", option.value)
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

          {/* RSI Range Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#ff5722" }} />
                <Typography sx={{ color: "white" }}>RSI Range</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <FormGroup>
                {rsiRangeOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.rsiRange[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("rsiRange", option.value)
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
              <FormGroup>
                {volumeOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.volume[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("volume", option.value)
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

          {/* EMA Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <ShowChartIcon sx={{ color: "#3f51b5" }} />
                <Typography sx={{ color: "white" }}>EMA Fast/Slow</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <FormGroup>
                {emaOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <CustomCheckbox
                        checked={filters.ema[option.value] || false}
                        onChange={() =>
                          handleCheckboxChange("ema", option.value)
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
            disabled={!selectedSymbol || isCreating}
            startIcon={<NotificationsActiveIcon />}
            sx={{ mb: 1 }}
          >
            {isCreating ? "Creating..." : "Create Alert"}
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
