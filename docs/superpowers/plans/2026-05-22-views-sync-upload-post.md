# Views Sync: Switch to Upload-Post Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the views sync cron from calling the Instagram Graph API directly to calling the Upload-Post post-analytics API, and ensure `instagram_post_id` is stored when a post is published via Upload-Post with Instagram enabled.

**Architecture:** Extend `UploadPostClientService` with `getPostAnalytics()` and an enhanced `postVideo()` return that includes `instagramPostId`. Update `post-reel.ts` to capture the post ID from Upload-Post results. Swap the credential lookup and API call in `views-sync-cron.ts`.

**Tech Stack:** Bun, TypeScript, bun:test for unit tests. All tests run with `bun test <path>`.

---

## File Map

| File | Change |
|------|--------|
| `src/services/upload-post-client.ts` | Add `getPostAnalytics()` method; extend `postVideo()` return type to include `instagramPostId` |
| `src/routes/post-reel.ts` | Assign `instagramPostId` from Upload-Post result when not already set |
| `src/services/views-sync-cron.ts` | Switch from `instagram_direct` creds + `InstagramClientService` to `upload_post` creds + `UploadPostClientService` |
| `tests/unit/upload-post-client.test.ts` | Create new — tests for `getPostAnalytics()` and extended `postVideo()` return |
| `tests/unit/views-sync-cron.test.ts` | Update mocks and credential fixtures |

---

## Task 1: Add `getPostAnalytics()` to `UploadPostClientService`

**Files:**
- Create: `tests/unit/upload-post-client.test.ts`
- Modify: `src/services/upload-post-client.ts`

- [ ] **Step 1: Create the test file with failing tests for `getPostAnalytics()`**

Create `tests/unit/upload-post-client.test.ts`:

```typescript
import { describe, test, expect, mock, afterEach } from 'bun:test';
import { UploadPostClientService } from '../../src/services/upload-post-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('UploadPostClientService', () => {
    describe('getPostAnalytics', () => {
        test('returns views count from Instagram post_metrics', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    platforms: {
                        instagram: {
                            post_metrics: { views: 1234, likes: 56 },
                        },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const views = await client.getPostAnalytics('ig-post-123');

            expect(views).toBe(1234);
            const [url, options] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
            expect(url).toContain('platform_post_id=ig-post-123');
            expect(url).toContain('platform=instagram');
            expect(url).toContain('user=test-user');
            expect((options.headers as Record<string, string>)['Authorization']).toBe('Apikey test-api-key');
        });

        test('throws when API response is not ok', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 401,
                json: () => Promise.resolve({ error: 'Unauthorized' }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getPostAnalytics('ig-post-123')).rejects.toThrow();
        });

        test('throws when views field is absent in response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    platforms: { instagram: { post_metrics: {} } },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getPostAnalytics('ig-post-123')).rejects.toThrow('Views metric not found');
        });
    });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
bun test tests/unit/upload-post-client.test.ts
```

Expected: FAIL — `getPostAnalytics is not a function` or similar.

- [ ] **Step 3: Implement `getPostAnalytics()` in `src/services/upload-post-client.ts`**

Add this method to the `UploadPostClientService` class, after `pollForCompletion`:

```typescript
async getPostAnalytics(platformPostId: string): Promise<number> {
    const url = `${this.baseUrl}/uploadposts/post-analytics?platform_post_id=${encodeURIComponent(platformPostId)}&platform=instagram&user=${encodeURIComponent(this.user)}`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Apikey ${this.apiKey}` },
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
        logger.error('Upload-Post post-analytics request failed', {
            status: response.status,
            platformPostId,
        });
        throw new Error(`Failed to fetch post analytics: ${response.status}`);
    }

    const platforms = data.platforms as Record<string, Record<string, unknown>> | undefined;
    const postMetrics = platforms?.instagram?.post_metrics as Record<string, unknown> | undefined;
    const views = postMetrics?.views;

    if (typeof views !== 'number') {
        throw new Error(`Views metric not found in post analytics response for post ${platformPostId}`);
    }

    logger.debug('Retrieved post analytics', { platformPostId, views });
    return views;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
bun test tests/unit/upload-post-client.test.ts
```

Expected: All 3 `getPostAnalytics` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/upload-post-client.ts tests/unit/upload-post-client.test.ts
git commit -m "feat: add getPostAnalytics method to UploadPostClientService"
```

---

## Task 2: Extend `postVideo()` to return `instagramPostId`

**Files:**
- Modify: `tests/unit/upload-post-client.test.ts`
- Modify: `src/services/upload-post-client.ts`

- [ ] **Step 1: Add failing tests for the extended `postVideo()` return**

Append a new `describe('postVideo')` block to `tests/unit/upload-post-client.test.ts`, after the `getPostAnalytics` block:

