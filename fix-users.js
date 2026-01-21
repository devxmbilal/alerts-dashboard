import mongoose from 'mongoose';

async function fixUser() {
    try {
        await mongoose.connect('mongodb://localhost:27017/crypto-alerts');
        console.log('Connected to MongoDB');

        const result = await mongoose.connection.db.collection('users').updateMany(
            {},
            { $set: { isActive: true } }
        );

        console.log('✅ Users updated!');
        console.log('Modified:', result.modifiedCount);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

fixUser();
