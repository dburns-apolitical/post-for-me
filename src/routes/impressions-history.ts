import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { DailyImpressionsEntry } from '../types/index.js';

export async function handleImpressionsHistory(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized impressions history request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin impressions history request', { userId: authResult.userId });
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

        type Row = { day: string; instagram: string; youtube: string; tiktok: string; twitter: string };

        const rows: Row[] = accountId !== null
            ? await sql`
                SELECT day::text, instagram, youtube, tiktok, twitter
                FROM daily_impressions
                WHERE account_id = ${accountId}
                  AND day >= CURRENT_DATE - INTERVAL '56 days'
                ORDER BY day ASC
              ` as Row[]
            : await sql`
                SELECT
                    day::text,
                    SUM(instagram)::integer AS instagram,
                    SUM(youtube)::integer   AS youtube,
                    SUM(tiktok)::integer    AS tiktok,
                    SUM(twitter)::integer   AS twitter
                FROM daily_impressions
                WHERE day >= CURRENT_DATE - INTERVAL '56 days'
                GROUP BY day
                ORDER BY day ASC
              ` as Row[];

        const dailyImpressions: DailyImpressionsEntry[] = rows.map(row => ({
            day:       row.day,
            instagram: parseInt(row.instagram, 10) || 0,
            youtube:   parseInt(row.youtube,   10) || 0,
            tiktok:    parseInt(row.tiktok,    10) || 0,
            twitter:   parseInt(row.twitter,   10) || 0,
        }));

        const now = new Date();
        const twentyEightDaysAgo = new Date(now);
        twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
        const cutoff = twentyEightDaysAgo.toISOString().split('T')[0];

        let last28DaysTotal = 0;
        let previous28DaysTotal = 0;

        for (const entry of dailyImpressions) {
            const dayTotal = entry.instagram + entry.youtube + entry.tiktok + entry.twitter;
            if (entry.day >= cutoff) {
                last28DaysTotal += dayTotal;
            } else {
                previous28DaysTotal += dayTotal;
            }
        }

        const deltaPercent = previous28DaysTotal > 0
            ? Math.round(((last28DaysTotal - previous28DaysTotal) / previous28DaysTotal) * 100 * 100) / 100
            : null;

        return Response.json({
            success: true,
            dailyImpressions,
            last28DaysTotal,
            previous28DaysTotal,
            deltaPercent,
        });
    } catch (error) {
        logger.error('Error fetching impressions history', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to fetch impressions history' },
            { status: 500 }
        );
    }
}
