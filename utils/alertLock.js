// Utility functions for alert count locking mechanism

/**
 * Get timeframe duration in milliseconds
 * @param {string} timeframe - The timeframe string
 * @returns {number} - Duration in milliseconds
 */
function getTimeframeMs(timeframe) {
  const timeframes = {
    "5MIN": 5 * 60 * 1000, // 5 minutes
    "5M": 5 * 60 * 1000, // 5 minutes (alternative)
    "15MIN": 15 * 60 * 1000, // 15 minutes
    "15M": 15 * 60 * 1000, // 15 minutes (alternative)
    "30MIN": 30 * 60 * 1000, // 30 minutes
    "30M": 30 * 60 * 1000, // 30 minutes (alternative)
    "1HR": 60 * 60 * 1000, // 1 hour
    "1H": 60 * 60 * 1000, // 1 hour (alternative)
    "2HR": 2 * 60 * 60 * 1000, // 2 hours
    "2H": 2 * 60 * 60 * 1000, // 2 hours (alternative)
    "4HR": 4 * 60 * 60 * 1000, // 4 hours
    "4H": 4 * 60 * 60 * 1000, // 4 hours (alternative)
    "6HR": 6 * 60 * 60 * 1000, // 6 hours
    "6H": 6 * 60 * 60 * 1000, // 6 hours (alternative)
    "8HR": 8 * 60 * 60 * 1000, // 8 hours
    "8H": 8 * 60 * 60 * 1000, // 8 hours (alternative)
    "12HR": 12 * 60 * 60 * 1000, // 12 hours
    "12H": 12 * 60 * 60 * 1000, // 12 hours (alternative)
    D: 24 * 60 * 60 * 1000, // 1 day
    "1D": 24 * 60 * 60 * 1000, // 1 day (alternative)
    "3D": 3 * 24 * 60 * 60 * 1000, // 3 days
    "1W": 7 * 24 * 60 * 60 * 1000, // 1 week
  };

  const normalized = timeframe.toUpperCase();
  return timeframes[normalized] || null;
}

/**
 * Calculate lock time based on alert count timeframe
 * Lock until the END of the current candle period (not trigger time + duration)
 *
 * Example:
 * - AlertCount = 5MIN, Alert triggered at 1:02
 * - Current 5-min candle started at 1:00
 * - Lock until 1:05 (end of current candle)
 *
 * @param {string} timeframe - The alert count timeframe (e.g., "5MIN", "15MIN", "1H")
 * @param {Date} triggerTime - Optional: time when alert was triggered (defaults to now)
 * @returns {Date} - The lock until date (end of current candle period)
 */
export function calculateLockTime(timeframe, triggerTime = null) {
  const now = triggerTime ? new Date(triggerTime) : new Date();
  const timeframeMs = getTimeframeMs(timeframe);

  if (!timeframeMs) {
    throw new Error(`Invalid alert count timeframe: ${timeframe}`);
  }

  // Use exact duration from trigger time (trigger time + duration)
  // This ensures a 1-hour cooldown actually lasts exactly 1 hour from the moment it triggers.
  const lockUntil = new Date(now.getTime() + timeframeMs);

  return lockUntil;
}

/**
 * Check if an alert is currently locked
 * @param {Object} alert - The alert object
 * @returns {boolean} - True if alert is locked
 */
export function isAlertLocked(alert) {
  if (!alert.conditions?.alertCount?.lockUntil) {
    return false;
  }

  const now = new Date();
  const lockUntil = new Date(alert.conditions.alertCount.lockUntil);

  return now < lockUntil;
}

/**
 * Get the next available time for an alert to trigger
 * @param {Object} alert - The alert object
 * @returns {Date|null} - The next available time or null if not locked
 */
export function getNextAvailableTime(alert) {
  if (!isAlertLocked(alert)) {
    return null;
  }

  return new Date(alert.conditions.alertCount.lockUntil);
}

/**
 * Update alert lock after triggering
 * @param {Object} alert - The alert object
 * @returns {Object} - Updated alert conditions
 */
export function updateAlertLock(alert) {
  if (!alert.conditions?.alertCount?.timeframe) {
    return alert.conditions;
  }

  const now = new Date();
  const lockUntil = calculateLockTime(alert.conditions.alertCount.timeframe);

  return {
    ...alert.conditions,
    alertCount: {
      ...alert.conditions.alertCount,
      lockUntil: lockUntil,
      lastTriggered: now,
    },
  };
}

/**
 * Get time remaining until alert can trigger again
 * @param {Object} alert - The alert object
 * @returns {number|null} - Milliseconds until unlock, or null if not locked
 */
export function getTimeUntilUnlock(alert) {
  if (!isAlertLocked(alert)) {
    return null;
  }

  const now = new Date();
  const lockUntil = new Date(alert.conditions.alertCount.lockUntil);

  return Math.max(0, lockUntil.getTime() - now.getTime());
}

/**
 * Format time remaining in human readable format
 * @param {number} milliseconds - Time in milliseconds
 * @returns {string} - Formatted time string
 */
export function formatTimeRemaining(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
