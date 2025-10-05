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
      changePercent: String,
      timeframe: String,
      percentage: String,
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
    triggerData: {
      // Data when alert was triggered
      price: {
        type: Number,
        required: true,
      },
      volume: {
        type: Number,
        required: true,
      },
      priceChangePercent: {
        type: Number,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
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
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
alertHistorySchema.index({ userId: 1, createdAt: -1 });
alertHistorySchema.index({ symbol: 1, createdAt: -1 });
alertHistorySchema.index({ alertId: 1 });
alertHistorySchema.index({ status: 1, createdAt: -1 });

// Update the updatedAt field before saving
alertHistorySchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("AlertHistory", alertHistorySchema);