```typescript
    describe('postVideo instagramPostId extraction', () => {
        test('returns instagramPostId from sync response results.instagram.post_id', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    request_id: 'req-123',
                    results: {
                        instagram: { post_id: 'ig-456', success: true },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.postVideo('https://video.url', 'caption', [], ['instagram']);

            expect(result.success).toBe(true);
            expect(result.instagramPostId).toBe('ig-456');
        });

        test('falls back to publish_id when post_id is absent', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    request_id: 'req-123',
                    results: {
                        instagram: { publish_id: 'pub-789', success: true },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.postVideo('https://video.url', 'caption', [], ['instagram']);

            expect(result.success).toBe(true);
            expect(result.instagramPostId).toBe('pub-789');
        });

        test('returns undefined instagramPostId when Instagram is not in results', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    request_id: 'req-123',
                    results: {
                        youtube: { video_id: 'yt-123', success: true },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.postVideo('https://video.url', 'caption', [], ['youtube']);

            expect(result.success).toBe(true);
            expect(result.instagramPostId).toBeUndefined();
        });
    });
```

- [ ] **Step 2: Run the tests to confirm the new ones fail**

```bash
bun test tests/unit/upload-post-client.test.ts
```

Expected: The 3 new `postVideo instagramPostId extraction` tests FAIL; existing tests still pass.

- [ ] **Step 3: Update `postVideo()` and `pollForCompletion()` in `src/services/upload-post-client.ts`**

**3a. Change the `postVideo()` return type signature** (line ~22):

```typescript
async postVideo(
    videoUrl: string,
    caption: string,
    hashtags: string[],
    platforms: string[]
): Promise<{ success: boolean; requestId?: string; instagramPostId?: string }> {
```

**3b. In the sync response path** (the block after the `if (requestId && !data.results)` check), replace the final return:

```typescript
// Before:
return { success: true, requestId: requestId || undefined };

// After:
const igResult = (data.results as Record<string, Record<string, unknown>> | undefined)?.instagram;
const instagramPostId = (igResult?.post_id ?? igResult?.publish_id) as string | undefined;
return { success: true, requestId: requestId || undefined, instagramPostId: instagramPostId || undefined };
```

**3c. Update `pollForCompletion()` return type signature** (private method, ~line 94):

```typescript
private async pollForCompletion(
    requestId: string,
    platforms: string[],
    maxAttempts: number = 20,
    intervalMs: number = 15000
): Promise<{ success: boolean; requestId?: string; instagramPostId?: string }> {
```

**3d. In `pollForCompletion()`, update the `status === 'completed'` return**:

```typescript
// Before:
if (status === 'completed') {
    return { success: true, requestId };
}

// After:
if (status === 'completed') {
    const igResult = (data.results as Record<string, Record<string, unknown>> | undefined)?.instagram;
    const instagramPostId = (igResult?.post_id ?? igResult?.publish_id) as string | undefined;
    return { success: true, requestId, instagramPostId: instagramPostId || undefined };
}
```

**3e. Update the `pollForCompletion()` failure return** (at end of loop):

```typescript
// Before:
logger.error('Upload-Post polling timed out', { requestId, maxAttempts, platforms });
return { success: false, requestId };

// After:
logger.error('Upload-Post polling timed out', { requestId, maxAttempts, platforms });
return { success: false, requestId, instagramPostId: undefined };
```

Also update the non-pending/in_progress status return:

```typescript
// Before:
return { success: false, requestId };

// After:
return { success: false, requestId, instagramPostId: undefined };
```

- [ ] **Step 4: Run all upload-post-client tests to confirm they pass**

```bash
bun test tests/unit/upload-post-client.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/upload-post-client.ts tests/unit/upload-post-client.test.ts
git commit -m "feat: return instagramPostId from postVideo when available in Upload-Post response"
```

---

## Task 3: Capture `instagramPostId` from Upload-Post result in `post-reel.ts`

**Files:**
- Modify: `src/routes/post-reel.ts`

This change adds 3 lines to `processPostInBackground`. The correctness of the `instagramPostId` value is already verified by the `postVideo()` tests above.

- [ ] **Step 1: Locate the Upload-Post promise block in `src/routes/post-reel.ts`**

Find this block (around line 117–131):

```typescript
const result = await uploadPostClient.postVideo(
    editedVideoUrl!,
    caption,
    hashtags,
    uploadPostPlatforms
);

if (!result.success && !igCredential) {
    throw new Error('Upload-Post posting failed and no instagram_direct fallback');
}
```

- [ ] **Step 2: Add `instagramPostId` capture after the `postVideo()` call**

```typescript
const result = await uploadPostClient.postVideo(
    editedVideoUrl!,
    caption,
    hashtags,
    uploadPostPlatforms
);

if (result.instagramPostId && !instagramPostId) {
    instagramPostId = result.instagramPostId;
}

if (!result.success && !igCredential) {
    throw new Error('Upload-Post posting failed and no instagram_direct fallback');
}
```

