// Utility functions for alert count locking mechanism

/**
 * Calculate lock time based on alert count timeframe
 * @param {string} timeframe - The alert count timeframe (e.g., "1H", "4H", "1D")
 * @returns {Date} - The lock until date
 */
export function calculateLockTime(timeframe) {
  const now = new Date();
  const timeframes = {
    "5MIN": 5 * 60 * 1000, // 5 minutes
    "15MIN": 15 * 60 * 1000, // 15 minutes
    "30MIN": 30 * 60 * 1000, // 30 minutes
    "1HR": 60 * 60 * 1000, // 1 hour (alternative format)
    "2HR": 2 * 60 * 60 * 1000, // 2 hours
    "4HR": 4 * 60 * 60 * 1000, // 4 hours
    "6HR": 6 * 60 * 60 * 1000, // 6 hours
    "8HR": 8 * 60 * 60 * 1000, // 8 hours
    "12HR": 12 * 60 * 60 * 1000, // 12 hours
    "D": 24 * 60 * 60 * 1000, // 1 day
    "3D": 3 * 24 * 60 * 60 * 1000, // 3 days
    "1W": 7 * 24 * 60 * 60 * 1000, // 1 week
  };

  const lockDuration = timeframes[timeframe];
  if (!lockDuration) {
    throw new Error(`Invalid alert count timeframe: ${timeframe}`);
  }

  return new Date(now.getTime() + lockDuration);
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
