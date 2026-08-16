import mongoose from "mongoose";

const alertSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    conditions: {
      // Min Daily is usually required, but an Independent Divergence Trigger
      // is a complete alert condition on its own and must be creatable without it.
      minDaily: {
        type: String,
        default: "",
      },
      changePercent: {
        timeframe: {
          type: String,
        },
        percentage: {
          type: String,
        },
        direction: {
          type: String,
          enum: ["increase", "decrease", "both"],
          default: "increase",
        },
      },
      alertCount: {
        timeframe: {
          type: String,
        },
        lockUntil: {
          type: Date,
        },
        lastTriggered: {
          type: Date,
        },
      },
      // Additional conditions (optional)
      candle: {
        timeframes: [String],
        condition: {
          type: String,
          default: "CANDLE_ABOVE_OPEN",
        },
      },
      rsiRange: {
        timeframes: [String],
        period: {
          type: String,
          default: "14",
        },
        level: {
          type: String,
          default: "70",
        },
        condition: {
          type: String,
          default: "ABOVE",
        },
      },
      rsiDivergence: {
        timeframes: [String],
        bullish: { type: Boolean, default: false },
        bullishHidden: { type: Boolean, default: false },
        bearish: { type: Boolean, default: false },
        bearishHidden: { type: Boolean, default: false },
        condition: { type: String, default: "" },
      },
      macd: {
        timeframes: [String],
        fastPeriod: {
          type: String,
          default: "12",
        },
        slowPeriod: {
          type: String,
          default: "26",
        },
        condition: {
          type: String,
          default: "ABOVE",
        },
      },
      volume: {
        timeframes: [String],
        condition: {
          type: String,
          default: "INCREASING",
        },
        percentage: String,
      },
      openInterest: {
        timeframes: [String],
        direction: {
          type: String,
          enum: ["INCREASING", "DECREASING", "ABOVE", "BELOW"],
          default: "INCREASING",
        },
        percentage: {
          type: String,
        },
      },
      // Open Interest change against the baseline at the candle boundary.
      // Nested form is required for the "type" key: a bare `type: String`
      // would be read as this field's own Mongoose type, not a sub-field.
      oiChange: {
        timeframes: [String],
        type: {
          type: String,
          enum: ["PERCENTAGE", "VALUE"],
          default: "PERCENTAGE",
        },
        value: {
          type: String,
        },
        direction: {
          type: String,
          enum: ["increase", "decrease", "both"],
          default: "increase",
        },
      },
      // Cumulative Volume Delta. Same nesting rule as oiChange above — "type"
      // has to be declared as a sub-object or Mongoose reads it as this field's
      // own type. Every key the UI can send must be declared here: strict mode
      // silently drops anything undeclared on save, which is exactly how the
      // oiChange condition went missing before.
      cvd: {
        timeframes: [String],
        mode: {
          type: String,
          enum: ["surge", "absorption", "divergence"],
          default: "surge",
        },
        resetAnchor: {
          type: String,
          enum: ["daily", "weekly", "rolling"],
          default: "daily",
        },
        // Surge
        type: {
          type: String,
          enum: ["PERCENTAGE", "VALUE"],
          default: "PERCENTAGE",
        },
        value: { type: String },
        direction: {
          type: String,
          enum: ["increase", "decrease", "both"],
          default: "increase",
        },
        // Absorption
        bullishAbsorption: { type: Boolean, default: false },
        bearishAbsorption: { type: Boolean, default: false },
        // Divergence
        bullish: { type: Boolean, default: false },
        bullishHidden: { type: Boolean, default: false },
        bearish: { type: Boolean, default: false },
        bearishHidden: { type: Boolean, default: false },
        condition: { type: String, default: "previous" },
      },
    },
    status: {
      type: String,
      enum: ["active", "paused", "triggered", "expired"],
      default: "active",
      index: true,
    },

    // Price tracking fields
    baselinePrice: {
      type: Number,
      required: true,
    },
    baselineVolume: {
      type: Number,
    },
    baselineTimestamp: {
      type: Date,
      default: Date.now,
    },
    // Separate timestamp for volume baseline (independent of price baseline)
    volumeBaselineTimestamp: {
      type: Date,
      default: Date.now,
    },
    // New fields for tracking last trigger (without marking as permanently triggered)
    lastTriggeredAt: {
      type: Date,
    },
    lastTriggeredPrice: {
      type: Number,
    },
    lastTriggeredVolume: {
      type: Number,
    },
    notificationSettings: {
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
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
alertSchema.index({ symbol: 1, status: 1 });
alertSchema.index({ userId: 1, status: 1 });
alertSchema.index({ createdAt: -1 });

// Update the updatedAt field before saving

export default mongoose.models.Alert || mongoose.model("Alert", alertSchema);
