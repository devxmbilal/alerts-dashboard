import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

async function testLogin() {
    try {
        await mongoose.connect('mongodb://localhost:27017/crypto-alerts');
        console.log('Connected to MongoDB');

        // Find admin user
        const user = await mongoose.connection.db.collection('users').findOne({ username: 'admin' });

        if (!user) {
            console.log('❌ User NOT found');
            process.exit(1);
        }

        console.log('✅ User found:', user.username);
        console.log('Email:', user.email);
        console.log('isActive:', user.isActive);
        console.log('Password hash:', user.password.substring(0, 20) + '...');

        // Test password
        const match = await bcrypt.compare('admin123', user.password);
        console.log('Password match:', match);

        if (match) {
            console.log('🎉 LOGIN SHOULD WORK!');
        } else {
            console.log('❌ Password does NOT match - need to reset');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

testLogin();
