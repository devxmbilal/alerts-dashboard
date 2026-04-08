
import dotenv from "dotenv";
dotenv.config();

// Simulation of the RealTimeAlertProcessor logic
function calculateChange(livePrice, baselinePrice) {
    const change = ((livePrice - baselinePrice) / baselinePrice) * 100;
    return change;
}

function checkCondition(livePrice, baselinePrice, requiredChange, direction) {
    const change = calculateChange(livePrice, baselinePrice);
    const absoluteChange = Math.abs(change);

    console.log(`Checking: Live=${livePrice}, Baseline=${baselinePrice}, Change=${change.toFixed(3)}%, Required=${requiredChange}%`);

    if (direction === "increase" && change < 0) {
        return { passed: false, reason: "price_not_increased" };
    }
    if (direction === "decrease" && change > 0) {
        return { passed: false, reason: "price_not_decreased" };
    }

    if (absoluteChange < requiredChange) {
        return { passed: false, reason: `${absoluteChange.toFixed(3)}% < ${requiredChange}%` };
    }

    return { passed: true, reason: `${absoluteChange.toFixed(3)}% >= ${requiredChange}%` };
}

// Test case 1: Normal 5 min 2% increase
console.log("--- Test Case 1: Normal ---");
console.log(checkCondition(102.1, 100, 2, "increase"));

// Test case 2: Nano-baseline (potential bug?)
console.log("\n--- Test Case 2: Very small baseline ---");
console.log(checkCondition(0.0000021, 0.0000020, 2, "increase")); // 5% change

// Test case 3: NaN baseline (potential bug?)
console.log("\n--- Test Case 3: NaN comparison bug ---");
const badBaseline = NaN;
const livePrice = 100;
const reqChange = 2;
const absChange = Math.abs(((livePrice - badBaseline) / badBaseline) * 100);
console.log(`absChange is ${absChange}`);
if (absChange < reqChange) {
    console.log("Would FAIL check (absChange < reqChange)");
} else {
    console.log("Would PASS check (absChange >= reqChange) <- BUG if NaN!");
}
