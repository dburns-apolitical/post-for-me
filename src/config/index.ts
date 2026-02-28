import type { Config } from '../types/index.js';

export function getConfig(): Config {
    const requiredEnvVars = [
        'GCS_PROJECT_ID',
        'DATABASE_URL',
        'ANTHROPIC_API_KEY',
    ];

    const missing = requiredEnvVars.filter((varName) => !process.env[varName]);

    if (missing.length > 0 && process.env.NODE_ENV === 'production') {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return {
        port: parseInt(process.env.PORT || '3000', 10),
        nodeEnv: process.env.NODE_ENV || 'development',
        gcs: {
            projectId: process.env.GCS_PROJECT_ID || '',
        },
        tempDir: process.env.TEMP_DIR || './tmp',
        databaseUrl: process.env.DATABASE_URL || '',
        dashboard: {
            password: process.env.DASHBOARD_PASSWORD || '',
            neonAuthUrl: process.env.NEON_AUTH_URL,
            neonJwksUrl: process.env.NEON_JWKS_URL,
        },
        anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY || '',
        },
    };
}
