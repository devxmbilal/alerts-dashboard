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
      // Basic conditions (required)
      minDaily: {
        type: String,
        required: true,
      },
      changePercent: {
        timeframe: {
          type: String,
          required: true,
        },
        percentage: {
          type: String,
          required: true,
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
    baselineOpenInterest: {
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
