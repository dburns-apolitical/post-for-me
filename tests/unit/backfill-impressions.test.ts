import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockValidateAuth = mock(() => Promise.resolve({ authenticated: true, isAdmin: true, method: 'password' as const }));

mock.module('../../src/utils/auth', () => ({
    validateAuth: mockValidateAuth,
    unauthorizedResponse: (msg: string) => Response.json({ success: false, error: 'Unauthorized', message: msg }, { status: 401 }),
    forbiddenResponse:    (msg: string) => Response.json({ success: false, error: 'Forbidden',    message: msg }, { status: 403 }),
}));

const mockBackfillImpressions = mock(
    (_start: Date, _end: Date) => Promise.resolve({ daysProcessed: 1, accountsPerDay: 1, updated: 1, failed: 0 })
);

const mockService = { backfillImpressions: mockBackfillImpressions } as unknown as import('../../src/services/impressions-sync-cron').ImpressionsSyncCronService;

import { handleBackfillImpressions } from '../../src/routes/backfill-impressions';

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/impressions/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Password': 'pw' },
        body: JSON.stringify(body),
    });
}

describe('handleBackfillImpressions', () => {
    beforeEach(() => {
        mockValidateAuth.mockClear();
        mockBackfillImpressions.mockClear();
        mockValidateAuth.mockResolvedValue({ authenticated: true, isAdmin: true, method: 'password' as const });
    });

    test('returns 401 when unauthenticated', async () => {
        mockValidateAuth.mockResolvedValueOnce({ authenticated: false, isAdmin: false, error: 'bad pw' });
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(401);
        expect(mockBackfillImpressions).not.toHaveBeenCalled();
    });

    test('returns 403 when authenticated but not admin', async () => {
        mockValidateAuth.mockResolvedValueOnce({ authenticated: true, isAdmin: false, method: 'bearer' as const, userId: 'u1' });
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(403);
        expect(mockBackfillImpressions).not.toHaveBeenCalled();
    });

    test('returns 400 when startDate is missing', async () => {
        const res = await handleBackfillImpressions(postReq({ endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when endDate is missing', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when startDate is not YYYY-MM-DD', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '05/01/2025', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when startDate > endDate', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-10', endDate: '2025-05-01' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when endDate is in the future', async () => {
        // Build a date string for tomorrow UTC.
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: tomorrow }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when range exceeds 31 days inclusive', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-04-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 200 and forwards the service result on success', async () => {
        mockBackfillImpressions.mockResolvedValueOnce({ daysProcessed: 2, accountsPerDay: 3, updated: 5, failed: 1 });
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, daysProcessed: 2, accountsPerDay: 3, updated: 5, failed: 1 });
        expect(mockBackfillImpressions).toHaveBeenCalledTimes(1);
        const [start, end] = mockBackfillImpressions.mock.calls[0];
        expect((start as Date).toISOString().split('T')[0]).toBe('2025-05-01');
        expect((end   as Date).toISOString().split('T')[0]).toBe('2025-05-02');
    });

    test('returns 500 when the service throws', async () => {
        mockBackfillImpressions.mockRejectedValueOnce(new Error('db down'));
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('db down');
    });
});
