import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

async function resetPassword() {
    try {
        await mongoose.connect('mongodb://localhost:27017/crypto-alerts');
        console.log('Connected to MongoDB');

        const hash = await bcrypt.hash('admin123', 10);

        const result = await mongoose.connection.db.collection('users').updateOne(
            { username: 'admin' },
            { $set: { password: hash } }
        );

        console.log('✅ Password reset successfully!');
        console.log('Username: admin');
        console.log('New Password: admin123');
        console.log('Modified:', result.modifiedCount);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

resetPassword();
