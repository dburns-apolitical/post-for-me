import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { DailyViewsEntry } from '../types/index.js';

export async function handleViewsHistory(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized views history request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin views history request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');
        let accountId: number | null = null;

        if (accountIdParam !== null) {
            accountId = parseInt(accountIdParam, 10);
            if (isNaN(accountId) || accountId < 1) {
                return Response.json(
                    { success: false, error: 'accountId must be a positive integer' },
                    { status: 400 }
                );
            }
        }

        const config = getConfig();
        const sql = neon(config.databaseUrl);

        const rows = accountId !== null
            ? await sql`
                SELECT day::text, views
                FROM daily_views
                WHERE account_id = ${accountId}
                  AND day >= CURRENT_DATE - INTERVAL '56 days'
                ORDER BY day ASC
            ` as { day: string; views: string }[]
            : await sql`
                SELECT day::text, SUM(views)::integer as views
                FROM daily_views
                WHERE day >= CURRENT_DATE - INTERVAL '56 days'
                GROUP BY day
                ORDER BY day ASC
            ` as { day: string; views: string }[];

        const dailyViews: DailyViewsEntry[] = rows.map(row => ({
            day: row.day,
            views: parseInt(row.views, 10) || 0,
        }));

        const now = new Date();
        const twentyEightDaysAgo = new Date(now);
        twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
        const cutoff = twentyEightDaysAgo.toISOString().split('T')[0];

        let last28DaysTotal = 0;
        let previous28DaysTotal = 0;

        for (const entry of dailyViews) {
            if (entry.day >= cutoff) {
                last28DaysTotal += entry.views;
            } else {
                previous28DaysTotal += entry.views;
            }
        }

        let deltaPercent: number | null = null;
        if (previous28DaysTotal > 0) {
            deltaPercent = Math.round(((last28DaysTotal - previous28DaysTotal) / previous28DaysTotal) * 100 * 100) / 100;
        }

        return Response.json({
            success: true,
            dailyViews,
            last28DaysTotal,
            previous28DaysTotal,
            deltaPercent,
        });
    } catch (error) {
        logger.error('Error fetching views history', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch views history',
            },
            { status: 500 }
        );
    }
}
