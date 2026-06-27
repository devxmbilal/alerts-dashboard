import mongoose from "mongoose";

const conditionSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true, // Only ONE condition per user
            index: true,
        },
        // Change Percent Condition
        changePercent: {
            enabled: { type: Boolean, default: false },
            percentage: { type: String },
            timeframe: { type: String },
            direction: { type: String }, // increase, decrease, both
        },
        // Alert Count (Cooldown)
        alertCount: {
            enabled: { type: Boolean, default: false },
            timeframe: { type: String },
        },
        // Candle Condition
        candle: {
            enabled: { type: Boolean, default: false },
            condition: { type: String }, // CANDLE_ABOVE_OPEN, HAMMER, etc.
            timeframes: [{ type: String }],
        },
        // RSI Condition
        rsiRange: {
            enabled: { type: Boolean, default: false },
            condition: { type: String }, // ABOVE, BELOW, CROSSING_UP, CROSSING_DOWN
            level: { type: String },
            period: { type: String },
            timeframes: [{ type: String }],
        },
        // MACD Condition (Fast EMA vs Slow EMA)
        macd: {
            enabled: { type: Boolean, default: false },
            condition: { type: String }, // ABOVE, BELOW, CROSSING_UP, CROSSING_DOWN
            fastPeriod: { type: String },
            slowPeriod: { type: String },
            timeframes: [{ type: String }],
        },
        // Volume Condition
        volume: {
            enabled: { type: Boolean, default: false },
            condition: { type: String }, // INCREASING, DECREASING
            percentage: { type: String },
            timeframes: [{ type: String }],
        },
        // Minimum Daily Volume
        minDaily: {
            enabled: { type: Boolean, default: false },
            value: { type: String },
        },
        // Last updated timestamp
        lastUpdatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// Ensure unique userId
conditionSchema.index({ userId: 1 }, { unique: true });

export default mongoose.models.Condition ||
    mongoose.model("Condition", conditionSchema);
