import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

let isConnected = false;

const connectToMongoDB = async () => {
  if (isConnected) {
    console.log("✅ MongoDB already connected");
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    isConnected = true;
    console.log("✅ Connected to MongoDB");

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ MongoDB disconnected");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
      isConnected = true;
    });
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    isConnected = false;
    throw error;
  }
};

const disconnectFromMongoDB = async () => {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    console.log("✅ Disconnected from MongoDB");
  }
};

export { connectToMongoDB, disconnectFromMongoDB };
export const getConnectionStatus = () => isConnected;
