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
  IconButton,
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
} from "@mui/icons-material";
import { useAlert } from "../contexts/AlertContext";
import { useSocket } from "../contexts/SocketContext";
import { useFavorites } from "../contexts/FavoritesContext";

// Custom styled components - exact same as client
const CustomCheckbox = styled(Checkbox)(({ theme }) => ({
  color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
  '&.Mui-checked': {
    color: theme.palette.primary.main,
  },
}));

const DarkAccordion = styled(Accordion)(({ theme }) => ({
  backgroundColor: "transparent",
  color: theme.palette.text.primary,
  boxShadow: "none",
  marginBottom: "2px",
  "&:before": {
    display: "none",
  },
  "& .MuiAccordionSummary-root": {
    minHeight: "24px",
    padding: "0 8px",
    borderRadius: "3px",
    "&:hover": {
      backgroundColor: theme.palette.mode === 'dark' 
        ? "rgba(255, 255, 255, 0.04)" 
        : "rgba(0, 0, 0, 0.04)",
    },
  },
  "& .MuiAccordionSummary-content": {
    margin: "4px 0",
    fontSize: "10px",
    fontWeight: "500",
    letterSpacing: "0.2px",
  },
  "& .MuiAccordionDetails-root": {
    padding: "0 8px 8px",
  },
}));

