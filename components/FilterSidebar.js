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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
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
  ({ selectedSymbol, onCreateAlert, onAlertsCreated, onClose }, ref) => {
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
    });

    const [isCreating, setIsCreating] = useState(false);
    const [createdAlerts, setCreatedAlerts] = useState([]);
    const [errorMessage, setErrorMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [toastOpen, setToastOpen] = useState(false);
    const [toastMessage, setToastMessage] = useState("");

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      createAlert: () => {
        handleCreateAlert();
      },
      getFilters: () => filters,
      resetFilters: async () => {
        // Reset local state
        setFilters({
          minDaily: {},
          changePercent: { direction: "increase" },
          alertCount: {},
          candle: {},
          rsiRange: {},
          volume: {},
        });

        // 🔥 Also delete conditions from database
        try {
          const token = localStorage.getItem("token");
          const user = localStorage.getItem("user");
          if (token && user) {
            const userData = JSON.parse(user);
            await fetch(`/api/conditions?userId=${userData._id}`, {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });
            console.log("✅ Conditions deleted from database");
          }
        } catch (error) {
          console.error("❌ Error deleting conditions:", error);
        }
      },
    }));

    // 🔥 NEW: Load saved conditions on mount (persist after refresh)
    useEffect(() => {
      const loadSavedConditions = async () => {
        try {
          const token = localStorage.getItem("token");
          const user = localStorage.getItem("user");
          if (!token || !user) return;

          const userData = JSON.parse(user);
          const response = await fetch(`/api/conditions?userId=${userData._id}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              const saved = data.data;

              // Map saved conditions to filter format
              const loadedFilters = {
                minDaily: {},
                changePercent: { direction: "increase" },
                alertCount: {},
                candle: {},
                rsiRange: {},
                volume: {},
              };

              // Min Daily
              if (saved.minDaily?.enabled && saved.minDaily?.value) {
                loadedFilters.minDaily = { [saved.minDaily.value]: true };
              }

              // Change Percent
              if (saved.changePercent?.enabled) {
                loadedFilters.changePercent = {
                  direction: saved.changePercent.direction || "increase",
                  percentage: saved.changePercent.percentage || "",
                };
                if (saved.changePercent.timeframe) {
                  loadedFilters.changePercent[saved.changePercent.timeframe] = true;
                }
              }

              // Alert Count
              if (saved.alertCount?.enabled && saved.alertCount?.timeframe) {
                loadedFilters.alertCount = { [saved.alertCount.timeframe]: true };
              }

              // Candle
              if (saved.candle?.enabled && saved.candle?.timeframes?.length > 0) {
                saved.candle.timeframes.forEach(tf => {
                  loadedFilters.candle[tf] = true;
                });
                loadedFilters.candle.condition = saved.candle.condition || "CANDLE_ABOVE_OPEN";
              }

              // RSI
              if (saved.rsiRange?.enabled && saved.rsiRange?.timeframes?.length > 0) {
                saved.rsiRange.timeframes.forEach(tf => {
                  loadedFilters.rsiRange[tf] = true;
                });
                loadedFilters.rsiRange.period = saved.rsiRange.period || 14;
                loadedFilters.rsiRange.level = saved.rsiRange.level || 50;
                loadedFilters.rsiRange.condition = saved.rsiRange.condition || "ABOVE";
              }

              // Volume
              if (saved.volume?.enabled && saved.volume?.timeframes?.length > 0) {
                saved.volume.timeframes.forEach(tf => {
                  loadedFilters.volume[tf] = true;
                });
                loadedFilters.volume.condition = saved.volume.condition || "INCREASING";
                loadedFilters.volume.percentage = saved.volume.percentage || "";
              }

              setFilters(loadedFilters);
              console.log("✅ Loaded saved conditions from database");
            }
          }
        } catch (error) {
          console.error("❌ Error loading saved conditions:", error);
        }
      };

      loadSavedConditions();
    }, []); // Run once on mount

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

          // Validate that level is set if RSI condition is selected
          if (!filters.rsiRange.level || filters.rsiRange.level.trim() === "") {
            setErrorMessage("Please set RSI Level (1-100)");
            setIsCreating(false);
            return;
          }

          alertConditions.rsiRange = {
            timeframes: rsiTimeframes,
            period: filters.rsiRange.period || "14",
            level: filters.rsiRange.level, // No default - user must set it
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

          // Save condition to Condition model (replaces old condition)
          try {
            const user = JSON.parse(localStorage.getItem("user") || "{}");
            await fetch("/api/conditions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                userId: user._id,
                conditions: alertConditions,
              }),
            });
            console.log("✅ Condition saved for display");
          } catch (conditionError) {
            console.error("⚠️ Failed to save condition:", conditionError);
          }

          // 🔥 FIX: Show toast notification for success (more visible)
          setToastMessage(`✅ ${data.data.alerts.length} alerts created successfully!`);
          setToastOpen(true);

          // Clear success message after 5 seconds
          setTimeout(
            () => setSuccessMessage(""),
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

    // Handle reset filters with confirmation
    const handleResetFilters = useCallback(async () => {
      setIsResetting(true);
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          setToastMessage("Authentication required");
          setToastOpen(true);
          return;
        }

        // Call API to remove all alerts
        const response = await fetch("/api/alerts/remove-all", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          console.log("✅ All alerts removed:", data);

          // Reset filter state
          setFilters({
            minDaily: {},
            changePercent: { direction: "increase" },
            alertCount: {},
            candle: {},
            rsiRange: {},
            volume: {},
          });

          // 🔥 Delete conditions from database
          try {
            const user = JSON.parse(localStorage.getItem("user") || "{}");
            if (user._id) {
              await fetch(`/api/conditions?userId=${user._id}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });
              console.log("✅ Conditions deleted from database");
            }
          } catch (conditionError) {
            console.error("⚠️ Failed to delete conditions:", conditionError);
          }

          // Clear created alerts
          setCreatedAlerts([]);
          setSuccessMessage("");
          setErrorMessage("");

          // Show toast
          setToastMessage(`Conditions reset & ${data.deletedCount || 0} alerts removed`);
          setToastOpen(true);
        } else {
          const errorData = await response.json();
          setToastMessage(errorData.error || "Failed to remove alerts");
          setToastOpen(true);
        }
      } catch (error) {
        console.error("Error resetting filters:", error);
        setToastMessage("Failed to reset filters");
        setToastOpen(true);
      } finally {
        setIsResetting(false);
        setResetDialogOpen(false);
      }
    }, []);

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
              // Call onClose prop if provided, otherwise try window.parent fallback
              if (onClose) {
                onClose();
              } else if (window.parent && window.parent.setFilterSidebarOpen) {
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
                    type="number"
                    label="RSI Period"
                    value={filters.rsiRange.period || ""}
                    onChange={(e) =>
                      handleInputChange("rsiRange", "period", e.target.value)
                    }
                    inputProps={{ min: 7, max: 14 }}
                    InputLabelProps={{ shrink: true }}
                    placeholder="14"
                  />
                </Grid>
                <Grid item xs={6}>
                  <CustomTextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Level (1-100)"
                    value={filters.rsiRange.level || ""}
                    onChange={(e) =>
                      handleInputChange("rsiRange", "level", e.target.value)
                    }
                    inputProps={{ min: 1, max: 100 }}
                    InputLabelProps={{ shrink: true }}
                    placeholder="50"
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

          {/* 🔥 UI FIX: Moved buttons here - after Volume accordion, inside filters area */}
          <Box sx={{ p: 1, mt: 2 }}>
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
              color="error"
              onClick={() => setResetDialogOpen(true)}
              disabled={isResetting}
            >
              {isResetting ? "Resetting..." : "Reset Filters & Remove Alerts"}
            </Button>
          </Box>
        </Box>

        {/* Actions - Messages and Dialogs */}
        <Box sx={{ p: 1 }}>

          {/* Confirmation Dialog */}
          <Dialog
            open={resetDialogOpen}
            onClose={() => setResetDialogOpen(false)}
          >
            <DialogTitle>⚠️ Reset Filters & Remove Alerts</DialogTitle>
            <DialogContent>
              <DialogContentText>
                Are you sure? This will:
                <br />• Reset all filter conditions
                <br />• Remove ALL your alerts from database
                <br />• Worker will stop monitoring all pairs
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setResetDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleResetFilters} color="error" variant="contained" disabled={isResetting}>
                {isResetting ? "Removing..." : "Yes, Reset & Remove"}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Toast Notification */}
          <Snackbar
            open={toastOpen}
            autoHideDuration={4000}
            onClose={() => setToastOpen(false)}
            message={toastMessage}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          />

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
