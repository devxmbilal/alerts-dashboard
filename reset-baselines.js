// Script to reset alert baselines when conditions change
// Run this when you update alert conditions

const RealTimeAlertProcessor =
  require("./services/RealTimeAlertProcessor.js").default;

console.log("🔄 Resetting all alert baselines...");
RealTimeAlertProcessor.resetAllBaselines();
console.log(
  "✅ All baselines reset! New conditions will use current prices as baseline."
);
console.log("");
console.log("Now when alerts check conditions, they will:");
console.log("1. Set new baseline from current price");
console.log("2. Track change from new baseline");
console.log("3. Trigger when change >= required percentage");
console.log("");
console.log("Example:");
console.log("- Current price: $0.244");
console.log("- Required change: 1%");
console.log("- Alert will trigger when price reaches: $0.24644 (0.244 + 1%)");

