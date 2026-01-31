import type { Config } from '../types/index.js';

export function getConfig(): Config {
    const requiredEnvVars = [
        'GCS_PROJECT_ID',
        'GCS_BUCKET_NAME',
        'BUFFER_ACCESS_TOKEN',
        'BUFFER_PROFILE_ID',
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
        buffer: {
            accessToken: process.env.BUFFER_ACCESS_TOKEN || '',
            profileId: process.env.BUFFER_PROFILE_ID || '',
        },
        tempDir: process.env.TEMP_DIR || './tmp',
        historyFilePath: process.env.HISTORY_FILE_PATH || './data/history.json',
    };
}
