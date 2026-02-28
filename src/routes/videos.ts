import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { DatabaseService } from '../services/database.js';

export async function handleVideos(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized videos request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin videos request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');

        if (!accountIdParam) {
            return Response.json(
                { success: false, error: 'accountId query parameter is required' },
                { status: 400 }
            );
        }

        const accountId = parseInt(accountIdParam, 10);
        if (isNaN(accountId)) {
            return Response.json(
                { success: false, error: 'accountId must be a number' },
                { status: 400 }
            );
        }

        const db = new DatabaseService();
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: `Account ${accountId} not found` },
                { status: 404 }
            );
        }

        const videoSelector = new VideoSelectorService(account.gcs_bucket_name);
        const videos = await videoSelector.listAllVideoNames();

        return Response.json({ success: true, videos });
    } catch (error) {
        logger.error('Error fetching videos', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to fetch videos' },
            { status: 500 }
        );
    }
}
