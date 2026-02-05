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
            const mockCaption = { id: 1, text: 'Test caption', created_at: new Date() };
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
            const mockHook = { id: 1, text: 'Test hook', created_at: new Date() };
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
            const mockCaption = { id: 1, text: 'Random caption', created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCaption]);

            const result = await db.getRandomCaption();

            expect(result).toEqual(mockCaption);
        });

        test('should return null when no captions', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getRandomCaption();

            expect(result).toBeNull();
        });
    });

    describe('getRandomHook', () => {
        test('should return random hook', async () => {
            const mockHook = { id: 1, text: 'Random hook', created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockHook]);

            const result = await db.getRandomHook();

            expect(result).toEqual(mockHook);
        });

        test('should return null when no hooks', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getRandomHook();

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
                { id: 1, name: 'Molars UK (MAIN ACCOUNT)', created_at: new Date() },
                { id: 2, name: 'MLRSUK (BACKUP ACCOUNT)', created_at: new Date() },
            ];
            mockSql.mockResolvedValueOnce(mockAccounts);

            const result = await db.getAccounts();

            expect(result).toEqual(mockAccounts);
            expect(result).toHaveLength(2);
        });
    });
});
