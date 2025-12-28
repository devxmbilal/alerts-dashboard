"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  FormControlLabel,
  Switch,
  Alert,
  Divider,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";

const UserSettingsModal = ({ open, onClose, user }) => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    telegramChatId: "",
    emailNotifications: true,
    telegramNotifications: false,
  });

  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load user data when modal opens
  useEffect(() => {
    if (user && open) {
      setFormData({
        name: user.name || "",
        email: user.email || "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        telegramChatId: user.telegramChatId || "",
        emailNotifications: user.notificationPreferences?.email ?? true,
        telegramNotifications: user.notificationPreferences?.telegram ?? false,
      });
      setError("");
      setSuccess("");
    }
  }, [user, open]);

  const handleChange = (e) => {
    const { name, value, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: e.target.type === "checkbox" ? checked : value,
    }));
  };

  const handleTogglePassword = (field) => {
    setShowPasswords((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const validateForm = () => {
    // Email validation
    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      setError("Please enter a valid email address");
      return false;
    }

    // Password validation if changing password
    if (formData.newPassword) {
      if (!formData.currentPassword) {
        setError("Current password is required to set a new password");
        return false;
      }

      if (formData.newPassword.length < 6) {
        setError("New password must be at least 6 characters long");
        return false;
      }

      if (formData.newPassword !== formData.confirmPassword) {
        setError("New passwords do not match");
        return false;
      }
    }

    // Telegram Chat ID validation
    if (formData.telegramChatId && !/^\d+$/.test(formData.telegramChatId)) {
      setError("Telegram Chat ID must be numeric");
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    setError("");
    setSuccess("");

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const updateData = {
        name: formData.name,
        email: formData.email,
        telegramChatId: formData.telegramChatId,
        notificationPreferences: {
          email: formData.emailNotifications,
          telegram: formData.telegramNotifications,
        },
      };

      // Only include password fields if user wants to change password
      if (formData.newPassword) {
        updateData.currentPassword = formData.currentPassword;
        updateData.newPassword = formData.newPassword;
      }

      const response = await fetch("/api/user/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess("Settings updated successfully!");

        // Update local storage with new user data
        const updatedUser = { ...user, ...data.user };
        localStorage.setItem("user", JSON.stringify(updatedUser));

        // Clear password fields
        setFormData((prev) => ({
          ...prev,
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        }));

        // Close modal after 2 seconds
        setTimeout(() => {
          onClose();
          window.location.reload(); // Refresh to update user data
        }, 2000);
      } else {
        setError(data.error || "Failed to update settings");
      }
    } catch (error) {
      console.error("Error updating settings:", error);
      setError("An error occurred while updating settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "#1a1a1a",
          color: "white",
        },
      }}
    >
      <DialogTitle>
        <Typography variant="h6">User Settings</Typography>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {/* Profile Information */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, color: "#1976d2" }}>
            Profile Information
          </Typography>

          <TextField
            fullWidth
            label="Name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Your name"
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "#666", borderWidth: "1px" },
                "&:hover fieldset": { borderColor: "#888" },
              },
            }}
            InputProps={{
              style: { color: "white" },
            }}
            InputLabelProps={{
              shrink: true,
              style: { color: "#888" },
            }}
          />

          <TextField
            fullWidth
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="your@email.com"
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "#666", borderWidth: "1px" },
                "&:hover fieldset": { borderColor: "#888" },
              },
            }}
            InputProps={{
              style: { color: "white" },
            }}
            InputLabelProps={{
              shrink: true,
              style: { color: "#888" },
            }}
          />
        </Box>

        <Divider sx={{ my: 2, borderColor: "#333" }} />

        {/* Password Change */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, color: "#1976d2" }}>
            Change Password (Optional)
          </Typography>

          <TextField
            fullWidth
            label="Current Password"
            name="currentPassword"
            type={showPasswords.current ? "text" : "password"}
            value={formData.currentPassword}
            onChange={handleChange}
            placeholder="Enter current password"
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "#666", borderWidth: "1px" },
                "&:hover fieldset": { borderColor: "#888" },
              },
            }}
            InputProps={{
              style: { color: "white" },
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => handleTogglePassword("current")}
                    edge="end"
                    size="small"
                    sx={{ color: "#888", mr: -0.5 }}
                  >
                    {showPasswords.current ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            InputLabelProps={{
              shrink: true,
              style: { color: "#888" },
            }}
          />

          <TextField
            fullWidth
            label="New Password"
            name="newPassword"
            type={showPasswords.new ? "text" : "password"}
            value={formData.newPassword}
            onChange={handleChange}
            placeholder="Enter new password"
            helperText="Leave blank to keep current password"
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "#666", borderWidth: "1px" },
                "&:hover fieldset": { borderColor: "#888" },
              },
            }}
            InputProps={{
              style: { color: "white" },
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => handleTogglePassword("new")}
                    edge="end"
                    size="small"
                    sx={{ color: "#888", mr: -0.5 }}
                  >
                    {showPasswords.new ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            InputLabelProps={{
              shrink: true,
              style: { color: "#888" },
            }}
            FormHelperTextProps={{
              style: { color: "#888" },
            }}
          />

          <TextField
            fullWidth
            label="Confirm New Password"
            name="confirmPassword"
            type={showPasswords.confirm ? "text" : "password"}
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="Re-enter new password"
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "#666", borderWidth: "1px" },
                "&:hover fieldset": { borderColor: "#888" },
              },
            }}
            InputProps={{
              style: { color: "white" },
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => handleTogglePassword("confirm")}
                    edge="end"
                    size="small"
                    sx={{ color: "#888", mr: -0.5 }}
                  >
                    {showPasswords.confirm ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            InputLabelProps={{
              shrink: true,
              style: { color: "#888" },
            }}
          />
        </Box>

        <Divider sx={{ my: 2, borderColor: "#333" }} />

        {/* Telegram Settings */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, color: "#1976d2" }}>
            Telegram Settings
          </Typography>

          <TextField
            fullWidth
            label="Telegram Chat ID"
            name="telegramChatId"
            value={formData.telegramChatId}
            onChange={handleChange}
            placeholder="123456789"
            helperText="Get your Chat ID from @userinfobot on Telegram"
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "#666", borderWidth: "1px" },
                "&:hover fieldset": { borderColor: "#888" },
              },
            }}
            InputProps={{
              style: { color: "white" },
            }}
            InputLabelProps={{
              shrink: true,
              style: { color: "#888" },
            }}
            FormHelperTextProps={{
              style: { color: "#888" },
            }}
          />
        </Box>

        <Divider sx={{ my: 2, borderColor: "#333" }} />

        {/* Notification Preferences */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 2, color: "#1976d2" }}>
            Notification Preferences
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={formData.emailNotifications}
                onChange={handleChange}
                name="emailNotifications"
                color="primary"
              />
            }
            label="Email Notifications"
            sx={{ display: "block", mb: 1 }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={formData.telegramNotifications}
                onChange={handleChange}
                name="telegramNotifications"
                color="primary"
              />
            }
            label="Telegram Notifications"
            sx={{ display: "block" }}
          />

          {formData.telegramNotifications && !formData.telegramChatId && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Please add your Telegram Chat ID to enable Telegram notifications
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading} sx={{ color: "#888" }}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          sx={{
            backgroundColor: "#1976d2",
            "&:hover": {
              backgroundColor: "#1565c0",
            },
          }}
        >
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserSettingsModal;
