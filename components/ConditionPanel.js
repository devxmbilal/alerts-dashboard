"use client";

import React, { useState, useEffect } from "react";
import { Box, Chip, Typography, Skeleton } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import CandlestickChartIcon from "@mui/icons-material/CandlestickChart";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";

const ConditionPanel = ({ userId }) => {
    const [condition, setCondition] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (userId) {
            fetchCondition();
        }
    }, [userId]);

    const fetchCondition = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/conditions?userId=${userId}`);
            if (response.ok) {
                const data = await response.json();
                setCondition(data.data);
            }
        } catch (error) {
            console.error("Error fetching condition:", error);
        } finally {
            setLoading(false);
        }
    };

    // Build condition chips
    const buildConditionChips = () => {
        if (!condition) return [];

        const chips = [];

        // Change Percent
        if (condition.changePercent?.enabled) {
            const { percentage, timeframe, direction } = condition.changePercent;
            const dirIcon = direction === "increase" ? "📈" : direction === "decrease" ? "📉" : "↕️";
            chips.push({
                label: `${dirIcon} ${percentage}% (${timeframe})`,
                color: "primary",
                icon: <TrendingUpIcon />,
            });
        }

        // Alert Count (Cooldown)
        if (condition.alertCount?.enabled) {
            chips.push({
                label: `⏰ Cooldown: ${condition.alertCount.timeframe}`,
                color: "secondary",
                icon: <AccessTimeIcon />,
            });
        }

        // Candle Condition
        if (condition.candle?.enabled) {
            const timeframes = condition.candle.timeframes?.join(", ") || "";
            chips.push({
                label: `🕯️ ${condition.candle.condition} [${timeframes}]`,
                color: "warning",
                icon: <CandlestickChartIcon />,
            });
        }

        // RSI Condition
        if (condition.rsiRange?.enabled) {
            const timeframes = condition.rsiRange.timeframes?.join(", ") || "";
            chips.push({
                label: `📊 RSI ${condition.rsiRange.condition} ${condition.rsiRange.level} [${timeframes}]`,
                color: "info",
                icon: <ShowChartIcon />,
            });
        }

        // Volume Condition
        if (condition.volume?.enabled) {
            const timeframes = condition.volume.timeframes?.join(", ") || "";
            const percent = condition.volume.percentage ? `${condition.volume.percentage}%` : "";
            chips.push({
                label: `📉 Volume ${condition.volume.condition} ${percent} [${timeframes}]`,
                color: "success",
                icon: <VolumeUpIcon />,
            });
        }

        // Minimum Daily Volume
        if (condition.minDaily?.enabled) {
            chips.push({
                label: `💰 Min Volume: ${Number(condition.minDaily.value).toLocaleString()}`,
                color: "default",
                icon: <AttachMoneyIcon />,
            });
        }

        return chips;
    };

    if (loading) {
        return (
            <Box sx={{ p: 1, display: "flex", gap: 1 }}>
                <Skeleton variant="rounded" width={120} height={32} />
                <Skeleton variant="rounded" width={150} height={32} />
                <Skeleton variant="rounded" width={100} height={32} />
            </Box>
        );
    }

    const chips = buildConditionChips();

    if (chips.length === 0) {
        return (
            <Box
                sx={{
                    p: 1.5,
                    backgroundColor: "background.paper",
                    borderRadius: 1,
                    border: 1,
                    borderColor: "divider",
                }}
            >
                <Typography variant="body2" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                    No conditions set. Create an alert to set conditions.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                p: 1.5,
                backgroundColor: "background.paper",
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                display: "flex",
                flexWrap: "wrap",
                gap: 1,
                alignItems: "center",
            }}
        >
            <Typography
                variant="body2"
                sx={{
                    color: "text.secondary",
                    fontWeight: 600,
                    mr: 1,
                }}
            >
                Active Conditions:
            </Typography>
            {chips.map((chip, index) => (
                <Chip
                    key={index}
                    label={chip.label}
                    color={chip.color}
                    size="small"
                    sx={{
                        fontWeight: 500,
                        fontSize: "0.75rem",
                    }}
                />
            ))}
        </Box>
    );
};

export default ConditionPanel;
