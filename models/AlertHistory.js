import mongoose from "mongoose";

const alertHistorySchema = new mongoose.Schema(
  {
    alertId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Alert",
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      index: true,
    },
    alertConditions: {
      // Store the original alert conditions
      minDaily: String,
      changePercent: {
        timeframe: String,
        percentage: String,
      },
      alertCount: {
        timeframe: String,
        lockUntil: Date,
        lastTriggered: Date,
      },
      candle: {
        timeframes: [String],
        condition: String,
      },
      rsiRange: {
        timeframes: [String],
        period: String,
        level: String,
        condition: String,
      },
      volume: {
        timeframes: [String],
        condition: String,
        percentage: String,
      },
      ema: {
        timeframes: [String],
        fast: String,
        slow: String,
        condition: String,
      },
    },
    conditions: {
      type: String,
      required: true,
    },
    triggerData: {
      // Data when alert was triggered
      price: {
        type: Number,
        required: true,
      },
      priceChange: {
        type: Number,
        required: true,
      },
      priceChangePercent: {
        type: Number,
        required: true,
      },
      volume24h: {
        type: Number,
        required: true,
      },
      high: {
        type: Number,
        required: true,
      },
      low: {
        type: Number,
        required: true,
      },
      open: {
        type: Number,
        required: true,
      },
      close: {
        type: Number,
        required: true,
      },
      timestamp: {
        type: Number,
        required: true,
      },
    },
    baselineData: {
      // Baseline data when alert was created
      baselinePrice: {
        type: Number,
        required: true,
      },
      baselineVolume: {
        type: Number,
      },
      baselineTimestamp: {
        type: Date,
        required: true,
      },
      changeFromBaseline: {
        type: Number,
        required: true,
      },
      changeFromBaselinePercent: {
        type: Number,
        required: true,
      },
    },
    triggeredAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    notificationSent: {
      email: {
        type: Boolean,
        default: false,
      },
      telegram: {
        type: Boolean,
        default: false,
      },
      webhook: {
        type: Boolean,
        default: false,
      },
    },
    status: {
      type: String,
      enum: ["triggered", "acknowledged", "dismissed"],
      default: "triggered",
      index: true,
    },
    acknowledgedAt: {
      type: Date,
    },
    dismissedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
alertHistorySchema.index({ userId: 1, createdAt: -1 });
alertHistorySchema.index({ symbol: 1, createdAt: -1 });
alertHistorySchema.index({ status: 1, createdAt: -1 });
alertHistorySchema.index({ triggeredAt: -1 });
alertHistorySchema.index({ alertId: 1, triggeredAt: -1 });

export default mongoose.models.AlertHistory ||
  mongoose.model("AlertHistory", alertHistorySchema);