const CustomTextField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-root": {
    backgroundColor: theme.palette.mode === 'dark' ? "#2a2a2a" : "#f5f5f5",
    color: theme.palette.text.primary,
    "& fieldset": {
      borderColor: theme.palette.mode === 'dark' ? "#444" : "#ccc",
    },
    "&:hover fieldset": {
      borderColor: theme.palette.mode === 'dark' ? "#666" : "#999",
    },
    "&.Mui-focused fieldset": {
      borderColor: theme.palette.primary.main,
    },
  },
  "& .MuiInputLabel-root": {
    color: theme.palette.text.secondary,
  },
  "& .MuiSelect-icon": {
    color: theme.palette.text.primary,
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
      // Price filters
      minDaily: {},
      changePercent: { direction: "increase" }, // Default to increase
      alertCount: {},

      // Technical filters
      candle: {},
      rsiRange: {},
      volume: {},
      openInterest: {},
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
          minDaily: {},
          changePercent: { direction: "increase" },
          alertCount: {},
          candle: {},
          rsiRange: {},
          volume: {},
          openInterest: {},
        });
      },
    }));

    // Handle checkbox changes - exact same logic as client
    const handleCheckboxChange = useCallback(
      (category, value) => {
        // Define single selection categories
        const singleSelectionCategories = [
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

      // Check if Min Daily and Change % conditions are set (required)
      const hasMinDaily = Object.values(filters.minDaily).some(
        (value) => value === true
      );
      const hasChangePercent =
        Object.values(filters.changePercent).some((value) => value === true) &&
        filters.changePercent.percentage;

      if (!hasMinDaily || !hasChangePercent) {
        let missingConditions = [];
        if (!hasMinDaily) missingConditions.push("Min Daily volume");
        if (!hasChangePercent)
          missingConditions.push("Change % timeframe and percentage");

        setErrorMessage(`Please set: ${missingConditions.join(", ")}`);
        setIsCreating(false);
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

        // Create alert conditions - Min Daily and Change % are mandatory
        const minDailyKey = Object.keys(filters.minDaily).find(
          (key) => filters.minDaily[key] === true
        );
        const changePercentKey = Object.keys(filters.changePercent).find(
          (key) => key !== "percentage" && filters.changePercent[key] === true
        );

        // Validate that required conditions are properly set
        if (!minDailyKey) {
          setErrorMessage("Please select a Min Daily value");
          setIsCreating(false);
          return;
        }

        if (!changePercentKey || !filters.changePercent.percentage) {
          setErrorMessage("Please set Change % timeframe and percentage");
          setIsCreating(false);
          return;
        }

        const alertConditions = {
          // Basic conditions (required)
          minDaily: minDailyKey,
          changePercent: {
            timeframe: changePercentKey,
            percentage: filters.changePercent.percentage,
            direction: filters.changePercent.direction || "increase", // Include direction
          },
        };

        // Check for optional conditions
        const hasAlertCount = Object.values(filters.alertCount).some(
          (value) => value === true
        );
        const hasCandle = Object.values(filters.candle).some(
          (value) => value === true
        );
        const hasRsiRange = Object.values(filters.rsiRange).some(
          (value) => value === true
        );
        const hasVolume = Object.values(filters.volume).some(
          (value) => value === true
        );
        const hasOpenInterest = Object.values(filters.openInterest).some(
          (value) => value === true
        );

        if (hasAlertCount) {
          const alertCountKey = Object.keys(filters.alertCount).find(
            (key) => filters.alertCount[key] === true
          );
          alertConditions.alertCount = {
            timeframe: alertCountKey,
          };
        }

        if (hasCandle) {
          const candleTimeframes = Object.keys(filters.candle).filter(
            (key) => key !== "condition" && filters.candle[key] === true
          );
          alertConditions.candle = {
            timeframes: candleTimeframes,
            condition: filters.candle.condition || "CANDLE_ABOVE_OPEN",
          };
        }

        if (hasRsiRange) {
          const rsiTimeframes = Object.keys(filters.rsiRange).filter(
            (key) =>
              !["period", "level", "condition"].includes(key) &&
              filters.rsiRange[key] === true
          );
          alertConditions.rsiRange = {
            timeframes: rsiTimeframes,
            period: filters.rsiRange.period || "14",
            level: filters.rsiRange.level || "70",
            condition: filters.rsiRange.condition || "ABOVE",
          };
        }

        if (hasVolume) {
          const volumeTimeframes = Object.keys(filters.volume).filter(
            (key) =>
              !["condition", "percentage"].includes(key) &&
              filters.volume[key] === true
          );
          alertConditions.volume = {
            timeframes: volumeTimeframes,
            condition: filters.volume.condition || "INCREASING",
            percentage: filters.volume.percentage || "",
          };
        }

        if (hasOpenInterest) {
          const openInterestTimeframes = Object.keys(
            filters.openInterest
          ).filter(
            (key) =>
              !["direction", "percentage"].includes(key) &&
              filters.openInterest[key] === true
          );
          alertConditions.openInterest = {
            timeframes: openInterestTimeframes,
            direction: filters.openInterest.direction || "INCREASING",
            percentage: filters.openInterest.percentage || "",
          };
        }

        // Remove undefined conditions
        Object.keys(alertConditions).forEach((key) => {
          if (alertConditions[key] === undefined) {
            delete alertConditions[key];
          }
        });

        console.log(
          `🚀 Creating alerts for ${favoriteSymbols.length} favorite pairs...`
        );
        console.log("🔍 Debug - alertConditions:", alertConditions);

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
              email: true,
              telegram: true,
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
          setTimeout(
            () => setSuccessMessage("alerts are created successfully"),
            5000
          );
        } else {
          const errorData = await response.json();
          console.log("❌ API Error:", errorData);
          setErrorMessage(errorData.error || "Failed to create alerts");
        }
      } catch (error) {
        console.error("Error creating alerts:", error);
        setErrorMessage("Failed to create alerts");
      } finally {
        setIsCreating(false);
      }
    }, [getFavoriteSymbols, filters, onCreateAlert]);

    // Get active filters count
    const activeFiltersCount = useMemo(() => {
      return Object.values(filters).filter((filter) =>
        Object.values(filter).some(
          (value) =>
            value === true || (typeof value === "string" && value.trim() !== "")
        )
      ).length;
    }, [filters]);

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

    // Candle condition options - only 3 options
    const candleConditionOptions = [
      { value: "CANDLE_ABOVE_OPEN", label: "Candle Above Open" },
      { value: "HAMMER", label: "Hammer" },
      { value: "INVERTED_HAMMER", label: "Inverted Hammer" },
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

    // OPEN INTEREST timeframe options
    const openInterestTimeframeOptions = [
      { value: "1MIN", label: "1MIN" },
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4H", label: "4H" },
    ];

    // OPEN INTEREST direction options
    const openInterestDirectionOptions = [
      { value: "INCREASING", label: "INCREASING" },
      { value: "DECREASING", label: "DECREASING" },
      { value: "ABOVE", label: "ABOVE" },
      { value: "BELOW", label: "BELOW" },
    ];

    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box
          sx={{
            p: 1,
            borderBottom: 1, borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="h6" sx={{ color: "text.primary", fontWeight: 600 }}>
            Alert Filters
          </Typography>
          <IconButton
            onClick={() => {
              // This will be handled by the parent component
              if (window.parent && window.parent.setFilterSidebarOpen) {
                window.parent.setFilterSidebarOpen(false);
              }
            }}
            sx={{ color: "text.primary" }}
            size="small"
          >
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Filters */}
        <Box
          sx={{
            flex: 1,
            p: 0.5,
            overflow: "auto",
            height: "calc(100vh - 60px)",
            minHeight: "200px",
            maxHeight: "calc(100vh - 60px)",
          }}
          className="filter-sidebar-scrollbar"
        >
          {/* Min Daily Volume Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SpeedIcon sx={{ color: "#9c27b0" }} />
                <Typography sx={{ color: "text.primary" }}>Min. Daily</Typography>
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
                        color: "text.primary",
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
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TrendingUpIcon sx={{ color: "#f44336" }} />
                <Typography sx={{ color: "text.primary" }}>Change %</Typography>
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
                        color: "text.primary",
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
                sx={{ mt: 2 }}
              />
              <CustomTextField
                fullWidth
                select
                size="small"
                label="Direction"
                value={filters.changePercent.direction || "increase"}
                onChange={(e) =>
                  handleInputChange(
                    "changePercent",
                    "direction",
                    e.target.value
                  )
                }
                sx={{ mt: 2 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {filters.changePercent.direction === "increase" ? (
                        <TrendingUpIcon
                          sx={{ fontSize: 18, color: "#4caf50" }}
                        />
                      ) : filters.changePercent.direction === "decrease" ? (
                        <TrendingDownIcon
                          sx={{ fontSize: 18, color: "#f44336" }}
                        />
                      ) : (
                        <ShowChartIcon
                          sx={{ fontSize: 18, color: "#ff9800" }}
                        />
                      )}
                    </InputAdornment>
                  ),
                }}
              >
                <MenuItem value="increase">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <TrendingUpIcon sx={{ fontSize: 18, color: "#4caf50" }} />
                    Increase Only
                  </Box>
                </MenuItem>
                <MenuItem value="decrease">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <TrendingDownIcon sx={{ fontSize: 18, color: "#f44336" }} />
                    Decrease Only
                  </Box>
                </MenuItem>
                <MenuItem value="both">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <ShowChartIcon sx={{ fontSize: 18, color: "#ff9800" }} />
                    Both Directions
                  </Box>
                </MenuItem>
              </CustomTextField>
            </AccordionDetails>
          </DarkAccordion>

          {/* Alert Count Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <NotificationsActiveIcon sx={{ color: "#e91e63" }} />
                <Typography sx={{ color: "text.primary" }}>Alert Count</Typography>
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
                        color: "text.primary",
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
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#795548" }} />
                <Typography sx={{ color: "text.primary" }}>Candle</Typography>
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
                        color: "text.primary",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Condition dropdown */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
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
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#ff5722" }} />
                <Typography sx={{ color: "text.primary" }}>
                  RSI Range (Multiple)
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframe checkboxes */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {rsiTimeframeOptions.map((option) => (
                  <Grid item xs={4} key={option.value}>
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
                        color: "text.primary",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Input fields */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
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

              {/* Condition dropdown */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Condition:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters.rsiRange.condition || "ABOVE"}
                onChange={(e) =>
                  handleInputChange("rsiRange", "condition", e.target.value)
                }
              >
                {rsiConditionOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>
            </AccordionDetails>
          </DarkAccordion>

          {/* Volume Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SpeedIcon sx={{ color: "#607d8b" }} />
                <Typography sx={{ color: "text.primary" }}>Volume</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframe checkboxes */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {volumeTimeframeOptions.map((option) => (
                  <Grid item xs={4} key={option.value}>
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
                        color: "text.primary",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Condition dropdown */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Condition:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters.volume.condition || "INCREASING"}
                onChange={(e) =>
                  handleInputChange("volume", "condition", e.target.value)
                }
                sx={{ mb: 2 }}
              >
                {volumeConditionOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>

              {/* Percentage input */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
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

          {/* OPEN INTEREST Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <ShowChartIcon sx={{ color: "#3f51b5" }} />
                <Typography sx={{ color: "text.primary" }}>
                  OPEN INTEREST (Multiple)
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframe checkboxes */}
              <Grid container spacing={1} sx={{ mb: 2 }}>
                {openInterestTimeframeOptions.map((option) => (
                  <Grid item xs={4} key={option.value}>
                    <FormControlLabel
                      control={
                        <CustomCheckbox
                          checked={filters.openInterest[option.value] || false}
                          onChange={() =>
                            handleCheckboxChange("openInterest", option.value)
                          }
                        />
                      }
                      label={option.label}
                      sx={{
                        color: "text.primary",
                        "& .MuiFormControlLabel-label": {
                          fontSize: "14px",
                        },
                      }}
                    />
                  </Grid>
                ))}
              </Grid>

              {/* Direction dropdown */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12}>
                  <CustomTextField
                    fullWidth
                    select
                    size="small"
                    label="Direction"
                    value={filters.openInterest.direction || "INCREASING"}
                    onChange={(e) =>
                      handleInputChange(
                        "openInterest",
                        "direction",
                        e.target.value
                      )
                    }
                    SelectProps={{
                      MenuProps: {
                        PaperProps: {
                          sx: {
                            backgroundColor: theme.palette.mode === 'dark' ? "#1e1e1e" : "#fff",
                            color: theme.palette.text.primary,
                            "& .MuiMenuItem-root": {
                              color: theme.palette.text.primary,
                              "&:hover": {
                                backgroundColor: theme.palette.mode === 'dark' ? "#333" : "#f5f5f5",
                              },
                              "&.Mui-selected": {
                                backgroundColor: theme.palette.primary.main,
                                color: "#fff",
                              },
                            },
                          },
                        },
                      },
                    }}
                  >
                    {openInterestDirectionOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </CustomTextField>
                </Grid>
              </Grid>

              {/* Percentage input */}
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <CustomTextField
                    fullWidth
                    size="small"
                    label="Percentage %"
                    type="number"
                    value={filters.openInterest.percentage || ""}
                    onChange={(e) =>
                      handleInputChange(
                        "openInterest",
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
                </Grid>
              </Grid>
            </AccordionDetails>
          </DarkAccordion>
        </Box>

        {/* Actions */}
        <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
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
                minDaily: {},
                changePercent: { direction: "increase" },
                alertCount: {},
                candle: {},
                rsiRange: {},
                volume: {},
                openInterest: {},
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
