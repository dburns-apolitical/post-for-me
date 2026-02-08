import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { ViewsSyncCronService } from '../services/views-sync-cron.js';

export async function handleSyncViews(request: Request, viewsSyncCron: ViewsSyncCronService): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized sync-views request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin sync-views request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Manual views sync triggered', { method: authResult.method });

    try {
        const result = await viewsSyncCron.syncViews();

        return Response.json({
            success: true,
            ...result,
        });
    } catch (error) {
        logger.error('Manual views sync failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to sync views',
            },
            { status: 500 }
        );
    }
}
