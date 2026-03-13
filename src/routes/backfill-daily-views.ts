import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';

export async function handleBackfillDailyViews(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    try {
        const config = getConfig();
        const sql = neon(config.databaseUrl);

        const result = await sql`
            INSERT INTO daily_views (account_id, day, views, post_count)
            SELECT
                account_id,
                updated_at::date as day,
                SUM(views) as views,
                COUNT(*) as post_count
            FROM posts
            WHERE views IS NOT NULL
            GROUP BY account_id, updated_at::date
            ON CONFLICT (account_id, day) DO NOTHING
        `;

        const rowCount = result.length ?? 0;

        logger.info('Backfilled daily_views from posts table', { rowCount });

        return Response.json({
            success: true,
            message: `Backfilled daily_views table`,
            rowCount,
        });
    } catch (error) {
        logger.error('Failed to backfill daily_views', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to backfill',
            },
            { status: 500 }
        );
    }
}
