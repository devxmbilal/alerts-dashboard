import mongoose from 'mongoose';

mongoose.connect('mongodb://localhost:27017/crypto-alerts').then(async () => {
    const user = await mongoose.connection.db.collection('users').findOne({ username: 'admin' });
    console.log('User preferredTimeframe:', user.preferredTimeframe || 'NOT SET (default 5m)');
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
