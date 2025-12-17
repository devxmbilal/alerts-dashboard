import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../utils/mongodb.js";
import Condition from "../../../models/Condition.js";

// GET /api/conditions - Get user's active condition
export async function GET(request) {
    try {
        await connectToMongoDB();

        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { error: "User ID is required" },
                { status: 400 }
            );
        }

        const condition = await Condition.findOne({ userId });

        return NextResponse.json({
            success: true,
            data: condition || null,
        });
    } catch (error) {
        console.error("Error fetching condition:", error);
        return NextResponse.json(
            { error: "Failed to fetch condition" },
            { status: 500 }
        );
    }
}

// POST /api/conditions - Save/Update user's condition (replaces old one)
export async function POST(request) {
    try {
        await connectToMongoDB();

        const body = await request.json();
        const { userId, conditions } = body;

        if (!userId) {
            return NextResponse.json(
                { error: "User ID is required" },
                { status: 400 }
            );
        }

        // Build condition document from alert conditions
        // IMPORTANT: Reset ALL fields first to ensure old conditions are removed
        const conditionData = {
            userId,
            lastUpdatedAt: new Date(),
            // Reset all condition fields to disabled/empty
            changePercent: { enabled: false },
            alertCount: { enabled: false },
            candle: { enabled: false, timeframes: [] },
            rsiRange: { enabled: false, timeframes: [] },
            volume: { enabled: false, timeframes: [] },
            minDaily: { enabled: false },
        };

        // Now apply only the NEW conditions (overwriting the reset values)
        if (conditions.changePercent) {
            conditionData.changePercent = {
                enabled: true,
                percentage: conditions.changePercent.percentage,
                timeframe: conditions.changePercent.timeframe,
                direction: conditions.changePercent.direction,
            };
        }

        if (conditions.alertCount) {
            conditionData.alertCount = {
                enabled: true,
                timeframe: conditions.alertCount.timeframe,
            };
        }

        if (conditions.candle) {
            conditionData.candle = {
                enabled: true,
                condition: conditions.candle.condition,
                timeframes: conditions.candle.timeframes || [],
            };
        }

        if (conditions.rsiRange) {
            conditionData.rsiRange = {
                enabled: true,
                condition: conditions.rsiRange.condition,
                level: conditions.rsiRange.level,
                period: conditions.rsiRange.period,
                timeframes: conditions.rsiRange.timeframes || [],
            };
        }

        if (conditions.volume) {
            conditionData.volume = {
                enabled: true,
                condition: conditions.volume.condition,
                percentage: conditions.volume.percentage,
                timeframes: conditions.volume.timeframes || [],
            };
        }

        if (conditions.minDaily) {
            conditionData.minDaily = {
                enabled: true,
                value: conditions.minDaily,
            };
        }

        // Upsert: Replace existing or create new
        const savedCondition = await Condition.findOneAndUpdate(
            { userId },
            conditionData,
            { upsert: true, new: true }
        );

        console.log(`✅ Condition saved for user ${userId}`);

        return NextResponse.json({
            success: true,
            data: savedCondition,
        });
    } catch (error) {
        console.error("Error saving condition:", error);
        return NextResponse.json(
            { error: "Failed to save condition" },
            { status: 500 }
        );
    }
}
