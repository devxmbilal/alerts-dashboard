import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Define User schema inline  
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
    role: { type: String, default: 'admin' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    favorites: { type: [String], default: [] },
    telegramChatId: { type: String, default: null },
    telegramBotToken: { type: String, default: null },
    notificationPreferences: {
        email: { type: Boolean, default: true },
        telegram: { type: Boolean, default: false }
    }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

const User = mongoose.model('User', userSchema);

async function createAdmin() {
    try {
        await mongoose.connect('mongodb://localhost:27017/crypto-alerts');
        console.log('Connected to MongoDB');

        // Delete existing admin
        await User.deleteOne({ username: 'admin' });
        console.log('Deleted existing admin user');

        // Create new admin using Mongoose model
        const admin = new User({
            username: 'admin',
            password: 'admin123',  // Will be hashed by pre-save hook
            name: 'Admin User',
            email: 'admin@cryptoaibot.online',
            role: 'admin',
            isActive: true
        });

        await admin.save();

        console.log('✅ Admin user created successfully!');
        console.log('Username: admin');
        console.log('Password: admin123');

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

createAdmin();
