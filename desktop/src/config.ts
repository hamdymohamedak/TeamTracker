// TeamTracker Desktop App Configuration
// Update this file to change the server URL for all desktop trackers

export const TEAMTRACKER_CONFIG = {
  // Change this to your VPS URL before building employee installers, e.g.
  // 'https://track.yourcompany.com'
  // Override at runtime with TEAMTRACKER_SERVER_URL.
  serverUrl: 'http://localhost:3001',

  // Device auth token (from setup token enrollment)
  deviceToken: process.env.TEAMTRACKER_DEVICE_TOKEN || '',

  // Default employee settings (overridden by device token)
  defaults: {
    employeeId: 'emp-001',
    employeeName: 'Employee'
  },

  // Sync settings
  sync: {
    intervalMs: 30000,      // Sync every 30 seconds
    batchSize: 100,         // Max activities per batch
    retryDelayMs: 60000     // Retry after 1 minute on failure
  },

  // Tracking settings
  tracking: {
    checkIntervalMs: 5000,  // Check active window every 5 seconds
    idleThresholdMs: 300000 // 5 minutes of no input = idle
  }
};

// Helper to get server URL (checks environment variable first)
export function getServerUrl(): string {
  return process.env.TEAMTRACKER_SERVER_URL || TEAMTRACKER_CONFIG.serverUrl;
}
