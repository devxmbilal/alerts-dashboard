"use client";

import React from "react";
import { Box, Typography, Chip, Button, IconButton } from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  Email as EmailIcon,
  Close as CloseIcon,
} from "@mui/icons-material";

const AlertHistoryItem = ({ alert, onClear, onEmail }) => {
  const formatPrice = (price) => {
    if (!price) return "$0.00";
    return `$${parseFloat(price).toFixed(3)}`;
  };

  const formatTime = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <Box
      sx={{
        p: 2,
        mb: 2,
        backgroundColor: "#1a1a1a",
        borderRadius: 1,
        border: "1px solid #333",
      }}
    >
      {/* Header with condition met indicator */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <CheckCircleIcon sx={{ color: "#2196f3", fontSize: 20 }} />
        <Typography variant="body2" sx={{ color: "white", fontWeight: 600 }}>
          Combined conditions met
        </Typography>
      </Box>

      {/* Conditions Applied */}
      <Typography
        variant="body2"
        sx={{ color: "#888", mb: 1, fontSize: "0.85rem" }}
      >
        {alert.conditionsText || "Conditions met"}
      </Typography>

      {/* Target/Actual Values */}
      <Typography
        variant="body2"
        sx={{ color: "#888", mb: 1, fontSize: "0.85rem" }}
      >
        Target: {alert.targetValue || 1} | Actual:{" "}
        {alert.actualValue?.toFixed(6) || "N/A"} | {alert.timeframe || "5MIN"}
      </Typography>

      {/* Price and 24h Change */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="body2" sx={{ color: "white" }}>
          Price: {formatPrice(alert.triggeredPrice)}
        </Typography>
        <Typography variant="body2" sx={{ color: "white" }}>
          24h Change:{" "}
          {alert.price24hChange
            ? `${parseFloat(alert.price24hChange).toFixed(3)}%`
            : "N/A"}
        </Typography>
      </Box>

      {/* Time and Date */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="body2" sx={{ color: "#888" }}>
          Time: {formatTime(alert.triggeredAt)}
        </Typography>
        <Typography variant="body2" sx={{ color: "#888" }}>
          Date:{" "}
          {alert.triggeredAt
            ? new Date(alert.triggeredAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "2-digit",
              })
            : "N/A"}
        </Typography>
      </Box>

      {/* Actions */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Button
          variant="outlined"
          size="small"
          startIcon={<EmailIcon />}
          onClick={() => onEmail?.(alert)}
          sx={{
            color: "#2196f3",
            borderColor: "#2196f3",
            fontSize: "0.75rem",
            textTransform: "none",
          }}
        >
          EMAIL
        </Button>

        <IconButton
          size="small"
          onClick={() => onClear?.(alert.id)}
          sx={{ color: "#888" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};

export default AlertHistoryItem;
