import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { DbCredential, Platform } from '../../src/types/index';

// Mock dependencies before importing
const mockGetPostsNeedingViewsUpdate = mock(
    (): Promise<{ id: number; account_id: number; instagram_post_id: string | null }[]> => Promise.resolve([])
);
const mockGetAccounts = mock(
    (): Promise<{ id: number; ig_access_token: string; ig_user_id: string }[]> => Promise.resolve([])
);
const mockUpdatePostViews = mock(() => Promise.resolve());
const mockInsertDailyViews = mock((_accountId: number, _date: Date, _views: number, _postCount: number): Promise<void> => Promise.resolve());
const mockGetCredentialsByPlatform = mock(
    (_accountId: number, _platform: Platform): Promise<DbCredential | null> => Promise.resolve(null)
);

mock.module('../../src/services/database', () => ({
    DatabaseService: class {
        getPostsNeedingViewsUpdate = mockGetPostsNeedingViewsUpdate;
        getAccounts = mockGetAccounts;
        updatePostViews = mockUpdatePostViews;
        insertDailyViews = mockInsertDailyViews;
        getCredentialsByPlatform = mockGetCredentialsByPlatform;
    },
}));

const mockGetMediaInsights = mock(() => Promise.resolve(100));

mock.module('../../src/services/instagram-client', () => ({
    InstagramClientService: class {
        constructor() {}
        getMediaInsights = mockGetMediaInsights;
    },
}));

import { ViewsSyncCronService } from '../../src/services/views-sync-cron';

describe('ViewsSyncCronService', () => {
    let service: ViewsSyncCronService;

    beforeEach(() => {
        mockGetPostsNeedingViewsUpdate.mockClear();
        mockGetAccounts.mockClear();
        mockUpdatePostViews.mockClear();
        mockInsertDailyViews.mockClear();
        mockGetMediaInsights.mockClear();
        mockGetCredentialsByPlatform.mockClear();
        service = new ViewsSyncCronService();
    });

    test('should not write daily views when no posts need update', async () => {
        mockGetPostsNeedingViewsUpdate.mockResolvedValueOnce([]);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 0, failed: 0 });
        expect(mockInsertDailyViews).not.toHaveBeenCalled();
    });

    test('should write daily views after syncing posts', async () => {
        mockGetPostsNeedingViewsUpdate.mockResolvedValueOnce([
            { id: 1, account_id: 10, instagram_post_id: 'ig_1' },
            { id: 2, account_id: 10, instagram_post_id: 'ig_2' },
            { id: 3, account_id: 20, instagram_post_id: 'ig_3' },
        ]);
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
            { id: 20, ig_access_token: 'token2', ig_user_id: 'user2' },
        ]);
        mockGetCredentialsByPlatform
            .mockResolvedValueOnce({ id: 1, account_id: 10, platform: 'instagram_direct' as Platform, credentials: { ig_access_token: 'token1', ig_user_id: 'user1' }, active: true, created_at: new Date() })
            .mockResolvedValueOnce({ id: 2, account_id: 20, platform: 'instagram_direct' as Platform, credentials: { ig_access_token: 'token2', ig_user_id: 'user2' }, active: true, created_at: new Date() });
        mockGetMediaInsights
            .mockResolvedValueOnce(200)
            .mockResolvedValueOnce(300)
            .mockResolvedValueOnce(150);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 3, failed: 0 });
        expect(mockInsertDailyViews).toHaveBeenCalledTimes(2);

        // Account 10: 200 + 300 = 500 views, 2 posts
        const call1Args = mockInsertDailyViews.mock.calls[0];
        expect(call1Args[0]).toBe(10);
        expect(call1Args[2]).toBe(500);
        expect(call1Args[3]).toBe(2);

        // Account 20: 150 views, 1 post
        const call2Args = mockInsertDailyViews.mock.calls[1];
        expect(call2Args[0]).toBe(20);
        expect(call2Args[2]).toBe(150);
        expect(call2Args[3]).toBe(1);
    });

    test('should still write daily views for successful posts when some fail', async () => {
        mockGetPostsNeedingViewsUpdate.mockResolvedValueOnce([
            { id: 1, account_id: 10, instagram_post_id: 'ig_1' },
            { id: 2, account_id: 10, instagram_post_id: null },
        ]);
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
        ]);
        mockGetCredentialsByPlatform.mockResolvedValueOnce(
            { id: 1, account_id: 10, platform: 'instagram_direct' as Platform, credentials: { ig_access_token: 'token1', ig_user_id: 'user1' }, active: true, created_at: new Date() }
        );
        mockGetMediaInsights.mockResolvedValueOnce(200);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 1, failed: 1 });
        expect(mockInsertDailyViews).toHaveBeenCalledTimes(1);
        expect(mockInsertDailyViews.mock.calls[0][2]).toBe(200);
        expect(mockInsertDailyViews.mock.calls[0][3]).toBe(1);
    });
});
