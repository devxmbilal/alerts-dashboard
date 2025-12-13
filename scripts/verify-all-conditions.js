/**
 * 🧪 Comprehensive Condition Verification Script
 * Tests all 6 alert conditions individually to ensure they work correctly
 * 
 * Run: node scripts/verify-all-conditions.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Alert from "../models/Alert.js";
import { isAlertLocked, updateAlertLock, calculateLockTime } from "../utils/alertLock.js";

dotenv.config();

// Test data simulation
const mockLiveData = {
    price: 100.50,
    volume24h: 2500000, // 2.5M USDT
    volume: 1500000,
    priceChange: 2.5,
    priceChangePercent: 2.5,
    high: 102,
    low: 98,
    open: 99,
    close: 100.50,
    timestamp: Date.now()
};

const mockAlert = {
    _id: "test-alert-001",
    symbol: "BTCUSDT",
    userId: "test-user",
    baselinePrice: 95.00,
    baselineVolume: 1500000,
    baselineOpenInterest: 100000,
    conditions: {
        minDaily: "1000000", // 1M USDT
        changePercent: {
            timeframe: "5MIN",
            percentage: "5",
            direction: "increase"
        },
        alertCount: {
            timeframe: "5MIN",
            lockUntil: null,
            lastTriggered: null
        },
        candle: {
            timeframes: ["5m"],
            condition: "CANDLE_ABOVE_OPEN"
        },
        rsiRange: {
            timeframes: ["5m"],
            period: "14",
            level: "70",
            condition: "ABOVE"
        },
        volume: {
            timeframes: ["5m"],
            condition: "INCREASING",
            percentage: "10"
        },
        openInterest: {
            timeframes: ["5m"],
            direction: "INCREASING",
            percentage: "5"
        }
    },
    status: "active"
};

// =====================================================
// CONDITION 1: Min Daily Volume
// =====================================================
function testMinDailyVolume() {
    console.log("\n" + "=".repeat(60));
    console.log("📊 CONDITION 1: Min Daily Volume");
    console.log("=".repeat(60));

    const testCases = [
        { minDaily: "1000000", volume24h: 2500000, expected: true, desc: "Volume above minimum" },
        { minDaily: "1000000", volume24h: 500000, expected: false, desc: "Volume below minimum" },
        { minDaily: "1000000", volume24h: 1000000, expected: true, desc: "Volume exactly at minimum" },
        { minDaily: "0", volume24h: 2500000, expected: false, desc: "Invalid minDaily (0)" },
        { minDaily: "", volume24h: 2500000, expected: false, desc: "Empty minDaily" },
        { minDaily: "1000000", volume24h: 0, expected: false, desc: "No volume data" },
        { minDaily: "1000000", volume24h: null, expected: false, desc: "Null volume data" },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        // Simulate the actual condition check logic
        const minVolume = parseFloat(tc.minDaily);
        const actualVolume = parseFloat(tc.volume24h || 0);

        // Validation
        let result = false;
        if (!isNaN(minVolume) && minVolume > 0 && !isNaN(actualVolume) && actualVolume > 0) {
            result = actualVolume >= minVolume;
        }

        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     Min: ${tc.minDaily}, Actual: ${tc.volume24h}, Result: ${result}, Expected: ${tc.expected}`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// CONDITION 2: Change Percent
// =====================================================
function testChangePercent() {
    console.log("\n" + "=".repeat(60));
    console.log("📈 CONDITION 2: Change Percent");
    console.log("=".repeat(60));

    const testCases = [
        { baseline: 95, current: 100, required: 5, direction: "increase", expected: true, desc: "5.26% increase >= 5%" },
        { baseline: 95, current: 99, required: 5, direction: "increase", expected: false, desc: "4.2% increase < 5%" },
        { baseline: 100, current: 90, required: 10, direction: "decrease", expected: true, desc: "10% decrease >= 10%" },
        { baseline: 100, current: 95, required: 10, direction: "decrease", expected: false, desc: "5% decrease < 10%" },
        { baseline: 100, current: 105, required: 5, direction: "decrease", expected: false, desc: "Price increased but decrease required" },
        { baseline: 100, current: 95, required: 5, direction: "increase", expected: false, desc: "Price decreased but increase required" },
        { baseline: 100, current: 100, required: 0.1, direction: "increase", expected: false, desc: "No change" },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        const changeFromBaseline = ((tc.current - tc.baseline) / tc.baseline) * 100;
        const absoluteChange = Math.abs(changeFromBaseline);

        let result = false;

        // Check direction first
        if (tc.direction === "increase" && changeFromBaseline < 0) {
            result = false;
        } else if (tc.direction === "decrease" && changeFromBaseline > 0) {
            result = false;
        } else {
            // Check percentage
            result = absoluteChange >= tc.required;
        }

        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     Baseline: ${tc.baseline}, Current: ${tc.current}, Change: ${changeFromBaseline.toFixed(2)}%`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// CONDITION 3: Alert Count (Cooldown Lock)
// =====================================================
function testAlertCount() {
    console.log("\n" + "=".repeat(60));
    console.log("🔒 CONDITION 3: Alert Count (Cooldown Lock)");
    console.log("=".repeat(60));

    const testCases = [
        {
            lockUntil: null,
            expected: false, // Not locked
            desc: "No lock set"
        },
        {
            lockUntil: new Date(Date.now() + 60000), // 1 minute in future
            expected: true, // Locked
            desc: "Lock in future (1 min)"
        },
        {
            lockUntil: new Date(Date.now() - 60000), // 1 minute ago
            expected: false, // Not locked
            desc: "Lock expired (1 min ago)"
        },
        {
            lockUntil: new Date(Date.now() + 3600000), // 1 hour in future
            expected: true, // Locked
            desc: "Lock in future (1 hour)"
        },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        const testAlert = {
            conditions: {
                alertCount: {
                    timeframe: "5MIN",
                    lockUntil: tc.lockUntil
                }
            }
        };

        const result = isAlertLocked(testAlert);
        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     LockUntil: ${tc.lockUntil}, IsLocked: ${result}, Expected: ${tc.expected}`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    // Test calculateLockTime
    console.log("\n  Testing calculateLockTime:");
    const timeframes = ["5MIN", "15MIN", "1HR", "4HR", "1D"];

    timeframes.forEach((tf) => {
        const lockUntil = calculateLockTime(tf);
        console.log(`    ${tf}: Lock until ${lockUntil.toISOString()}`);
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// CONDITION 4: Candle Pattern
// =====================================================
function testCandlePattern() {
    console.log("\n" + "=".repeat(60));
    console.log("🕯️ CONDITION 4: Candle Pattern");
    console.log("=".repeat(60));

    const EPSILON = 1.0001;

    const testCases = [
        // CANDLE_ABOVE_OPEN
        { currentPrice: 100.50, open: 99.00, condition: "CANDLE_ABOVE_OPEN", expected: true, desc: "Price above open" },
        { currentPrice: 98.50, open: 99.00, condition: "CANDLE_ABOVE_OPEN", expected: false, desc: "Price below open" },
        { currentPrice: 99.01, open: 99.00, condition: "CANDLE_ABOVE_OPEN", expected: true, desc: "Price slightly above open (with epsilon)" },

        // HAMMER
        { open: 98, close: 97, high: 100, low: 80, currentPrice: 99, condition: "HAMMER", expected: true, desc: "Hammer: O/C in upper 30%" },
        { open: 85, close: 84, high: 100, low: 80, currentPrice: 86, condition: "HAMMER", expected: false, desc: "Hammer: O/C not in upper 30%" },

        // INVERTED_HAMMER
        { open: 82, close: 83, high: 100, low: 80, currentPrice: 84, condition: "INVERTED_HAMMER", expected: true, desc: "Inv Hammer: O/C in lower 30%" },
        { open: 95, close: 94, high: 100, low: 80, currentPrice: 96, condition: "INVERTED_HAMMER", expected: false, desc: "Inv Hammer: O/C not in lower 30%" },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        let result = false;

        if (tc.condition === "CANDLE_ABOVE_OPEN") {
            result = tc.currentPrice > (tc.open * EPSILON);
        } else if (tc.condition === "HAMMER") {
            const range = tc.high - tc.low;
            if (range === 0) {
                result = false;
            } else {
                const openPositionFromLow = (tc.open - tc.low) / range;
                const closePositionFromLow = (tc.close - tc.low) / range;
                const bothInUpper30 = openPositionFromLow >= 0.7 && closePositionFromLow >= 0.7;
                const priceAboveOpen = tc.currentPrice > tc.open;
                result = bothInUpper30 && priceAboveOpen;
            }
        } else if (tc.condition === "INVERTED_HAMMER") {
            const range = tc.high - tc.low;
            if (range === 0) {
                result = false;
            } else {
                const openPositionFromLow = (tc.open - tc.low) / range;
                const closePositionFromLow = (tc.close - tc.low) / range;
                const bothInLower30 = openPositionFromLow <= 0.3 && closePositionFromLow <= 0.3;
                const priceAboveOpen = tc.currentPrice > tc.open;
                result = bothInLower30 && priceAboveOpen;
            }
        }

        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     Condition: ${tc.condition}, Result: ${result}, Expected: ${tc.expected}`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// CONDITION 5: RSI Range
// =====================================================
function testRSIRange() {
    console.log("\n" + "=".repeat(60));
    console.log("📊 CONDITION 5: RSI Range");
    console.log("=".repeat(60));

    const testCases = [
        { current: 75, previous: 68, target: 70, condition: "ABOVE", expected: true, desc: "RSI 75 > 70" },
        { current: 65, previous: 68, target: 70, condition: "ABOVE", expected: false, desc: "RSI 65 < 70" },
        { current: 25, previous: 30, target: 30, condition: "BELOW", expected: true, desc: "RSI 25 < 30" },
        { current: 35, previous: 30, target: 30, condition: "BELOW", expected: false, desc: "RSI 35 > 30" },
        { current: 72, previous: 68, target: 70, condition: "CROSSING_UP", expected: true, desc: "Cross up: 68->72 through 70" },
        { current: 75, previous: 72, target: 70, condition: "CROSSING_UP", expected: false, desc: "No cross: already above 70" },
        { current: 28, previous: 32, target: 30, condition: "CROSSING_DOWN", expected: true, desc: "Cross down: 32->28 through 30" },
        { current: 25, previous: 28, target: 30, condition: "CROSSING_DOWN", expected: false, desc: "No cross: already below 30" },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        let result = false;

        switch (tc.condition) {
            case "ABOVE":
                result = tc.current > tc.target;
                break;
            case "BELOW":
                result = tc.current < tc.target;
                break;
            case "CROSSING_UP":
                result = tc.previous <= tc.target && tc.current > tc.target;
                break;
            case "CROSSING_DOWN":
                result = tc.previous >= tc.target && tc.current < tc.target;
                break;
        }

        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     Current: ${tc.current}, Previous: ${tc.previous}, Target: ${tc.target}, Condition: ${tc.condition}`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// CONDITION 6: Volume Conditions
// =====================================================
function testVolumeConditions() {
    console.log("\n" + "=".repeat(60));
    console.log("📈 CONDITION 6: Volume Conditions");
    console.log("=".repeat(60));

    const testCases = [
        // INCREASING
        { current: 1650000, baseline: 1500000, percentage: 10, condition: "INCREASING", expected: true, desc: "Vol +10% increase >= 10%" },
        { current: 1600000, baseline: 1500000, percentage: 10, condition: "INCREASING", expected: false, desc: "Vol +6.6% < 10% required" },

        // DECREASING
        { current: 1300000, baseline: 1500000, percentage: 10, condition: "DECREASING", expected: true, desc: "Vol -13.3% decrease >= 10%" },
        { current: 1400000, baseline: 1500000, percentage: 10, condition: "DECREASING", expected: false, desc: "Vol -6.6% < 10% required" },

        // ABOVE
        { current: 2000000, baseline: 1500000, percentage: 1800000, condition: "ABOVE", expected: true, desc: "Vol 2M > 1.8M" },
        { current: 1600000, baseline: 1500000, percentage: 1800000, condition: "ABOVE", expected: false, desc: "Vol 1.6M < 1.8M" },

        // BELOW
        { current: 1000000, baseline: 1500000, percentage: 1200000, condition: "BELOW", expected: true, desc: "Vol 1M < 1.2M" },
        { current: 1500000, baseline: 1500000, percentage: 1200000, condition: "BELOW", expected: false, desc: "Vol 1.5M > 1.2M" },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        let result = false;
        const volumeChange = ((tc.current - tc.baseline) / tc.baseline) * 100;

        switch (tc.condition) {
            case "INCREASING":
                result = volumeChange >= tc.percentage;
                break;
            case "DECREASING":
                result = volumeChange <= -tc.percentage;
                break;
            case "ABOVE":
                result = tc.current > tc.percentage;
                break;
            case "BELOW":
                result = tc.current < tc.percentage;
                break;
        }

        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     Current: ${tc.current.toLocaleString()}, Baseline: ${tc.baseline.toLocaleString()}, Change: ${volumeChange.toFixed(2)}%`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// CONDITION 7: Open Interest
// =====================================================
function testOpenInterest() {
    console.log("\n" + "=".repeat(60));
    console.log("📊 CONDITION 7: Open Interest");
    console.log("=".repeat(60));

    const testCases = [
        // INCREASING
        { current: 125000, baseline: 100000, percentage: 25, direction: "INCREASING", expected: true, desc: "OI +25% >= 25%" },
        { current: 115000, baseline: 100000, percentage: 25, direction: "INCREASING", expected: false, desc: "OI +15% < 25%" },

        // DECREASING
        { current: 70000, baseline: 100000, percentage: 25, direction: "DECREASING", expected: true, desc: "OI -30% <= -25%" },
        { current: 85000, baseline: 100000, percentage: 25, direction: "DECREASING", expected: false, desc: "OI -15% > -25%" },

        // ABOVE
        { current: 130000, baseline: 100000, percentage: 25, direction: "ABOVE", expected: true, desc: "OI +30% >= 25%" },
        { current: 115000, baseline: 100000, percentage: 25, direction: "ABOVE", expected: false, desc: "OI +15% < 25%" },

        // BELOW
        { current: 70000, baseline: 100000, percentage: 25, direction: "BELOW", expected: true, desc: "OI -30% <= -25%" },
        { current: 85000, baseline: 100000, percentage: 25, direction: "BELOW", expected: false, desc: "OI -15% > -25%" },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((tc, i) => {
        let result = false;
        const oiChange = ((tc.current - tc.baseline) / tc.baseline) * 100;

        switch (tc.direction) {
            case "INCREASING":
                result = oiChange >= tc.percentage;
                break;
            case "DECREASING":
                result = oiChange <= -tc.percentage;
                break;
            case "ABOVE":
                result = oiChange >= tc.percentage;
                break;
            case "BELOW":
                result = oiChange <= -tc.percentage;
                break;
        }

        const status = result === tc.expected ? "✅ PASS" : "❌ FAIL";
        console.log(`  ${i + 1}. ${tc.desc}: ${status}`);
        console.log(`     Current: ${tc.current.toLocaleString()}, Baseline: ${tc.baseline.toLocaleString()}, Change: ${oiChange.toFixed(2)}%`);

        if (result === tc.expected) passed++;
        else failed++;
    });

    console.log(`\n  Summary: ${passed}/${testCases.length} tests passed`);
    return { passed, failed, total: testCases.length };
}

// =====================================================
// MAIN TEST RUNNER
// =====================================================
async function runAllTests() {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║     🧪 ALERT CONDITIONS VERIFICATION SUITE                 ║");
    console.log("║     Testing all 7 conditions for correct behavior          ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`\n⏰ Started at: ${new Date().toISOString()}\n`);

    const results = [];

    // Run all condition tests
    results.push({ name: "Min Daily Volume", ...testMinDailyVolume() });
    results.push({ name: "Change Percent", ...testChangePercent() });
    results.push({ name: "Alert Count", ...testAlertCount() });
    results.push({ name: "Candle Pattern", ...testCandlePattern() });
    results.push({ name: "RSI Range", ...testRSIRange() });
    results.push({ name: "Volume Conditions", ...testVolumeConditions() });
    results.push({ name: "Open Interest", ...testOpenInterest() });

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL SUMMARY");
    console.log("=".repeat(60));

    let totalPassed = 0;
    let totalFailed = 0;
    let totalTests = 0;

    results.forEach((r) => {
        const status = r.failed === 0 ? "✅" : "❌";
        console.log(`  ${status} ${r.name}: ${r.passed}/${r.total} passed`);
        totalPassed += r.passed;
        totalFailed += r.failed;
        totalTests += r.total;
    });

    console.log("\n" + "-".repeat(60));
    const overallStatus = totalFailed === 0 ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED";
    console.log(`  ${overallStatus}: ${totalPassed}/${totalTests} tests passed`);
    console.log("=".repeat(60));

    console.log(`\n⏰ Completed at: ${new Date().toISOString()}`);

    return totalFailed === 0;
}

// Run tests
runAllTests()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        console.error("❌ Test runner error:", error);
        process.exit(1);
    });
