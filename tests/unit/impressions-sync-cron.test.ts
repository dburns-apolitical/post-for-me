import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import type { DbCredential, Platform } from '../../src/types/index';

const mockGetAccounts = mock(
    (): Promise<{ id: number; ig_access_token: string; ig_user_id: string }[]> => Promise.resolve([])
);
const mockGetCredentialsByPlatform = mock(
    (_accountId: number, _platform: Platform): Promise<DbCredential | null> => Promise.resolve(null)
);
const mockInsertDailyImpressions = mock(
    (_accountId: number, _day: Date, _counts: { instagram: number; youtube: number; tiktok: number; twitter: number }): Promise<void> => Promise.resolve()
);

mock.module('../../src/services/database', () => ({
    DatabaseService: class {
        getAccounts = mockGetAccounts;
        getCredentialsByPlatform = mockGetCredentialsByPlatform;
        insertDailyImpressions = mockInsertDailyImpressions;
    },
}));

const mockGetTotalImpressions = mock(
    () => Promise.resolve({ instagram: 0, youtube: 0, tiktok: 0, twitter: 0 })
);

mock.module('../../src/services/upload-post-client', () => ({
    UploadPostClientService: class {
        constructor() {}
        getTotalImpressions = mockGetTotalImpressions;
    },
}));

import { ImpressionsSyncCronService } from '../../src/services/impressions-sync-cron';

