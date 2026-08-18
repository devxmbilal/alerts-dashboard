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
  ToggleButton,
  ToggleButtonGroup,
  Select,
  Radio,
  Tooltip,
  Menu,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import SpeedIcon from "@mui/icons-material/Speed";
import TimelineIcon from "@mui/icons-material/Timeline";
import StarIcon from "@mui/icons-material/Star";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import BarChartIcon from "@mui/icons-material/BarChart";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
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

// TradingView CEX-Screener style dropdown for timeframe selection (checkbox list in a popover)
const TimeframeDropdown = ({ options, selected, onToggle, placeholder = "Select timeframe(s)" }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const selectedLabels = options.filter((o) => selected?.[o.value]).map((o) => o.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
      ? selectedLabels.join(", ")
      : `${selectedLabels.length} selected`;

  return (
    <>
      <Box
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "1px solid",
          borderColor: open ? "primary.main" : isDark ? "#444" : "#ccc",
          borderRadius: "4px",
          px: 1.5,
          py: 1,
          cursor: "pointer",
          backgroundColor: isDark ? "#2a2a2a" : "#f5f5f5",
          transition: "border-color 0.15s",
          "&:hover": { borderColor: isDark ? "#666" : "#999" },
        }}
      >
        <Typography
          noWrap
          sx={{
            fontSize: "14px",
            color: selectedLabels.length ? "text.primary" : "text.secondary",
          }}
        >
          {summary}
        </Typography>
        <ExpandMoreIcon
          sx={{
            fontSize: 20,
            color: "text.secondary",
            flexShrink: 0,
            ml: 0.5,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </Box>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{
          sx: {
            backgroundColor: isDark ? "#1e222d" : "#ffffff",
            border: "1px solid",
            borderColor: isDark ? "#363a45" : "#ddd",
            borderRadius: "6px",
            mt: 0.5,
            maxHeight: 320,
            width: anchorEl ? anchorEl.offsetWidth : undefined,
            "& .MuiList-root": { py: 0.5 },
          },
        }}
      >
        {options.map((option) => {
          const isChecked = selected?.[option.value] || false;
          return (
            <MenuItem
              key={option.value}
              onClick={() => onToggle(option.value)}
              disableRipple
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                py: 0.9,
                px: 1.5,
                "&:hover": {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.04)",
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: "14px",
                  color: isChecked ? "primary.main" : "text.primary",
                  fontWeight: isChecked ? 600 : 400,
                }}
              >
                {option.label}
              </Typography>
              {isChecked && (
                <CheckIcon sx={{ fontSize: 18, color: "primary.main" }} />
              )}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

const FilterSidebar = forwardRef(
  ({ selectedSymbol, onCreateAlert, onAlertsCreated, onClose, exchange, setExchange }, ref) => {
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
      macd: {},
      volume: {},
      volumeEma: {},
      rsiDivergence: {},
      oiChange: {},
      cvd: {},
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
          macd: {},
          volume: {},
          volumeEma: {},
          rsiDivergence: {},
          oiChange: {},
          cvd: {},
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
                macd: {},
                volume: {},
                volumeEma: {},
                rsiDivergence: {},
                oiChange: {},
                cvd: {},
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

              // MACD
              if (saved.macd?.enabled && saved.macd?.timeframes?.length > 0) {
                saved.macd.timeframes.forEach(tf => {
                  loadedFilters.macd[tf] = true;
                });
                loadedFilters.macd.fastPeriod = saved.macd.fastPeriod || "12";
                loadedFilters.macd.slowPeriod = saved.macd.slowPeriod || "26";
                loadedFilters.macd.condition = saved.macd.condition || "ABOVE";
              }

              // Volume
              if (saved.volume?.enabled && saved.volume?.timeframes?.length > 0) {
                saved.volume.timeframes.forEach(tf => {
                  loadedFilters.volume[tf] = true;
                });
                loadedFilters.volume.condition = saved.volume.condition || "INCREASING";
                loadedFilters.volume.percentage = saved.volume.percentage || "";
              }

              // RSI Divergence
              if (saved.rsiDivergence?.enabled && saved.rsiDivergence?.timeframes?.length > 0) {
                saved.rsiDivergence.timeframes.forEach(tf => {
                  loadedFilters.rsiDivergence[tf] = true;
                });
                loadedFilters.rsiDivergence.bullish = saved.rsiDivergence.bullish || false;
                loadedFilters.rsiDivergence.bullishHidden = saved.rsiDivergence.bullishHidden || false;
                loadedFilters.rsiDivergence.bearish = saved.rsiDivergence.bearish || false;
                loadedFilters.rsiDivergence.bearishHidden = saved.rsiDivergence.bearishHidden || false;
                loadedFilters.rsiDivergence.condition = saved.rsiDivergence.condition || "independent";
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

      // Check for all condition selections
      const hasMinDaily = Object.values(filters.minDaily).some((value) => value === true);
      const hasChangePercent = Object.values(filters.changePercent).some((value) => value === true) && filters.changePercent.percentage;
      const hasAlertCount = Object.values(filters.alertCount).some((value) => value === true);
      const hasCandle = Object.values(filters.candle).some((value) => value === true);
      const hasRsiRange = Object.values(filters.rsiRange).some((value) => value === true);
      const hasMacd = filters.macd && Object.values(filters.macd).some((value) => value === true);
      const hasVolume = Object.values(filters.volume).some((value) => value === true);
      const hasVolumeEma = filters.volumeEma && Object.values(filters.volumeEma).some((value) => value === true);
      // Divergence needs BOTH a timeframe and a divergence type to be a usable trigger
      const rsiDivHasTimeframe =
        filters.rsiDivergence &&
        Object.keys(filters.rsiDivergence).some(
          (key) =>
            !["bullish", "bullishHidden", "bearish", "bearishHidden", "condition"].includes(key) &&
            filters.rsiDivergence[key] === true
        );
      const rsiDivHasType = !!(
        filters.rsiDivergence?.bullish ||
        filters.rsiDivergence?.bullishHidden ||
        filters.rsiDivergence?.bearish ||
        filters.rsiDivergence?.bearishHidden
      );
      const hasRsiDivergence = rsiDivHasTimeframe && rsiDivHasType;
      const hasOiChange = filters.oiChange && Object.values(filters.oiChange).some((value) => value === true) && filters.oiChange.value;

      // CVD needs a timeframe plus whatever its selected mode requires: a
      // threshold for Surge, at least one box ticked for the other two.
      const cvdNonTimeframeKeys = [
        "mode", "resetAnchor", "type", "value", "direction", "condition",
        "bullishAbsorption", "bearishAbsorption",
        "bullish", "bullishHidden", "bearish", "bearishHidden",
      ];
      const cvdHasTimeframe =
        filters.cvd &&
        Object.keys(filters.cvd).some(
          (key) => !cvdNonTimeframeKeys.includes(key) && filters.cvd[key] === true
        );
      const cvdMode = filters.cvd?.mode || "surge";
      const cvdHasSetup =
        cvdMode === "surge"
          ? !!filters.cvd?.value
          : cvdMode === "absorption"
            ? !!(filters.cvd?.bullishAbsorption || filters.cvd?.bearishAbsorption)
            : !!(
              filters.cvd?.bullish ||
              filters.cvd?.bullishHidden ||
              filters.cvd?.bearish ||
              filters.cvd?.bearishHidden
            );
      const hasCvd = cvdHasTimeframe && cvdHasSetup;

      // Validation 1: Min Daily is always required
      if (!hasMinDaily) {
        setErrorMessage("Please set: Daily min Volume");
        setIsCreating(false);
        return;
      }

      // Validation 2: At least one other condition must be set
      if (!hasChangePercent && !hasAlertCount && !hasCandle && !hasRsiRange && !hasMacd && !hasVolume && !hasVolumeEma && !hasRsiDivergence && !hasOiChange && !hasCvd) {
        setErrorMessage("Please set at least one condition (Price Change, RSI, RSI Divergence, CVD, etc.)");
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

        const minDailyKey = Object.keys(filters.minDaily).find(
          (key) => filters.minDaily[key] === true
        );

        if (!minDailyKey) {
          setErrorMessage("Please select a Daily min Volume value");
          setIsCreating(false);
          return;
        }

        const alertConditions = {};
        if (minDailyKey) {
          alertConditions.minDaily = minDailyKey;
        }

        if (hasChangePercent) {
          const changePercentKey = Object.keys(filters.changePercent).find(
            (key) => key !== "percentage" && filters.changePercent[key] === true
          );
          if (!changePercentKey || !filters.changePercent.percentage) {
            setErrorMessage("Please set Price Change timeframe and percentage");
            setIsCreating(false);
            return;
          }
          alertConditions.changePercent = {
            timeframe: changePercentKey,
            percentage: filters.changePercent.percentage,
            direction: filters.changePercent.direction || "increase",
          };
        }

        // Optional conditions are evaluated below

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

        if (hasMacd) {
          const macdTimeframes = Object.keys(filters.macd).filter(
            (key) =>
              !["fastPeriod", "slowPeriod", "condition"].includes(key) &&
              filters.macd[key] === true
          );
          alertConditions.macd = {
            timeframes: macdTimeframes,
            fastPeriod: filters.macd.fastPeriod || "12",
            slowPeriod: filters.macd.slowPeriod || "26",
            condition: filters.macd.condition || "ABOVE",
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

        if (hasVolumeEma) {
          const volumeEmaTimeframes = Object.keys(filters.volumeEma).filter(
            (key) =>
              !["emaPeriod", "condition"].includes(key) &&
              filters.volumeEma[key] === true
          );
          alertConditions.volumeEma = {
            timeframes: volumeEmaTimeframes,
            emaPeriod: filters.volumeEma.emaPeriod || "20",
            condition: filters.volumeEma.condition || "CROSSING_UP",
          };
        }

        if (hasRsiDivergence) {
          const rsiDivTimeframes = Object.keys(filters.rsiDivergence).filter(
            (key) =>
              !["bullish", "bullishHidden", "bearish", "bearishHidden", "condition"].includes(key) &&
              filters.rsiDivergence[key] === true
          );
          alertConditions.rsiDivergence = {
            timeframes: rsiDivTimeframes,
            bullish: filters.rsiDivergence.bullish || false,
            bullishHidden: filters.rsiDivergence.bullishHidden || false,
            bearish: filters.rsiDivergence.bearish || false,
            bearishHidden: filters.rsiDivergence.bearishHidden || false,
            condition: filters.rsiDivergence.condition || "independent",
          };
        }

        if (hasOiChange) {
          const oiTimeframes = Object.keys(filters.oiChange).filter(
            (key) =>
              !["type", "value", "direction"].includes(key) &&
              filters.oiChange[key] === true
          );
          alertConditions.oiChange = {
            timeframes: oiTimeframes,
            type: filters.oiChange.type || "PERCENTAGE",
            value: filters.oiChange.value,
            direction: filters.oiChange.direction || "increase",
          };
        }

        if (hasCvd) {
          const cvdTimeframes = Object.keys(filters.cvd).filter(
            (key) => !cvdNonTimeframeKeys.includes(key) && filters.cvd[key] === true
          );
          // Only send the fields the chosen mode actually uses, so an unrelated
          // leftover from a mode the user tried and switched away from cannot
          // reach the engine.
          alertConditions.cvd = {
            timeframes: cvdTimeframes,
            mode: cvdMode,
            resetAnchor: filters.cvd.resetAnchor || "daily",
          };
          if (cvdMode === "surge") {
            alertConditions.cvd.type = filters.cvd.type || "PERCENTAGE";
            alertConditions.cvd.value = filters.cvd.value;
            alertConditions.cvd.direction = filters.cvd.direction || "increase";
          } else if (cvdMode === "absorption") {
            alertConditions.cvd.bullishAbsorption = filters.cvd.bullishAbsorption || false;
            alertConditions.cvd.bearishAbsorption = filters.cvd.bearishAbsorption || false;
          } else {
            alertConditions.cvd.bullish = filters.cvd.bullish || false;
            alertConditions.cvd.bullishHidden = filters.cvd.bullishHidden || false;
            alertConditions.cvd.bearish = filters.cvd.bearish || false;
            alertConditions.cvd.bearishHidden = filters.cvd.bearishHidden || false;
            alertConditions.cvd.condition = filters.cvd.condition || "previous";
          }
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
            exchange: exchange,
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

          // 🔥 Show toast notification
          setToastMessage(`✅ ${data.data.alerts.length} Alerts Created Successfully!`);
          setToastOpen(true);

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
          
          // 🔥 Dispatch event to clear frontend notification queue
          window.dispatchEvent(new CustomEvent('alertsCleared'));

          // Reset filter state
          setFilters({
            minDaily: {},
            changePercent: { direction: "increase" },
            alertCount: {},
            candle: {},
            rsiRange: {},
            macd: {},
            volume: {},
            volumeEma: {},
            rsiDivergence: {},
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
      return Object.values(filters).filter((filter) => {
        if (!filter) return false;
        return Object.values(filter).some(
          (value) =>
            value === true || (typeof value === "string" && value.trim() !== "")
        );
      }).length;
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
      { value: "MONTHLY", label: "M" },
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
      { value: "W", label: "W" },
      { value: "M", label: "M" },
    ];

    // RSI Range condition options - matching the image
    const rsiConditionOptions = [
      { value: "ABOVE", label: "ABOVE" },
      { value: "BELOW", label: "BELOW" },
      { value: "CROSSING_UP", label: "CROSSING UP" },
      { value: "CROSSING_DOWN", label: "CROSSING DOWN" },
    ];

    // MACD timeframe options
    const macdTimeframeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
    ];

    // MACD condition options
    const macdConditionOptions = [
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

    // Volume EMA timeframe options
    const volumeEmaTimeframeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
    ];

    // Volume EMA condition options
    const volumeEmaConditionOptions = [
      { value: "CROSSING_UP", label: "CROSSING UP" },
      { value: "CROSSING_DOWN", label: "CROSSING DOWN" },
    ];

    // OI Change timeframe options
    const oiTimeframeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "D", label: "D" },
      { value: "W", label: "W" },
    ];

    // OI Change Type options
    const oiTypeOptions = [
      { value: "PERCENTAGE", label: "Percentage" },
      { value: "VALUE", label: "Value" },
    ];

    // CVD timeframe options — same set as Divergence, since CVD Divergence
    // reuses that engine and should offer the same range.
    const cvdTimeframeOptions = [
      { value: "5MIN", label: "5MIN" },
      { value: "15MIN", label: "15MIN" },
      { value: "1HR", label: "1HR" },
      { value: "4HR", label: "4HR" },
      { value: "12HR", label: "12HR" },
      { value: "D", label: "D" },
      { value: "W", label: "W" },
      { value: "M", label: "M" },
    ];

    const cvdModeOptions = [
      { value: "surge", label: "Delta Surge" },
      { value: "absorption", label: "Smart Money Absorption" },
      { value: "divergence", label: "CVD Divergence" },
    ];

    const cvdSurgeTypeOptions = [
      { value: "PERCENTAGE", label: "% of Candle Volume" },
      { value: "VALUE", label: "Raw Value" },
    ];

    const cvdTriggerOptions = [
      { value: "previous", label: "Previous Candle" },
      { value: "independent", label: "Independent Trigger" },
    ];

    const cvdResetAnchorOptions = [
      { value: "daily", label: "Daily Reset (UTC)" },
      { value: "weekly", label: "Weekly Reset" },
      { value: "rolling", label: "Rolling Window" },
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
          {/* Exchange Toggle - Temporarily disabled for RSI Divergence work
          <Box sx={{ mb: 2, mt: 1, px: 1 }}>
            <ToggleButtonGroup
              color="primary"
              value={exchange}
              exclusive
              onChange={(e, newExchange) => {
                if (newExchange !== null) setExchange(newExchange);
              }}
              aria-label="Exchange Selection"
              fullWidth
              size="small"
              sx={{
                "& .MuiToggleButton-root": {
                  color: "text.secondary",
                  borderColor: "divider",
                  "&.Mui-selected": {
                    color: "primary.main",
                    backgroundColor: "rgba(144, 202, 249, 0.16)",
                  },
                },
              }}
            >
              <ToggleButton value="binance">Binance Spot</ToggleButton>
              <ToggleButton value="alpha">Binance Alpha</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          */}


          {/* Min Daily Volume Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SpeedIcon sx={{ color: "#9c27b0" }} />
                <Typography sx={{ color: "text.primary" }}>Daily min Volume</Typography>
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
                <Typography sx={{ color: "text.primary" }}>Price Change</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={changePercentOptions}
                  selected={filters.changePercent}
                  onToggle={(value) => handleCheckboxChange("changePercent", value)}
                  placeholder="Select timeframe"
                />
              </Box>
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
              <TimeframeDropdown
                options={alertCountOptions}
                selected={filters.alertCount}
                onToggle={(value) => handleCheckboxChange("alertCount", value)}
                placeholder="Select timeframe"
              />
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
              {/* Timeframes */}
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={candleTimeOptions}
                  selected={filters.candle}
                  onToggle={(value) => handleCheckboxChange("candle", value)}
                  placeholder="Select timeframe(s)"
                />
              </Box>

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
              {/* Timeframes */}
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={rsiTimeframeOptions}
                  selected={filters.rsiRange}
                  onToggle={(value) => handleCheckboxChange("rsiRange", value)}
                  placeholder="Select timeframe(s)"
                />
              </Box>

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

          {/* Divergence Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#00bfa5" }} />
                <Typography sx={{ color: "text.primary" }}>
                  Divergence
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframes */}
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={rsiTimeframeOptions}
                  selected={filters?.rsiDivergence}
                  onToggle={(value) => handleCheckboxChange("rsiDivergence", value)}
                  placeholder="Select timeframe(s)"
                />
              </Box>

              {/* Divergence Type checkboxes */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Divergence Types:
              </Typography>
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={[
                    { value: "bullish", label: "Bullish Divergence" },
                    { value: "bullishHidden", label: "Bullish Hidden Divergence" },
                    { value: "bearish", label: "Bearish Divergence" },
                    { value: "bearishHidden", label: "Bearish Hidden Divergence" },
                  ]}
                  selected={filters?.rsiDivergence}
                  onToggle={(value) =>
                    handleInputChange(
                      "rsiDivergence",
                      value,
                      !filters?.rsiDivergence?.[value]
                    )
                  }
                  placeholder="Select divergence type(s)"
                />
              </Box>

              {/* Divergence Condition: label + info tooltip, dropdown below */}
              <Box sx={{ mt: 2, mb: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <Typography variant="body1" sx={{ color: "text.primary", fontWeight: 600 }}>
                    Divergence Condition
                  </Typography>
                  <Tooltip
                    placement="top-start"
                    slotProps={{
                      tooltip: {
                        sx: {
                          bgcolor: theme.palette.background.paper,
                          color: theme.palette.text.primary,
                          border: "1px solid",
                          borderColor: theme.palette.divider,
                          boxShadow: theme.shadows[4],
                          maxWidth: 320,
                        },
                      },
                    }}
                    title={
                      <Box sx={{ p: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
                          Independent Trigger
                        </Typography>
                        <Typography variant="caption" sx={{ display: "block", mb: 1.5 }}>
                          Bypass Mode: If any selected divergence forms, the alert fires
                          immediately, completely bypassing and ignoring any other filters
                          you have set.
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
                          Conditional Trigger
                        </Typography>
                        <Typography variant="caption" sx={{ display: "block" }}>
                          Safety Shield: If a Bearish Divergence is detected on the current
                          candle, it blocks the alert from firing, saving you from bad
                          trades, even if other conditions are met.
                        </Typography>
                      </Box>
                    }
                  >
                    <InfoOutlinedIcon sx={{ fontSize: 18, color: "primary.main", cursor: "pointer" }} />
                  </Tooltip>
                </Box>

                <CustomTextField
                  select
                  fullWidth
                  size="small"
                  value={filters?.rsiDivergence?.condition || "independent"}
                  onChange={(e) =>
                    handleInputChange("rsiDivergence", "condition", e.target.value)
                  }
                >
                  <MenuItem value="independent">Independent Trigger</MenuItem>
                  <MenuItem value="conditional">Conditional Trigger</MenuItem>
                </CustomTextField>
              </Box>
            </AccordionDetails>
          </DarkAccordion>

          {/* OI Change Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TimelineIcon sx={{ color: "#3f51b5" }} />
                <Typography sx={{ color: "text.primary" }}>OI Change</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Timeframes */}
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={oiTimeframeOptions}
                  selected={filters?.oiChange}
                  onToggle={(value) => handleCheckboxChange("oiChange", value)}
                  placeholder="Select timeframe(s)"
                />
              </Box>

              {/* Scroll Down option: Percentage or Value */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Type:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters?.oiChange?.type || "PERCENTAGE"}
                onChange={(e) =>
                  handleInputChange("oiChange", "type", e.target.value)
                }
                sx={{ mb: 2 }}
              >
                {oiTypeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>

              {/* Percentage (BOX) or Value (BOX) */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                {filters?.oiChange?.type === "PERCENTAGE" ? "Percentage %:" : "Value:"}
              </Typography>
              <CustomTextField
                fullWidth
                size="small"
                type="number"
                placeholder={filters?.oiChange?.type === "PERCENTAGE" ? "Enter %" : "Enter value"}
                value={filters?.oiChange?.value || ""}
                onChange={(e) =>
                  handleInputChange("oiChange", "value", e.target.value)
                }
                InputProps={
                  filters?.oiChange?.type === "PERCENTAGE"
                    ? { endAdornment: <InputAdornment position="end">%</InputAdornment> }
                    : undefined
                }
                sx={{ mb: 2 }}
              />

              {/* Direction Dropdown */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Direction:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters?.oiChange?.direction || "increase"}
                onChange={(e) =>
                  handleInputChange("oiChange", "direction", e.target.value)
                }
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {filters?.oiChange?.direction === "increase" ? (
                        <TrendingUpIcon sx={{ fontSize: 18, color: "#4caf50" }} />
                      ) : filters?.oiChange?.direction === "decrease" ? (
                        <TrendingDownIcon sx={{ fontSize: 18, color: "#f44336" }} />
                      ) : (
                        <ShowChartIcon sx={{ fontSize: 18, color: "#ff9800" }} />
                      )}
                    </InputAdornment>
                  ),
                }}
              >
                <MenuItem value="increase">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <TrendingUpIcon sx={{ fontSize: 18, color: "#4caf50" }} />
                    Increasing
                  </Box>
                </MenuItem>
                <MenuItem value="decrease">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <TrendingDownIcon sx={{ fontSize: 18, color: "#f44336" }} />
                    Decreasing
                  </Box>
                </MenuItem>
                <MenuItem value="both">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <ShowChartIcon sx={{ fontSize: 18, color: "#ff9800" }} />
                    Both
                  </Box>
                </MenuItem>
              </CustomTextField>
            </AccordionDetails>
          </DarkAccordion>

          {/* CVD (Cumulative Volume Delta) Filter */}
          <DarkAccordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <BarChartIcon sx={{ color: "#00bcd4" }} />
                <Typography sx={{ color: "text.primary" }}>CVD</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Step 1: Timeframes */}
              <Box sx={{ mb: 2 }}>
                <TimeframeDropdown
                  options={cvdTimeframeOptions}
                  selected={filters?.cvd}
                  onToggle={(value) => handleCheckboxChange("cvd", value)}
                  placeholder="Select timeframe(s)"
                />
              </Box>

              {/* Step 2: Mode */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Mode:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters?.cvd?.mode || "surge"}
                onChange={(e) =>
                  handleInputChange("cvd", "mode", e.target.value)
                }
                sx={{ mb: 2 }}
              >
                {cvdModeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>

              {/* Step 3: Mode-specific fields */}
              {(filters?.cvd?.mode || "surge") === "surge" && (
                <>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    Type:
                  </Typography>
                  <CustomTextField
                    select
                    fullWidth
                    size="small"
                    value={filters?.cvd?.type || "PERCENTAGE"}
                    onChange={(e) =>
                      handleInputChange("cvd", "type", e.target.value)
                    }
                    sx={{ mb: 2 }}
                  >
                    {cvdSurgeTypeOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </CustomTextField>

                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    {filters?.cvd?.type === "VALUE" ? "Value:" : "Threshold %:"}
                  </Typography>
                  <CustomTextField
                    fullWidth
                    size="small"
                    type="number"
                    placeholder={filters?.cvd?.type === "VALUE" ? "Enter value" : "Enter %"}
                    value={filters?.cvd?.value || ""}
                    onChange={(e) =>
                      handleInputChange("cvd", "value", e.target.value)
                    }
                    InputProps={
                      filters?.cvd?.type !== "VALUE"
                        ? { endAdornment: <InputAdornment position="end">%</InputAdornment> }
                        : undefined
                    }
                    sx={{ mb: 2 }}
                  />

                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    Direction:
                  </Typography>
                  <CustomTextField
                    select
                    fullWidth
                    size="small"
                    value={filters?.cvd?.direction || "increase"}
                    onChange={(e) =>
                      handleInputChange("cvd", "direction", e.target.value)
                    }
                    sx={{ mb: 2 }}
                  >
                    <MenuItem value="increase">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <TrendingUpIcon sx={{ fontSize: 18, color: "#4caf50" }} />
                        Buy-Dominant
                      </Box>
                    </MenuItem>
                    <MenuItem value="decrease">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <TrendingDownIcon sx={{ fontSize: 18, color: "#f44336" }} />
                        Sell-Dominant
                      </Box>
                    </MenuItem>
                    <MenuItem value="both">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <ShowChartIcon sx={{ fontSize: 18, color: "#ff9800" }} />
                        Both
                      </Box>
                    </MenuItem>
                  </CustomTextField>
                </>
              )}

              {filters?.cvd?.mode === "absorption" && (
                <>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    Absorption Types:
                  </Typography>
                  <Grid container spacing={1} sx={{ mb: 2 }}>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <CustomCheckbox
                            checked={filters?.cvd?.bullishAbsorption || false}
                            onChange={(e) =>
                              handleInputChange("cvd", "bullishAbsorption", e.target.checked)
                            }
                          />
                        }
                        label="Bullish Absorption (Red candle, buyers absorbing)"
                        sx={{ color: "text.primary" }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <CustomCheckbox
                            checked={filters?.cvd?.bearishAbsorption || false}
                            onChange={(e) =>
                              handleInputChange("cvd", "bearishAbsorption", e.target.checked)
                            }
                          />
                        }
                        label="Bearish Absorption (Green candle, sellers absorbing)"
                        sx={{ color: "text.primary" }}
                      />
                    </Grid>
                  </Grid>
                </>
              )}

              {filters?.cvd?.mode === "divergence" && (
                <>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    Divergence Types:
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <TimeframeDropdown
                      options={[
                        { value: "bullish", label: "Regular Bullish" },
                        { value: "bullishHidden", label: "Hidden Bullish" },
                        { value: "bearish", label: "Regular Bearish" },
                        { value: "bearishHidden", label: "Hidden Bearish" },
                      ]}
                      selected={filters?.cvd}
                      onToggle={(value) =>
                        handleInputChange("cvd", value, !filters?.cvd?.[value])
                      }
                      placeholder="Select divergence type(s)"
                    />
                  </Box>

                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    Trigger Mode:
                  </Typography>
                  <CustomTextField
                    select
                    fullWidth
                    size="small"
                    value={filters?.cvd?.condition || "previous"}
                    onChange={(e) =>
                      handleInputChange("cvd", "condition", e.target.value)
                    }
                    sx={{ mb: 2 }}
                  >
                    {cvdTriggerOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </CustomTextField>
                </>
              )}

              {/* Step 4: Reset Anchor */}
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Reset Anchor:
              </Typography>
              <CustomTextField
                select
                fullWidth
                size="small"
                value={filters?.cvd?.resetAnchor || "daily"}
                onChange={(e) =>
                  handleInputChange("cvd", "resetAnchor", e.target.value)
                }
              >
                {cvdResetAnchorOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </CustomTextField>
            </AccordionDetails>
          </DarkAccordion>

          {false && (
            <>
              {/* MACD Filter */}
              <DarkAccordion>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon sx={{ color: "text.primary" }} />}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <ShowChartIcon sx={{ color: "#ff9800" }} />
                    <Typography sx={{ color: "text.primary" }}>MACD</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  {/* Timeframe checkboxes */}
                  <Grid container spacing={1} sx={{ mb: 2 }}>
                    {macdTimeframeOptions.map((option) => (
                      <Grid item xs={4} key={option.value}>
                        <FormControlLabel
                          control={
                            <CustomCheckbox
                              checked={filters.macd[option.value] || false}
                              onChange={() =>
                                handleCheckboxChange("macd", option.value)
                              }
                              size="small"
                            />
                          }
                          label={option.label}
                          sx={{
                            color: "text.primary",
                            "& .MuiTypography-root": {
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
                        label="Fast Period"
                        value={filters.macd.fastPeriod || ""}
                        onChange={(e) =>
                          handleInputChange("macd", "fastPeriod", e.target.value)
                        }
                        inputProps={{ min: 1, max: 200 }}
                        InputLabelProps={{ shrink: true }}
                        placeholder="12"
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <CustomTextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Slow Period"
                        value={filters.macd.slowPeriod || ""}
                        onChange={(e) =>
                          handleInputChange("macd", "slowPeriod", e.target.value)
                        }
                        inputProps={{ min: 1, max: 200 }}
                        InputLabelProps={{ shrink: true }}
                        placeholder="26"
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
                    value={filters.macd.condition || "ABOVE"}
                    onChange={(e) =>
                      handleInputChange("macd", "condition", e.target.value)
                    }
                  >
                    {macdConditionOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </CustomTextField>
                </AccordionDetails>
              </DarkAccordion>
            </>
          )}

          {/* 🔥 UI FIX: Moved buttons here - after Volume EMA accordion, inside filters area */}
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

        {/* 🔥 Toast Notification */}
        <Snackbar
          open={toastOpen}
          autoHideDuration={5000}
          onClose={() => setToastOpen(false)}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <Alert
            onClose={() => setToastOpen(false)}
            severity="success"
            variant="filled"
            sx={{
              width: "100%",
              fontSize: "1rem",
              fontWeight: "bold",
              boxShadow: 3,
            }}
          >
            {toastMessage}
          </Alert>
        </Snackbar>
      </Box>
    );
  }
);

FilterSidebar.displayName = "FilterSidebar";

export default memo(FilterSidebar);
