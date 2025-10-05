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
        type: String,
        required: true,
      },
      timeframe: {
        type: String,
        required: true,
      },
      percentage: {
        type: String,
        required: true,
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
      ema: {
        timeframes: [String],
        fast: {
          type: String,
          default: "12",
        },
        slow: {
          type: String,
          default: "26",
        },
        condition: {
          type: String,
          default: "ABOVE",
        },
      },
    },
    status: {
      type: String,
      enum: ["active", "paused", "triggered", "expired"],
      default: "active",
      index: true,
    },
    triggered: {
      type: Boolean,
      default: false,
    },
    triggeredAt: {
      type: Date,
    },
    triggeredPrice: {
      type: Number,
    },
    triggeredVolume: {
      type: Number,
    },
    triggeredChange: {
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
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
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
alertSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Alert", alertSchema);
