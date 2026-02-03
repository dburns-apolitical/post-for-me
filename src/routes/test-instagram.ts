import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { InstagramClientService } from '../services/instagram-client.js';

export async function handleTestInstagram(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized test-instagram request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin test-instagram request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const instagramClient = new InstagramClientService();
        const accountInfo = await instagramClient.getAccountInfo();

        logger.info('Instagram credentials test successful', {
            username: accountInfo.username,
        });

        return Response.json({
            success: true,
            account: accountInfo,
        });
    } catch (error) {
        logger.error('Instagram credentials test failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to verify Instagram credentials',
            },
            { status: 500 }
        );
    }
}
