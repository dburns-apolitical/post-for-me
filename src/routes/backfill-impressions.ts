import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { ImpressionsSyncCronService } from '../services/impressions-sync-cron.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface BackfillBody {
    startDate?: unknown;
    endDate?: unknown;
}

function badRequest(error: string): Response {
    return Response.json({ success: false, error }, { status: 400 });
}

/**
 * Parse a YYYY-MM-DD string into a UTC-midnight Date. Returns null on parse failure
 * or if the parsed components don't round-trip (e.g. 2025-02-30 -> 2025-03-02).
 */
function parseUtcDate(input: string): Date | null {
    if (!DATE_RE.test(input)) return null;
    const [y, m, d] = input.split('-').map(n => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        return null;
    }
    return dt;
}

export async function handleBackfillImpressions(
    request: Request,
    impressionsSyncCron: ImpressionsSyncCronService,
): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized backfill-impressions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin backfill-impressions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    let body: BackfillBody;
    try {
        body = await request.json() as BackfillBody;
    } catch {
        return badRequest('Body must be valid JSON');
    }

    if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
        return badRequest('startDate and endDate are required strings in YYYY-MM-DD format');
    }

    const start = parseUtcDate(body.startDate);
    const end   = parseUtcDate(body.endDate);
    if (!start || !end) {
        return badRequest('startDate and endDate must be valid dates in YYYY-MM-DD format');
    }

    if (start.getTime() > end.getTime()) {
        return badRequest('startDate must be on or before endDate');
    }

    const todayUtc = new Date();
    const todayMidnight = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
    if (end.getTime() > todayMidnight) {
        return badRequest('endDate must not be in the future (UTC)');
    }

    const rangeDaysInclusive = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    if (rangeDaysInclusive > MAX_RANGE_DAYS) {
        return badRequest(`Date range must not exceed ${MAX_RANGE_DAYS} days (got ${rangeDaysInclusive})`);
    }

    logger.info('Manual impressions backfill triggered', {
        method: authResult.method,
        startDate: body.startDate,
        endDate: body.endDate,
        rangeDaysInclusive,
    });

    try {
        const result = await impressionsSyncCron.backfillImpressions(start, end);
        return Response.json({ success: true, ...result });
    } catch (error) {
        logger.error('Manual impressions backfill failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to backfill impressions' },
            { status: 500 }
        );
    }
}
