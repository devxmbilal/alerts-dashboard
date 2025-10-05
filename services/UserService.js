import User from "../models/User.js";

class UserService {
  // Create a new user
  static async createUser(userData) {
    try {
      const user = new User(userData);
      await user.save();
      console.log(`✅ User created: ${user.username}`);
      return user;
    } catch (error) {
      console.error("❌ Error creating user:", error);
      throw error;
    }
  }

  // Find user by username
  static async findByUsername(username) {
    try {
      const user = await User.findOne({ username, isActive: true });
      return user;
    } catch (error) {
      console.error("❌ Error finding user by username:", error);
      throw error;
    }
  }

  // Find user by email
  static async findByEmail(email) {
    try {
      const user = await User.findOne({ email, isActive: true });
      return user;
    } catch (error) {
      console.error("❌ Error finding user by email:", error);
      throw error;
    }
  }

  // Find user by ID
  static async findById(userId) {
    try {
      const user = await User.findById(userId).select("-password");
      return user;
    } catch (error) {
      console.error("❌ Error finding user by ID:", error);
      throw error;
    }
  }

  // Authenticate user (login)
  static async authenticateUser(username, password) {
    try {
      // Find user by username or email
      const user = await User.findOne({
        $or: [{ username }, { email: username }],
        isActive: true,
      });

      if (!user) {
        return { success: false, message: "User not found" };
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return { success: false, message: "Invalid password" };
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      return { success: true, user };
    } catch (error) {
      console.error("❌ Error authenticating user:", error);
      throw error;
    }
  }

  // Update user
  static async updateUser(userId, updateData) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      ).select("-password");

      return user;
    } catch (error) {
      console.error("❌ Error updating user:", error);
      throw error;
    }
  }

  // Change password
  static async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return { success: false, message: "User not found" };
      }

      // Verify current password
      const isCurrentPasswordValid = await user.comparePassword(
        currentPassword
      );
      if (!isCurrentPasswordValid) {
        return { success: false, message: "Current password is incorrect" };
      }

      // Update password
      user.password = newPassword;
      await user.save();

      return { success: true, message: "Password updated successfully" };
    } catch (error) {
      console.error("❌ Error changing password:", error);
      throw error;
    }
  }

  // Get all users (admin only)
  static async getAllUsers() {
    try {
      const users = await User.find({ isActive: true })
        .select("-password")
        .sort({ createdAt: -1 });
      return users;
    } catch (error) {
      console.error("❌ Error fetching all users:", error);
      throw error;
    }
  }

  // Deactivate user
  static async deactivateUser(userId) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { isActive: false, updatedAt: new Date() },
        { new: true }
      );
      return user;
    } catch (error) {
      console.error("❌ Error deactivating user:", error);
      throw error;
    }
  }

  // Get user statistics
  static async getUserStats() {
    try {
      const totalUsers = await User.countDocuments({ isActive: true });
      const recentUsers = await User.countDocuments({
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
      });

      return {
        totalUsers,
        recentUsers,
      };
    } catch (error) {
      console.error("❌ Error fetching user stats:", error);
      throw error;
    }
  }
}

export default UserService;
