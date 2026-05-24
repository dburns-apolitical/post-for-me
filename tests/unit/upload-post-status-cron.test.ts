import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { Platform, DbCredential, DbAccount, PendingUploadPostPost } from '../../src/types/index';
import type { UploadPostStatusResult } from '../../src/services/upload-post-client';

// --- Mock DatabaseService ---
const mockGetPendingUploadPostPosts = mock((): Promise<PendingUploadPostPost[]> => Promise.resolve([]));
const mockMarkPostSuccess = mock((_postId: number, _igPostId: string | null): Promise<void> => Promise.resolve());
const mockUpdatePostStatus = mock((_postId: number, _status: string): Promise<void> => Promise.resolve());
const mockGetPostAccount = mock((_postId: number): Promise<DbAccount | null> => Promise.resolve(null));
const mockGetCredentialsByPlatform = mock(
    (_accountId: number, _platform: Platform): Promise<DbCredential | null> => Promise.resolve(null),
);
const mockCreateUserPost = mock((_postId: number, _userId: string, _userName: string): Promise<void> => Promise.resolve());

mock.module('../../src/services/database', () => ({
    DatabaseService: class {
        getPendingUploadPostPosts = mockGetPendingUploadPostPosts;
        markPostSuccess = mockMarkPostSuccess;
        updatePostStatus = mockUpdatePostStatus;
        getCredentialsByPlatform = mockGetCredentialsByPlatform;
        createUserPost = mockCreateUserPost;
        getPostAccount = mockGetPostAccount;
    },
}));

// --- Mock UploadPostClientService ---
const mockGetUploadStatus = mock((_requestId: string): Promise<UploadPostStatusResult> =>
    Promise.resolve({ status: 'processing', raw: 'processing', data: {} })
);

mock.module('../../src/services/upload-post-client', () => ({
    UploadPostClientService: class {
        constructor(_apiKey: string, _user: string) {}
        getUploadStatus = mockGetUploadStatus;
    },
}));

// --- Mock VideoSelectorService (for deleteEditedVideo) ---
const mockDeleteEditedVideo = mock((_url: string): Promise<void> => Promise.resolve());

mock.module('../../src/services/video-selector', () => ({
    VideoSelectorService: class {
        constructor(public bucketName: string) {}
        deleteEditedVideo = mockDeleteEditedVideo;
    },
}));

// Import AFTER mocks
import { UploadPostStatusCronService } from '../../src/services/upload-post-status-cron';

function pendingPost(overrides: Partial<PendingUploadPostPost> = {}): PendingUploadPostPost {
    return {
        id: 100,
        upload_post_request_id: 'req-100',
        upload_post_submitted_at: new Date(),
        edited_video_url: 'https://storage.googleapis.com/molars-reels/edited/x.mp4',
        pending_user_id: null,
        pending_user_name: null,
        ...overrides,
    };
}

function account(overrides: Partial<DbAccount> = {}): DbAccount {
    return {
        id: 1,
        name: 'Test Account',
        ig_access_token: '',
        ig_user_id: '',
        gcs_bucket_name: 'molars-reels',
        created_at: new Date(),
        ...overrides,
    };
}

function upCredential(): DbCredential {
    return {
        id: 1,
        account_id: 1,
        platform: 'upload_post' as Platform,
        credentials: { api_key: 'k', user: 'u', instagram: true, youtube: false, tiktok: true, twitter: false },
        active: true,
        created_at: new Date(),
    };
}

