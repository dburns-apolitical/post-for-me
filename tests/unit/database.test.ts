import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PostStatus } from '../../src/types/index';

// Mock the neon module before importing DatabaseService
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { DatabaseService } from '../../src/services/database';

describe('DatabaseService', () => {
    let db: DatabaseService;

    beforeEach(() => {
        mockSql.mockClear();
        db = new DatabaseService();
    });

    describe('upsertCaption', () => {
        test('should insert and return caption', async () => {
            const mockCaption = { id: 1, text: 'Test caption', enabled: true, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCaption]);

            const result = await db.upsertCaption('Test caption');

            expect(result).toEqual(mockCaption);
        });
    });

    describe('upsertHashtag', () => {
        test('should insert and return hashtag', async () => {
            const mockHashtag = { id: 1, text: 'test', created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockHashtag]);

            const result = await db.upsertHashtag('test');

            expect(result).toEqual(mockHashtag);
        });
    });

    describe('upsertHook', () => {
        test('should insert and return hook', async () => {
            const mockHook = { id: 1, text: 'Test hook', enabled: true, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockHook]);

            const result = await db.upsertHook('Test hook');

            expect(result).toEqual(mockHook);
        });
    });

    describe('upsertVideo', () => {
        test('should insert and return video', async () => {
            const mockVideo = { id: 1, title: 'video.mp4', created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockVideo]);

            const result = await db.upsertVideo('video.mp4');

            expect(result).toEqual(mockVideo);
        });
    });

    describe('findOrCreateHashtagCombination', () => {
        test('should return existing combination if found', async () => {
            const mockCombination = {
                id: 1,
                hashtag1_id: 1,
                hashtag2_id: 2,
                hashtag3_id: null,
                hashtag4_id: null,
                hashtag5_id: null,
                created_at: new Date(),
            };
            mockSql.mockResolvedValueOnce([mockCombination]);

            const result = await db.findOrCreateHashtagCombination([1, 2]);

            expect(result).toEqual(mockCombination);
        });

        test('should create new combination if not found', async () => {
            const mockCombination = {
                id: 2,
                hashtag1_id: 1,
                hashtag2_id: 2,
                hashtag3_id: 3,
                hashtag4_id: null,
                hashtag5_id: null,
                created_at: new Date(),
            };
            // First call returns empty (not found)
            mockSql.mockResolvedValueOnce([]);
            // Second call returns the created combination
            mockSql.mockResolvedValueOnce([mockCombination]);

            const result = await db.findOrCreateHashtagCombination([1, 2, 3]);

            expect(result).toEqual(mockCombination);
        });
    });

    describe('createPost', () => {
        test('should create post with pending status and default accountId', async () => {
            const mockPost = {
                id: 1,
                video_id: 1,
                hook_id: 1,
                caption_id: 1,
                hashtag_combination_id: 1,
                instagram_post_id: null,
                views: null,
                status: 'pending' as PostStatus,
                account_id: 2,
                shared_to_feed: false,
                created_at: new Date(),
                updated_at: new Date(),
            };
            mockSql.mockResolvedValueOnce([mockPost]);

            const result = await db.createPost(1, 1, 1, 1);

            expect(result).toEqual(mockPost);
            expect(result.status).toBe('pending');
            expect(result.account_id).toBe(2);
        });

        test('should create post with specified accountId', async () => {
            const mockPost = {
                id: 2,
                video_id: 1,
                hook_id: 1,
                caption_id: 1,
                hashtag_combination_id: 1,
                instagram_post_id: null,
                views: null,
                status: 'pending' as PostStatus,
                account_id: 1,
                shared_to_feed: false,
                created_at: new Date(),
                updated_at: new Date(),
            };
            mockSql.mockResolvedValueOnce([mockPost]);

            const result = await db.createPost(1, 1, 1, 1, false, 1);

            expect(result).toEqual(mockPost);
            expect(result.account_id).toBe(1);
        });
    });

    describe('markPostSuccess', () => {
        test('should update post with success status and Instagram post ID', async () => {
            mockSql.mockResolvedValueOnce([]);

            await expect(db.markPostSuccess(1, 'ig_12345')).resolves.toBeUndefined();
        });
    });

    describe('updatePostStatus', () => {
        test('should update post status', async () => {
            mockSql.mockResolvedValueOnce([]);

            await expect(db.updatePostStatus(1, 'success')).resolves.toBeUndefined();
        });
    });

    describe('markPendingPostsAsFailed', () => {
        test('should return count of marked posts', async () => {
            mockSql.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

            const result = await db.markPendingPostsAsFailed();

            expect(result).toBe(2);
        });

        test('should return 0 when no pending posts', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.markPendingPostsAsFailed();

            expect(result).toBe(0);
        });
    });

    describe('getPostedVideoTitles', () => {
        test('should return array of video titles for account', async () => {
            mockSql.mockResolvedValueOnce([
                { title: 'video1.mp4' },
                { title: 'video2.mp4' },
            ]);

            const result = await db.getPostedVideoTitles(2);

            expect(result).toEqual(['video1.mp4', 'video2.mp4']);
        });

        test('should return empty array when no videos for account', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getPostedVideoTitles(1);

            expect(result).toEqual([]);
        });
    });

    describe('getRandomCaption', () => {
        test('should return random caption', async () => {
            const mockCaption = { id: 1, text: 'Random caption', enabled: true, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCaption]);

            const result = await db.getRandomCaption(1);

            expect(result).toEqual(mockCaption);
        });

        test('should return null when no captions', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getRandomCaption(1);

            expect(result).toBeNull();
        });
    });

    describe('getRandomHook', () => {
        test('should return random hook', async () => {
            const mockHook = { id: 1, text: 'Random hook', enabled: true, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockHook]);

            const result = await db.getRandomHook(1);

            expect(result).toEqual(mockHook);
        });

        test('should return null when no hooks', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getRandomHook(1);

            expect(result).toBeNull();
        });
    });

    describe('getRandomHashtags', () => {
        test('should return random hashtags', async () => {
            const mockHashtags = [
                { id: 1, text: 'tag1', created_at: new Date() },
                { id: 2, text: 'tag2', created_at: new Date() },
            ];
            mockSql.mockResolvedValueOnce(mockHashtags);

            const result = await db.getRandomHashtags(5);

            expect(result).toEqual(mockHashtags);
        });

        test('should return empty array when no hashtags', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getRandomHashtags(5);

            expect(result).toEqual([]);
        });
    });

    describe('count methods', () => {
        test('getCaptionCount should return count', async () => {
            mockSql.mockResolvedValueOnce([{ count: '5' }]);

            const result = await db.getCaptionCount();

            expect(result).toBe(5);
        });

        test('getHookCount should return count', async () => {
            mockSql.mockResolvedValueOnce([{ count: '10' }]);

            const result = await db.getHookCount();

            expect(result).toBe(10);
        });

        test('getHashtagCount should return count', async () => {
            mockSql.mockResolvedValueOnce([{ count: '20' }]);

            const result = await db.getHashtagCount();

            expect(result).toBe(20);
        });
    });

    describe('getAccounts', () => {
        test('should return all accounts', async () => {
            const mockAccounts = [
                { id: 1, name: 'Molars UK (MAIN ACCOUNT)', ig_access_token: 'token1', ig_user_id: 'user1', gcs_bucket_name: 'bucket1', created_at: new Date() },
                { id: 2, name: 'MLRSUK (BACKUP ACCOUNT)', ig_access_token: 'token2', ig_user_id: 'user2', gcs_bucket_name: 'bucket2', created_at: new Date() },
            ];
            mockSql.mockResolvedValueOnce(mockAccounts);

            const result = await db.getAccounts();

            expect(result).toEqual(mockAccounts);
            expect(result).toHaveLength(2);
        });
    });

    describe('getAllCaptions', () => {
        test('should return all captions ordered by created_at desc', async () => {
            const mockCaptions = [
                { id: 2, text: 'Newer caption', enabled: true, created_at: new Date('2025-02-01') },
                { id: 1, text: 'Older caption', enabled: false, created_at: new Date('2025-01-01') },
            ];
            mockSql.mockResolvedValueOnce(mockCaptions);

            const result = await db.getAllCaptions();

            expect(result).toEqual(mockCaptions);
            expect(result).toHaveLength(2);
        });

        test('should return empty array when no captions', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getAllCaptions();

            expect(result).toEqual([]);
        });

        test('should filter enabled only when enabledOnly is true', async () => {
            const mockCaptions = [
                { id: 2, text: 'Enabled caption', enabled: true, created_at: new Date('2025-02-01') },
            ];
            mockSql.mockResolvedValueOnce(mockCaptions);

            const result = await db.getAllCaptions(true);

            expect(result).toEqual(mockCaptions);
        });
    });

    describe('getAllHooks', () => {
        test('should return all hooks ordered by created_at desc', async () => {
            const mockHooks = [
                { id: 2, text: 'Newer hook', enabled: true, created_at: new Date('2025-02-01') },
                { id: 1, text: 'Older hook', enabled: false, created_at: new Date('2025-01-01') },
            ];
            mockSql.mockResolvedValueOnce(mockHooks);

            const result = await db.getAllHooks();

            expect(result).toEqual(mockHooks);
            expect(result).toHaveLength(2);
        });

        test('should return empty array when no hooks', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getAllHooks();

            expect(result).toEqual([]);
        });

        test('should filter enabled only when enabledOnly is true', async () => {
            const mockHooks = [
                { id: 1, text: 'Enabled hook', enabled: true, created_at: new Date('2025-02-01') },
            ];
            mockSql.mockResolvedValueOnce(mockHooks);

            const result = await db.getAllHooks(true);

            expect(result).toEqual(mockHooks);
        });
    });

    describe('createCaption', () => {
        test('should create and return a caption', async () => {
            const mockCaption = { id: 1, text: 'New caption', enabled: true, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCaption]);

            const result = await db.createCaption('New caption');

            expect(result).toEqual(mockCaption);
        });

        test('should return null on duplicate caption', async () => {
            const error = new Error('unique constraint violation');
            (error as any).code = '23505';
            mockSql.mockRejectedValueOnce(error);

            const result = await db.createCaption('Duplicate caption');

            expect(result).toBeNull();
        });

        test('should return null when error message includes unique', async () => {
            mockSql.mockRejectedValueOnce(new Error('unique constraint'));

            const result = await db.createCaption('Duplicate caption');

            expect(result).toBeNull();
        });

        test('should rethrow non-unique errors', async () => {
            mockSql.mockRejectedValueOnce(new Error('connection failed'));

            await expect(db.createCaption('Some caption')).rejects.toThrow('connection failed');
        });
    });

    describe('createHook', () => {
        test('should create and return a hook', async () => {
            const mockHook = { id: 1, text: 'New hook', enabled: true, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockHook]);

            const result = await db.createHook('New hook');

            expect(result).toEqual(mockHook);
        });

        test('should return null on duplicate hook', async () => {
            const error = new Error('unique constraint violation');
            (error as any).code = '23505';
            mockSql.mockRejectedValueOnce(error);

            const result = await db.createHook('Duplicate hook');

            expect(result).toBeNull();
        });

        test('should rethrow non-unique errors', async () => {
            mockSql.mockRejectedValueOnce(new Error('connection failed'));

            await expect(db.createHook('Some hook')).rejects.toThrow('connection failed');
        });
    });

    describe('updateCaptionEnabled', () => {
        test('should update and return caption', async () => {
            const mockCaption = { id: 1, text: 'Test caption', enabled: false, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCaption]);

            const result = await db.updateCaptionEnabled(1, false);

            expect(result).toEqual(mockCaption);
            expect(result!.enabled).toBe(false);
        });

        test('should return null when caption not found', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.updateCaptionEnabled(999, false);

            expect(result).toBeNull();
        });
    });

    describe('updateHookEnabled', () => {
        test('should update and return hook', async () => {
            const mockHook = { id: 1, text: 'Test hook', enabled: false, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockHook]);

            const result = await db.updateHookEnabled(1, false);

            expect(result).toEqual(mockHook);
            expect(result!.enabled).toBe(false);
        });

        test('should return null when hook not found', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.updateHookEnabled(999, false);

            expect(result).toBeNull();
        });
    });

    describe('createUserPost', () => {
        test('should insert user_post record', async () => {
            mockSql.mockResolvedValueOnce([]);

            await expect(
                db.createUserPost(1, '70668aac-f6e0-4b40-b1f7-b7b4e0a72613', 'Molars')
            ).resolves.toBeUndefined();
        });
    });

    describe('insertDailyViews', () => {
        test('should insert daily views record', async () => {
            mockSql.mockResolvedValueOnce([]);

            await db.insertDailyViews(1, new Date('2026-03-13'), 500, 3);

            expect(mockSql).toHaveBeenCalled();
        });
    });
});
