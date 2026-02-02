import type { Config } from '../types/index.js';

export function getConfig(): Config {
    const requiredEnvVars = [
        'GCS_PROJECT_ID',
        'GCS_BUCKET_NAME',
        'INSTAGRAM_ACCESS_TOKEN',
        'INSTAGRAM_USER_ID',
        'DATABASE_URL',
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
            bucketName: process.env.GCS_BUCKET_NAME || '',
            keyFilePath: '', // No longer needed for public bucket access
        },
        instagram: {
            accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
            userId: process.env.INSTAGRAM_USER_ID || '',
        },
        tempDir: process.env.TEMP_DIR || './tmp',
        databaseUrl: process.env.DATABASE_URL || '',
    };
}