describe('ImpressionsSyncCronService', () => {
    let service: ImpressionsSyncCronService;
    const originalThrottleMs = ImpressionsSyncCronService.BACKFILL_THROTTLE_MS;

    beforeEach(() => {
        mockGetAccounts.mockClear();
        mockGetCredentialsByPlatform.mockClear();
        mockInsertDailyImpressions.mockClear();
        mockGetTotalImpressions.mockClear();
        // Zero out the backfill throttle so tests don't sleep between calls.
        ImpressionsSyncCronService.BACKFILL_THROTTLE_MS = 0;
        service = new ImpressionsSyncCronService();
    });

    test('returns 0 counts when no accounts exist', async () => {
        mockGetAccounts.mockResolvedValueOnce([]);

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 0, failed: 0 });
        expect(mockInsertDailyImpressions).not.toHaveBeenCalled();
    });

    test('syncs impressions for all accounts with upload_post credentials', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
            { id: 20, ig_access_token: 'token2', ig_user_id: 'user2' },
        ]);
        mockGetCredentialsByPlatform
            .mockResolvedValueOnce({
                id: 1, account_id: 10, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key1', user: 'upuser1', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            })
            .mockResolvedValueOnce({
                id: 2, account_id: 20, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key2', user: 'upuser2', instagram: true, youtube: true, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            });
        mockGetTotalImpressions
            .mockResolvedValueOnce({ instagram: 1000, youtube: 500, tiktok: 0, twitter: 0 })
            .mockResolvedValueOnce({ instagram: 800, youtube: 600, tiktok: 200, twitter: 0 });

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 2, failed: 0 });
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(2);
        expect(mockInsertDailyImpressions.mock.calls[0][0]).toBe(10);
        expect(mockInsertDailyImpressions.mock.calls[0][2]).toEqual({ instagram: 1000, youtube: 500, tiktok: 0, twitter: 0 });
        expect(mockInsertDailyImpressions.mock.calls[1][0]).toBe(20);
        expect(mockInsertDailyImpressions.mock.calls[1][2]).toEqual({ instagram: 800, youtube: 600, tiktok: 200, twitter: 0 });
    });

    test('increments failed and skips when account has no upload_post credentials', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
        ]);
        mockGetCredentialsByPlatform.mockResolvedValueOnce(null);

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 0, failed: 1 });
        expect(mockInsertDailyImpressions).not.toHaveBeenCalled();
    });

    test('increments failed when getTotalImpressions throws, continues remaining accounts', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
            { id: 20, ig_access_token: 'token2', ig_user_id: 'user2' },
        ]);
        mockGetCredentialsByPlatform
            .mockResolvedValueOnce({
                id: 1, account_id: 10, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key1', user: 'upuser1', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            })
            .mockResolvedValueOnce({
                id: 2, account_id: 20, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key2', user: 'upuser2', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            });
        mockGetTotalImpressions
            .mockRejectedValueOnce(new Error('API error'))
            .mockResolvedValueOnce({ instagram: 500, youtube: 0, tiktok: 0, twitter: 0 });

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 1, failed: 1 });
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(1);
        expect(mockInsertDailyImpressions.mock.calls[0][0]).toBe(20);
    });

    test('second call while first is running returns 0 without re-running', async () => {
        let resolveFirst!: () => void;
        const firstRunning = new Promise<void>((res) => { resolveFirst = res; });

        mockGetAccounts.mockImplementationOnce(() => firstRunning.then(() => []));

        const first = service.syncImpressions();
        const second = service.syncImpressions();
        resolveFirst();

        const [r1, r2] = await Promise.all([first, second]);
        expect(r2).toEqual({ updated: 0, failed: 0 });
        expect(mockGetAccounts).toHaveBeenCalledTimes(1);
    });

    test('backfillImpressions iterates each day × account and inserts with the requested date', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
            { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
        ]);
        mockGetCredentialsByPlatform.mockResolvedValue({
            id: 1, account_id: 0, platform: 'upload_post' as Platform,
            credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
            active: true, created_at: new Date(),
        });
        mockGetTotalImpressions.mockResolvedValue({ instagram: 100, youtube: 0, tiktok: 0, twitter: 0 });

        const start = new Date(Date.UTC(2025, 4, 1));  // 2025-05-01
        const end   = new Date(Date.UTC(2025, 4, 3));  // 2025-05-03

        const result = await service.backfillImpressions(start, end);

        expect(result).toEqual({ daysProcessed: 3, accountsPerDay: 2, updated: 6, failed: 0 });
        expect(mockGetTotalImpressions).toHaveBeenCalledTimes(6);
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(6);

        // First call: 2025-05-01, account 10
        const firstInsert = mockInsertDailyImpressions.mock.calls[0];
        expect(firstInsert[0]).toBe(10);
        expect((firstInsert[1] as Date).toISOString().split('T')[0]).toBe('2025-05-01');

        // Last call: 2025-05-03, account 20
        const lastInsert = mockInsertDailyImpressions.mock.calls[5];
        expect(lastInsert[0]).toBe(20);
        expect((lastInsert[1] as Date).toISOString().split('T')[0]).toBe('2025-05-03');
    });

    test('backfillImpressions counts a failure when getTotalImpressions throws for one (date, account) pair', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
            { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
        ]);
        mockGetCredentialsByPlatform.mockResolvedValue({
            id: 1, account_id: 0, platform: 'upload_post' as Platform,
            credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
            active: true, created_at: new Date(),
        });
        // 2 days × 2 accounts = 4 calls. Make the 2nd call (day 1, account 20) throw.
        mockGetTotalImpressions
            .mockResolvedValueOnce({ instagram: 100, youtube: 0, tiktok: 0, twitter: 0 })
            .mockRejectedValueOnce(new Error('upstream 500'))
            .mockResolvedValueOnce({ instagram: 200, youtube: 0, tiktok: 0, twitter: 0 })
            .mockResolvedValueOnce({ instagram: 300, youtube: 0, tiktok: 0, twitter: 0 });

        const start = new Date(Date.UTC(2025, 4, 1));
        const end   = new Date(Date.UTC(2025, 4, 2));

        const result = await service.backfillImpressions(start, end);

        expect(result).toEqual({ daysProcessed: 2, accountsPerDay: 2, updated: 3, failed: 1 });
        expect(mockGetTotalImpressions).toHaveBeenCalledTimes(4);
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(3);
    });

    test('backfillImpressions counts every day as failed for an account with no upload_post credentials', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
            { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
        ]);
        // Account 10 has no upload_post credentials; account 20 does.
        mockGetCredentialsByPlatform.mockImplementation(async (accountId: number) => {
            if (accountId === 10) return null;
            return {
                id: 1, account_id: 20, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            };
        });
        mockGetTotalImpressions.mockResolvedValue({ instagram: 50, youtube: 0, tiktok: 0, twitter: 0 });

        const start = new Date(Date.UTC(2025, 4, 1));
        const end   = new Date(Date.UTC(2025, 4, 3));  // 3 days

        const result = await service.backfillImpressions(start, end);

        // 3 days × 1 missing-cred account = 3 failed; 3 days × 1 valid account = 3 updated.
        expect(result).toEqual({ daysProcessed: 3, accountsPerDay: 2, updated: 3, failed: 3 });
        expect(mockGetTotalImpressions).toHaveBeenCalledTimes(3);
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(3);
    });

    test('backfillImpressions returns zeros when a sync is already in progress', async () => {
        // Simulate a sync mid-flight by holding syncImpressions open.
        let resolveSync!: () => void;
        const syncRunning = new Promise<void>((res) => { resolveSync = res; });
        mockGetAccounts.mockImplementationOnce(() => syncRunning.then(() => []));

        const sync = service.syncImpressions();
        // At this point isRunning is true (syncImpressions has started but not finished).
        const start = new Date(Date.UTC(2025, 4, 1));
        const end   = new Date(Date.UTC(2025, 4, 3));
        const backfillResult = await service.backfillImpressions(start, end);

        expect(backfillResult).toEqual({ daysProcessed: 0, accountsPerDay: 0, updated: 0, failed: 0 });
        // Backfill must not call the API or DB while sync is running.
        expect(mockGetTotalImpressions).not.toHaveBeenCalled();
        expect(mockInsertDailyImpressions).not.toHaveBeenCalled();

        resolveSync();
        await sync;
    });

    test('backfillImpressions throttles between (date, account) calls', async () => {
        ImpressionsSyncCronService.BACKFILL_THROTTLE_MS = 25;

        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
            { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
        ]);
        mockGetCredentialsByPlatform.mockResolvedValue({
            id: 1, account_id: 0, platform: 'upload_post' as Platform,
            credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
            active: true, created_at: new Date(),
        });
        mockGetTotalImpressions.mockResolvedValue({ instagram: 0, youtube: 0, tiktok: 0, twitter: 0 });

        const start = new Date(Date.UTC(2025, 4, 1));
        const end   = new Date(Date.UTC(2025, 4, 2)); // 2 days × 2 accounts = 4 calls, 3 throttle waits

        const t0 = Date.now();
        const result = await service.backfillImpressions(start, end);
        const elapsed = Date.now() - t0;

        expect(result).toEqual({ daysProcessed: 2, accountsPerDay: 2, updated: 4, failed: 0 });
        // 3 throttle waits × 25ms = 75ms minimum; allow generous upper bound.
        expect(elapsed).toBeGreaterThanOrEqual(70);
        expect(elapsed).toBeLessThan(500);
    });

    afterAll(() => {
        ImpressionsSyncCronService.BACKFILL_THROTTLE_MS = originalThrottleMs;
    });
});

afterAll(async () => {
    const resolvedPath = require.resolve('../../src/services/upload-post-client');
    delete require.cache[resolvedPath];
    await mock.module('../../src/services/upload-post-client', async () => {
        return import(`../../src/services/upload-post-client?t=${Date.now()}`);
    });
});