The `instagramPostId` variable is already declared at the top of `processPostInBackground` as `let instagramPostId: string | null = null` and is passed to `db.markPostSuccess(postId, instagramPostId)` at the end — no other changes needed.

- [ ] **Step 3: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: store instagram_post_id from Upload-Post response when publishing via upload_post"
```

---

## Task 4: Update `views-sync-cron.ts` and its tests

**Files:**
- Modify: `tests/unit/views-sync-cron.test.ts`
- Modify: `src/services/views-sync-cron.ts`

- [ ] **Step 1: Update the mocks and fixtures in `tests/unit/views-sync-cron.test.ts`**

Replace the entire file with the updated version below. The changes are: `InstagramClientService` mock → `UploadPostClientService` mock; `instagram_direct` credential fixtures → `upload_post`; `mockGetMediaInsights` → `mockGetPostAnalytics`. All test assertions stay the same.

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { DbCredential, Platform } from '../../src/types/index';

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

const mockGetPostAnalytics = mock(() => Promise.resolve(100));

mock.module('../../src/services/upload-post-client', () => ({
    UploadPostClientService: class {
        constructor() {}
        getPostAnalytics = mockGetPostAnalytics;
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
        mockGetPostAnalytics.mockClear();
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
        mockGetPostAnalytics
            .mockResolvedValueOnce(200)
            .mockResolvedValueOnce(300)
            .mockResolvedValueOnce(150);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 3, failed: 0 });
        expect(mockInsertDailyViews).toHaveBeenCalledTimes(2);

        const call1Args = mockInsertDailyViews.mock.calls[0];
        expect(call1Args[0]).toBe(10);
        expect(call1Args[2]).toBe(500);
        expect(call1Args[3]).toBe(2);

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
        mockGetCredentialsByPlatform.mockResolvedValueOnce({
            id: 1, account_id: 10, platform: 'upload_post' as Platform,
            credentials: { api_key: 'key1', user: 'upuser1', instagram: true, youtube: false, tiktok: false, twitter: false },
            active: true, created_at: new Date(),
        });
        mockGetPostAnalytics.mockResolvedValueOnce(200);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 1, failed: 1 });
        expect(mockInsertDailyViews).toHaveBeenCalledTimes(1);
        expect(mockInsertDailyViews.mock.calls[0][2]).toBe(200);
        expect(mockInsertDailyViews.mock.calls[0][3]).toBe(1);
    });
});
```

- [ ] **Step 2: Run the tests to confirm they now fail (since the implementation hasn't changed yet)**

```bash
bun test tests/unit/views-sync-cron.test.ts
```

Expected: Tests fail — the cron is still looking up `instagram_direct` credentials and calling `InstagramClientService`.

- [ ] **Step 3: Update `src/services/views-sync-cron.ts`**

Replace the imports at the top:

```typescript
// Before:
import { DatabaseService } from './database.js';
import { InstagramClientService } from './instagram-client.js';
import { logger } from '../utils/logger.js';
import type { InstagramDirectCredentials } from '../types/index.js';

// After:
import { DatabaseService } from './database.js';
import { UploadPostClientService } from './upload-post-client.js';
import { logger } from '../utils/logger.js';
import type { UploadPostCredentials } from '../types/index.js';
```

Replace the credential map type and lookup in `syncViews()`:

```typescript
// Before:
const credentialMap = new Map<number, { ig_access_token: string; ig_user_id: string }>();
for (const account of accounts) {
    const credential = await this.db.getCredentialsByPlatform(account.id, 'instagram_direct');
    if (credential) {
        credentialMap.set(account.id, credential.credentials as InstagramDirectCredentials);
    }
}

// After:
const credentialMap = new Map<number, { api_key: string; user: string }>();
for (const account of accounts) {
    const credential = await this.db.getCredentialsByPlatform(account.id, 'upload_post');
    if (credential) {
        const creds = credential.credentials as UploadPostCredentials;
        credentialMap.set(account.id, { api_key: creds.api_key, user: creds.user });
    }
}
```

Replace the per-post credential warning log message and the API call:

```typescript
// Before:
if (!creds) {
    logger.warn('No instagram_direct credentials found for account, skipping', { accountId: post.account_id });
    failed++;
    continue;
}
const instagram = new InstagramClientService(creds.ig_access_token, creds.ig_user_id);
const views = await instagram.getMediaInsights(post.instagram_post_id);

// After:
if (!creds) {
    logger.warn('No upload_post credentials found for account, skipping', { accountId: post.account_id });
    failed++;
    continue;
}
const uploadPost = new UploadPostClientService(creds.api_key, creds.user);
const views = await uploadPost.getPostAnalytics(post.instagram_post_id);
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
bun test tests/unit/views-sync-cron.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Run the full test suite to confirm nothing is broken**

```bash
bun test tests/unit/
```

Expected: All unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/views-sync-cron.ts tests/unit/views-sync-cron.test.ts
git commit -m "feat: switch views sync cron from instagram_direct to upload_post credentials and analytics API"
```
