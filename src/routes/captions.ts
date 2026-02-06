import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';

export async function handleCaptions(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized captions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin captions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Captions request authenticated', { method: authResult.method });

    try {
        const db = new DatabaseService();
        const captions = await db.getAllCaptions();

        return Response.json({
            success: true,
            captions,
        });
    } catch (error) {
        logger.error('Error fetching captions', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch captions',
            },
            { status: 500 }
        );
    }
}
