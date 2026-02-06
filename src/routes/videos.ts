import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { VideoSelectorService } from '../services/video-selector.js';

export async function handleVideos(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized videos request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin videos request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Videos request authenticated', { method: authResult.method });

    try {
        const videoSelector = new VideoSelectorService();
        const videos = await videoSelector.listAllVideoNames();

        return Response.json({
            success: true,
            videos,
        });
    } catch (error) {
        logger.error('Error fetching videos', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch videos',
            },
            { status: 500 }
        );
    }
}
