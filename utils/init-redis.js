import { initRedis } from "./redis.js";

let redisInitialized = false;

export const initializeRedis = async () => {
  if (redisInitialized) {
    return true;
  }

  try {
    console.log("🔄 Initializing Redis...");
    const client = await initRedis();

    if (client) {
      redisInitialized = true;
      console.log("✅ Redis initialized successfully");
      return true;
    } else {
      console.warn("⚠️ Redis initialization failed, continuing without cache");
      return false;
    }
  } catch (error) {
    console.error("❌ Redis initialization error:", error);
    console.warn("⚠️ Continuing without Redis cache");
    return false;
  }
};

export default initializeRedis;
