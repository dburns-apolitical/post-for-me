import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';

export async function handleHooks(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized hooks request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin hooks request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Hooks request authenticated', { method: authResult.method });

    try {
        const db = new DatabaseService();
        const hooks = await db.getAllHooks();

        return Response.json({
            success: true,
            hooks,
        });
    } catch (error) {
        logger.error('Error fetching hooks', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch hooks',
            },
            { status: 500 }
        );
    }
}