describe('UploadPostStatusCronService', () => {
    let service: UploadPostStatusCronService;

    beforeEach(() => {
        mockGetPendingUploadPostPosts.mockClear();
        mockMarkPostSuccess.mockClear();
        mockUpdatePostStatus.mockClear();
        mockGetCredentialsByPlatform.mockClear();
        mockCreateUserPost.mockClear();
        mockDeleteEditedVideo.mockClear();
        mockGetUploadStatus.mockClear();
        mockGetPostAccount.mockClear();
        UploadPostStatusCronService.THROTTLE_MS = 0;
        UploadPostStatusCronService.SAFETY_NET_MS = 60 * 60 * 1000;
        UploadPostStatusCronService.NOT_FOUND_GRACE_MS = 5 * 60 * 1000;
        service = new UploadPostStatusCronService();
    });

    test('returns zero counts when there are no pending posts', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([]);
        const result = await service.tick();
        expect(result).toEqual({ scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 });
        expect(mockGetUploadStatus).not.toHaveBeenCalled();
    });

    test('in-progress status (processing) leaves row alone and counts as stillPending', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost()]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({ status: 'processing', raw: 'processing', data: {} });
        const result = await service.tick();
        expect(result).toEqual({ scanned: 1, completed: 0, failed: 0, stillPending: 1, errors: 0 });
        expect(mockMarkPostSuccess).not.toHaveBeenCalled();
        expect(mockUpdatePostStatus).not.toHaveBeenCalled();
        expect(mockDeleteEditedVideo).not.toHaveBeenCalled();
    });

    test('completed status marks success with instagramPostId and cleans up GCS', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({ id: 50 })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({
            status: 'completed', instagramPostId: 'ig-555', raw: 'completed', data: {},
        });
        const result = await service.tick();
        expect(result.completed).toBe(1);
        expect(mockMarkPostSuccess).toHaveBeenCalledWith(50, 'ig-555');
        expect(mockDeleteEditedVideo).toHaveBeenCalledWith('https://storage.googleapis.com/molars-reels/edited/x.mp4');
    });

    test('completed status creates user_posts row when pending_user_* are set', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({
            id: 51, pending_user_id: 'user-uuid-1', pending_user_name: 'Alice',
        })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({
            status: 'completed', instagramPostId: 'ig-1', raw: 'completed', data: {},
        });
        await service.tick();
        expect(mockCreateUserPost).toHaveBeenCalledWith(51, 'user-uuid-1', 'Alice');
    });

    test('completed status does NOT create user_posts when pending_user_* are null', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost()]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({
            status: 'completed', instagramPostId: 'ig-1', raw: 'completed', data: {},
        });
        await service.tick();
        expect(mockCreateUserPost).not.toHaveBeenCalled();
    });

    test('failed status marks failed and cleans up GCS', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({ id: 60 })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({ status: 'failed', raw: 'failed', data: {} });
        const result = await service.tick();
        expect(result.failed).toBe(1);
        expect(mockUpdatePostStatus).toHaveBeenCalledWith(60, 'failed');
        expect(mockDeleteEditedVideo).toHaveBeenCalledWith('https://storage.googleapis.com/molars-reels/edited/x.mp4');
    });

    test('not_found <5min old is a no-op (counts as stillPending)', async () => {
        const submittedAt = new Date(Date.now() - 60_000);
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({ upload_post_submitted_at: submittedAt })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({ status: 'not_found' });
        const result = await service.tick();
        expect(result.stillPending).toBe(1);
        expect(mockUpdatePostStatus).not.toHaveBeenCalled();
    });

    test('not_found ≥5min old is treated as failed', async () => {
        const submittedAt = new Date(Date.now() - 6 * 60_000);
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({
            id: 70, upload_post_submitted_at: submittedAt,
        })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({ status: 'not_found' });
        const result = await service.tick();
        expect(result.failed).toBe(1);
        expect(mockUpdatePostStatus).toHaveBeenCalledWith(70, 'failed');
    });

    test('1h safety net flips stuck rows to failed WITHOUT calling status endpoint', async () => {
        const submittedAt = new Date(Date.now() - 61 * 60_000);
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({
            id: 80, upload_post_submitted_at: submittedAt,
        })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        const result = await service.tick();
        expect(result.failed).toBe(1);
        expect(mockUpdatePostStatus).toHaveBeenCalledWith(80, 'failed');
        expect(mockGetUploadStatus).not.toHaveBeenCalled();
        expect(mockDeleteEditedVideo).toHaveBeenCalled();
    });

    test('unknown status string is a no-op (regression for the original bug)', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost()]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({
            status: 'unknown', raw: 'mystery-status', data: { status: 'mystery-status' },
        });
        const result = await service.tick();
        expect(result.stillPending).toBe(1);
        expect(mockUpdatePostStatus).not.toHaveBeenCalled();
    });

    test('credential fetch returns null → counts as error, row unchanged', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost()]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(null);
        const result = await service.tick();
        expect(result.errors).toBe(1);
        expect(mockGetUploadStatus).not.toHaveBeenCalled();
        expect(mockUpdatePostStatus).not.toHaveBeenCalled();
    });

    test('account fetch returns null → counts as error, row unchanged', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost()]);
        mockGetPostAccount.mockResolvedValueOnce(null);
        const result = await service.tick();
        expect(result.errors).toBe(1);
        expect(mockGetCredentialsByPlatform).not.toHaveBeenCalled();
        expect(mockGetUploadStatus).not.toHaveBeenCalled();
    });

    test('isRunning guard prevents overlapping ticks', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValue([]);
        const first = service.tick();
        const second = service.tick();
        const [r1, r2] = await Promise.all([first, second]);
        expect(mockGetPendingUploadPostPosts).toHaveBeenCalledTimes(1);
        expect([r1, r2]).toContainEqual({ scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 });
    });

    test('throws from getUploadStatus are caught and counted as errors, loop continues', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([
            pendingPost({ id: 90 }),
            pendingPost({ id: 91 }),
        ]);
        mockGetPostAccount.mockResolvedValueOnce(account()).mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential()).mockResolvedValueOnce(upCredential());
        mockGetUploadStatus
            .mockRejectedValueOnce(new Error('Upload-Post status fetch failed: 500'))
            .mockResolvedValueOnce({ status: 'completed', instagramPostId: 'ig-91', raw: 'completed', data: {} });
        const result = await service.tick();
        expect(result.errors).toBe(1);
        expect(result.completed).toBe(1);
        expect(mockMarkPostSuccess).toHaveBeenCalledWith(91, 'ig-91');
    });
});
