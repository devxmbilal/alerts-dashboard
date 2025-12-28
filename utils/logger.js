/**
 * Centralized Logger with LOG_LEVEL support
 * 
 * Usage:
 *   import logger from './logger.js';
 *   logger.debug('Debug message');
 *   logger.info('Info message');
 *   logger.warn('Warning message');
 *   logger.error('Error message');
 * 
 * Environment Variable:
 *   LOG_LEVEL=error   - Only errors (production)
 *   LOG_LEVEL=warn    - Warnings and errors
 *   LOG_LEVEL=info    - Info, warnings, and errors
 *   LOG_LEVEL=debug   - All logs (development)
 */

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

// Get log level from environment (default to 'error' in production, 'info' in development)
const getLogLevel = () => {
    if (typeof process !== 'undefined' && process.env) {
        const envLevel = process.env.LOG_LEVEL?.toLowerCase();
        if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
            return LOG_LEVELS[envLevel];
        }
        // Default based on NODE_ENV
        return process.env.NODE_ENV === 'production' ? LOG_LEVELS.error : LOG_LEVELS.info;
    }
    // Browser environment - check localStorage or default to info
    if (typeof localStorage !== 'undefined') {
        const storedLevel = localStorage.getItem('LOG_LEVEL')?.toLowerCase();
        if (storedLevel && LOG_LEVELS[storedLevel] !== undefined) {
            return LOG_LEVELS[storedLevel];
        }
    }
    return LOG_LEVELS.info;
};

const currentLogLevel = getLogLevel();

const logger = {
    debug: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.debug) {
            console.log('🔍', ...args);
        }
    },

    info: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.info) {
            console.log('ℹ️', ...args);
        }
    },

    warn: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.warn) {
            console.warn('⚠️', ...args);
        }
    },

    error: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.error) {
            console.error('❌', ...args);
        }
    },

    // Always log regardless of level (for critical startup messages)
    always: (...args) => {
        console.log(...args);
    },

    // Get current log level name
    getLevel: () => {
        return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel) || 'info';
    },
};

export default logger;
