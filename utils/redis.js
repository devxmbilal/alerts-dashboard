import { createClient } from "redis";

let redisClient = null;

// Initialize Redis client
export const initRedis = async () => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    redisClient.on("error", (err) => {
      console.error("Redis Client Error:", err);
    });

    redisClient.on("connect", () => {
      console.log("✅ Redis connected");
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error("❌ Redis connection failed:", error);
    return null;
  }
};

// Get Redis client
export const getRedisClient = () => {
  if (!redisClient) {
    console.warn("⚠️ Redis client not initialized");
  }
  return redisClient;
};

// Favorites cache operations
export const FavoritesCache = {
  // Get user favorites from cache
  async getUserFavorites(userId) {
    try {
      const client = getRedisClient();
      if (!client) return null;

      const key = `favorites:${userId}`;
      const favorites = await client.get(key);
      return favorites ? JSON.parse(favorites) : null;
    } catch (error) {
      console.error("Error getting favorites from cache:", error);
      return null;
    }
  },

  // Set user favorites in cache
  async setUserFavorites(userId, favorites) {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const key = `favorites:${userId}`;
      await client.setEx(key, 3600, JSON.stringify(favorites)); // 1 hour expiry
      return true;
    } catch (error) {
      console.error("Error setting favorites in cache:", error);
      return false;
    }
  },

  // Add symbol to favorites cache
  async addToFavorites(userId, symbol) {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const key = `favorites:${userId}`;
      const currentFavorites = (await this.getUserFavorites(userId)) || [];

      if (!currentFavorites.includes(symbol)) {
        currentFavorites.push(symbol);
        await client.setEx(key, 3600, JSON.stringify(currentFavorites));
      }
      return true;
    } catch (error) {
      console.error("Error adding to favorites cache:", error);
      return false;
    }
  },

  // Remove symbol from favorites cache
  async removeFromFavorites(userId, symbol) {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const key = `favorites:${userId}`;
      const currentFavorites = (await this.getUserFavorites(userId)) || [];

      const updatedFavorites = currentFavorites.filter((s) => s !== symbol);
      await client.setEx(key, 3600, JSON.stringify(updatedFavorites));
      return true;
    } catch (error) {
      console.error("Error removing from favorites cache:", error);
      return false;
    }
  },

  // Clear user favorites cache
  async clearUserFavorites(userId) {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const key = `favorites:${userId}`;
      await client.del(key);
      return true;
    } catch (error) {
      console.error("Error clearing favorites cache:", error);
      return false;
    }
  },
};

export default redisClient;
