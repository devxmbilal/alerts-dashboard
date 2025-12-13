#!/usr/bin/env node

import { connectToMongoDB } from '../utils/mongodb.js';
import Alert from '../models/Alert.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixInvalidMinDailyAlerts() {
    try {
        console.log('🚀 Starting cleanup of invalid minDaily alerts...\n');

        await connectToMongoDB();
        console.log('✅ Connected to MongoDB\n');

        // Find all active alerts
        const alerts = await Alert.find({ status: 'active' });
        console.log(`📊 Found ${alerts.length} active alerts to check\n`);

        let checked = 0;
        let deleted = 0;
        let valid = 0;
        const invalidAlerts = [];

        for (const alert of alerts) {
            checked++;
            const minDaily = parseFloat(alert.conditions?.minDaily);
            const symbol = alert.symbol;

            // Check if invalid
            if (isNaN(minDaily) || minDaily <= 0) {
                console.log(`❌ Alert ${checked}/${alerts.length}: ${symbol}`);
                console.log(`   Invalid minDaily: "${alert.conditions?.minDaily}" (parsed as ${minDaily})`);
                console.log(`   User: ${alert.userId}`);
                console.log(`   Alert ID: ${alert._id}`);

                invalidAlerts.push({
                    id: alert._id,
                    symbol: symbol,
                    userId: alert.userId,
                    minDaily: alert.conditions?.minDaily,
                    parsedValue: minDaily
                });

                // Delete invalid alert
                await Alert.findByIdAndDelete(alert._id);
                deleted++;
                console.log(`   🗑️ Deleted\n`);
            } else {
                valid++;
                if (checked % 50 === 0) {
                    console.log(`✅ Checked ${checked}/${alerts.length} alerts (${valid} valid, ${deleted} deleted)`);
                }
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ CLEANUP COMPLETE\n');
        console.log(`📊 Statistics:`);
        console.log(`   Total alerts checked: ${checked}`);
        console.log(`   Valid alerts: ${valid}`);
        console.log(`   Invalid alerts deleted: ${deleted}`);

        if (invalidAlerts.length > 0) {
            console.log(`\n📋 Invalid Alerts Summary:`);

            // Group by user
            const byUser = {};
            invalidAlerts.forEach(alert => {
                if (!byUser[alert.userId]) {
                    byUser[alert.userId] = [];
                }
                byUser[alert.userId].push(alert);
            });

            for (const [userId, userAlerts] of Object.entries(byUser)) {
                console.log(`\n   User: ${userId}`);
                console.log(`   Invalid alerts: ${userAlerts.length}`);
                userAlerts.forEach(alert => {
                    console.log(`     - ${alert.symbol}: minDaily="${alert.minDaily}"`);
                });
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ Done! You can now restart the alert workers.\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error during cleanup:', error);
        console.error('Error stack:', error.stack);
        process.exit(1);
    }
}

// Run the fix
fixInvalidMinDailyAlerts();
