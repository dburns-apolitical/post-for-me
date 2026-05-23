import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { ImpressionsSyncCronService } from '../services/impressions-sync-cron.js';

export async function handleSyncImpressions(
    request: Request,
    impressionsSyncCron: ImpressionsSyncCronService
): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized sync-impressions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin sync-impressions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Manual impressions sync triggered', { method: authResult.method });

    try {
        const result = await impressionsSyncCron.syncImpressions();
        return Response.json({ success: true, ...result });
    } catch (error) {
        logger.error('Manual impressions sync failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to sync impressions' },
            { status: 500 }
        );
    }
}
