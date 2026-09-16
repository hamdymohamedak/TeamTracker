/**
 * Environment validation and startup configuration.
 * Fail fast in production when required secrets are missing.
 */

export interface EnvConfig {
  isProduction: boolean;
  port: number;
  jwtSecret: string;
  deepseekApiKey: string | null;
  screenshotRetentionDays: number;
  backupEnabled: boolean;
  backupIntervalHours: number;
  backupRetentionDays: number;
  corsOrigin: string | boolean;
}

let validated: EnvConfig | null = null;

export function validateEnv(): EnvConfig {
  if (validated) return validated;

  const isProduction = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET?.trim() || '';

  if (isProduction) {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error(
        'FATAL: JWT_SECRET must be set to a strong value (≥32 chars) when NODE_ENV=production. ' +
          'Generate one with: openssl rand -hex 32'
      );
    }
    if (
      jwtSecret.includes('change-in-production') ||
      jwtSecret === 'your_jwt_secret_here' ||
      jwtSecret === 'teamtracker-dev-secret'
    ) {
      throw new Error('FATAL: JWT_SECRET appears to be a placeholder. Set a real secret before starting.');
    }
  }

  const port = parseInt(process.env.PORT || '3001', 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`FATAL: Invalid PORT: ${process.env.PORT}`);
  }

  const retentionRaw = parseInt(process.env.SCREENSHOT_RETENTION_DAYS || '30', 10);
  const screenshotRetentionDays =
    Number.isFinite(retentionRaw) && retentionRaw > 0 && retentionRaw < 3650 ? retentionRaw : 30;

  const backupEnabled = process.env.BACKUP_ENABLED !== '0' && process.env.BACKUP_ENABLED !== 'false';
  const backupIntervalHours = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_HOURS || '24', 10) || 24);
  const backupRetentionDays = Math.max(1, parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10) || 14);

  // CORS: in production prefer explicit origin; allow all in development
  let corsOrigin: string | boolean = true;
  if (process.env.CORS_ORIGIN) {
    corsOrigin = process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN;
  } else if (isProduction) {
    // Same-origin SPA behind nginx — reflect request origin is fine for same host
    corsOrigin = true;
  }

  validated = {
    isProduction,
    port,
    jwtSecret: jwtSecret || '',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() || null,
    screenshotRetentionDays,
    backupEnabled,
    backupIntervalHours,
    backupRetentionDays,
    corsOrigin,
  };

  return validated;
}

export function getEnv(): EnvConfig {
  if (!validated) return validateEnv();
  return validated;
}

/** Safe summary for logs (no secrets). */
export function envSummary(cfg: EnvConfig): Record<string, unknown> {
  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    port: cfg.port,
    jwtSecretSet: Boolean(cfg.jwtSecret),
    deepseekConfigured: Boolean(cfg.deepseekApiKey),
    screenshotRetentionDays: cfg.screenshotRetentionDays,
    backupEnabled: cfg.backupEnabled,
    emailConfigured: Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST),
  };
}
