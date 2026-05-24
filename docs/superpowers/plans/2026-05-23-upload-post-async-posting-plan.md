# Upload-Post async posting (persisted polling) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-request poll loop with a persisted polling cron, drop the `instagram_direct` posting path, and fix the bug where Upload-Post's `processing` status was treated as terminal failure.

**Architecture:** `POST /api/post-reel` still returns 202 immediately and runs `processPostInBackground` via `setImmediate`. The background worker submits to Upload-Post with `async_upload=true` after persisting a client-generated `request_id` on the `posts` row, then exits. A new `UploadPostStatusCronService` ticks every 10s, scans `posts WHERE status='pending' AND upload_post_request_id IS NOT NULL`, polls Upload-Post's status endpoint, and flips rows to `success`/`failed` (also clearing the GCS edited video at that point). A 1-hour safety net catches stuck rows.

**Tech Stack:** Bun runtime, TypeScript, Neon Postgres (`@neondatabase/serverless`), Bun's built-in test runner with `mock.module`.

**Important per-user convention:** Do NOT run `git commit`. "Stage" steps in this plan stop at `git add ...`; the user takes it from there.

**Reference spec:** `docs/superpowers/specs/2026-05-23-upload-post-async-posting-design.md`
**Upload-Post API reference:** `docs/upload-post-llm-context.txt` (lines 2530–2644 cover the `/uploadposts/status` endpoint and status semantics; lines 2987–3377 cover `/api/upload` and `async_upload`).

**FE contract (no changes required):** `usePostStatus.ts` in `molars-admin-dashboard` polls `GET /api/post-status?postId=X` every 10s and stops on terminal `success`/`failed`. The response shape (`{ success, post: { id, status, instagram_post_id, views, video, hook, caption, hashtags } }`) is preserved by this plan.

---

## Task 1: DB schema migration + new/modified DatabaseService methods

**Files:**
- Modify: `src/services/database.ts` — schema in `initializeSchema()`, new methods, modify three existing methods
- Modify: `src/types/index.ts` — augment `DbPost` and `PostStatus`-adjacent types
- Modify: `tests/unit/database.test.ts` — add new method tests, update existing

This task is additive at the SQL level (only `ALTER TABLE … ADD COLUMN`) and additive at the API level (new methods are new symbols; modified methods keep their existing signature but extend behavior).

- [ ] **Step 1.1: Write the failing test for `markUploadPostSubmitting`**

Add a new `describe` block in `tests/unit/database.test.ts`, immediately after the existing `describe('markPostSuccess', …)`:

```ts
describe('markUploadPostSubmitting', () => {
    test('persists request_id, submitted_at (NOW()), edited_video_url, and optional pending user info', async () => {
        mockSql.mockResolvedValueOnce([]);

        await db.markUploadPostSubmitting(
            42,
            'req-abc',
            'https://storage.googleapis.com/bucket/edited/x.mp4',
            'user-uuid',
            'Alice',
        );

        expect(mockSql).toHaveBeenCalledTimes(1);
        // The neon SQL tagged-template call records the parameters in mockSql.mock.calls[0].
        // We assert the positional bind values include all five.
        const args = mockSql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
        expect(args.slice(1)).toEqual(['req-abc', 'https://storage.googleapis.com/bucket/edited/x.mp4', 'user-uuid', 'Alice', 42]);
    });

    test('accepts optional pending user info as undefined', async () => {
        mockSql.mockResolvedValueOnce([]);

        await db.markUploadPostSubmitting(
            7,
            'req-xyz',
            'https://storage.googleapis.com/bucket/edited/y.mp4',
        );

        const args = mockSql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
        expect(args.slice(1)).toEqual(['req-xyz', 'https://storage.googleapis.com/bucket/edited/y.mp4', null, null, 7]);
    });
});
```

- [ ] **Step 1.2: Run the new tests and confirm they fail**

Run: `bun test tests/unit/database.test.ts -t "markUploadPostSubmitting"`

Expected: FAIL with `db.markUploadPostSubmitting is not a function`.

- [ ] **Step 1.3: Add `markUploadPostSubmitting` to `DatabaseService`**

Insert immediately after `markPostSuccess` in `src/services/database.ts` (around line 588):

```ts
    /**
     * Persist the Upload-Post request_id and submission timestamp on a post, along with
     * the GCS edited video URL (so the status cron can clean it up on terminal transition)
     * and the optional pending user info (so the status cron can create the user_posts
     * row on success). All five fields are written in one UPDATE.
     */
    async markUploadPostSubmitting(
        postId: number,
        requestId: string,
        editedVideoUrl: string,
        pendingUserId?: string,
        pendingUserName?: string,
    ): Promise<void> {
        await this.sql`
            UPDATE posts
            SET upload_post_request_id = ${requestId},
                upload_post_submitted_at = NOW(),
                edited_video_url = ${editedVideoUrl},
                pending_user_id = ${pendingUserId ?? null},
                pending_user_name = ${pendingUserName ?? null},
                updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as upload-post-submitting', { postId, requestId });
    }
```

- [ ] **Step 1.4: Run the new tests and confirm they pass**

Run: `bun test tests/unit/database.test.ts -t "markUploadPostSubmitting"`

Expected: PASS (2 tests).

- [ ] **Step 1.5: Write the failing test for `getPendingUploadPostPosts`**

Add immediately after the `markUploadPostSubmitting` describe block:

```ts
describe('getPendingUploadPostPosts', () => {
    test('returns rows with the columns the cron needs', async () => {
        const rows = [
            {
                id: 100,
                upload_post_request_id: 'req-100',
                upload_post_submitted_at: new Date('2026-05-23T10:00:00Z'),
                edited_video_url: 'https://storage.googleapis.com/b/edited/a.mp4',
                pending_user_id: null,
                pending_user_name: null,
            },
            {
                id: 101,
                upload_post_request_id: 'req-101',
                upload_post_submitted_at: new Date('2026-05-23T10:05:00Z'),
                edited_video_url: 'https://storage.googleapis.com/b/edited/b.mp4',
                pending_user_id: 'user-2',
                pending_user_name: 'Bob',
            },
        ];
        mockSql.mockResolvedValueOnce(rows);

        const result = await db.getPendingUploadPostPosts();

        expect(result).toEqual(rows);
        expect(mockSql).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 1.6: Run the test and confirm it fails**

Run: `bun test tests/unit/database.test.ts -t "getPendingUploadPostPosts"`

Expected: FAIL with `db.getPendingUploadPostPosts is not a function`.

- [ ] **Step 1.7: Add `getPendingUploadPostPosts` and the result type**

In `src/types/index.ts`, add (place near other DB-row types):

```ts
export interface PendingUploadPostPost {
    id: number;
    upload_post_request_id: string;
    upload_post_submitted_at: Date;
    edited_video_url: string | null;
    pending_user_id: string | null;
    pending_user_name: string | null;
}
```

In `src/services/database.ts`, add to the top-level imports of types:

```ts
import type {
    PostStatus,
    DbAccount,
    DbCaption,
    DbCaptionWithAccounts,
    DbHashtag,
    DbHook,
    DbHookWithAccounts,
    DbHashtagCombination,
    DbVideo,
    DbPost,
    PostWithDetails,
    AgentEvaluation,
    ContentAccount,
    DbCredential,
    Platform,
    PendingUploadPostPost,  // <- add this
} from '../types/index.js';
```

Insert immediately after `markUploadPostSubmitting`:

```ts
    /**
     * Returns all posts currently being tracked by the Upload-Post status cron:
     * status='pending' AND a request_id has been persisted. The cron iterates these
     * each tick and polls Upload-Post's /uploadposts/status endpoint.
     */
    async getPendingUploadPostPosts(): Promise<PendingUploadPostPost[]> {
        return await this.sql`
            SELECT id,
                   upload_post_request_id,
                   upload_post_submitted_at,
                   edited_video_url,
                   pending_user_id,
                   pending_user_name
            FROM posts
            WHERE status = 'pending'
              AND upload_post_request_id IS NOT NULL
            ORDER BY upload_post_submitted_at ASC
        ` as PendingUploadPostPost[];
    }
```

- [ ] **Step 1.8: Run the test and confirm it passes**

Run: `bun test tests/unit/database.test.ts -t "getPendingUploadPostPosts"`

Expected: PASS.

- [ ] **Step 1.9: Write the failing test for tightened `markPendingPostsAsFailed`**

Find the existing `describe('markPendingPostsAsFailed', …)` block in `tests/unit/database.test.ts` and replace it entirely with:

```ts
describe('markPendingPostsAsFailed', () => {
    test('returns count of stale rows that were marked failed', async () => {
        mockSql.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

        const result = await db.markPendingPostsAsFailed();

        expect(result).toBe(2);
    });

    test('returns 0 when there are no stale rows', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await db.markPendingPostsAsFailed();

        expect(result).toBe(0);
    });

    test('skips in-flight rows (status=pending, request_id set, submitted < 1h ago)', async () => {
        // We can't directly assert SQL WHERE clauses against the mocked tag, but we can
        // assert exactly one SQL call is made and capture the template string for inspection.
        mockSql.mockResolvedValueOnce([]);

        await db.markPendingPostsAsFailed();

        expect(mockSql).toHaveBeenCalledTimes(1);
        const args = mockSql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
        const sqlText = args[0].join('?');
        expect(sqlText).toContain("status = 'failed'");
        expect(sqlText).toContain("status = 'pending'");
        expect(sqlText).toContain('upload_post_request_id IS NULL');
        expect(sqlText).toContain("upload_post_submitted_at < NOW() - INTERVAL '1 hour'");
    });
});
```

- [ ] **Step 1.10: Run the tests and confirm they fail**

Run: `bun test tests/unit/database.test.ts -t "markPendingPostsAsFailed"`

Expected: FAIL on the "skips in-flight rows" assertions (the current SQL doesn't reference the new columns).

- [ ] **Step 1.11: Tighten `markPendingPostsAsFailed`**

Replace the existing `markPendingPostsAsFailed` method in `src/services/database.ts` (around lines 591–605) with:

```ts
    /**
     * Crash-recovery: mark posts as failed if they're stuck in pending and either
     *   (a) never got submitted to Upload-Post (no request_id), or
     *   (b) have been awaiting Upload-Post for more than 1 hour (matches Upload-Post's own
     *       "no activity for >1h → failed" rule).
     * In-flight rows submitted less than 1h ago are left alone — the status cron will
     * resume polling them.
     */
    async markPendingPostsAsFailed(): Promise<number> {
        const result = await this.sql`
            UPDATE posts
            SET status = 'failed', updated_at = NOW()
            WHERE status = 'pending'
              AND (upload_post_request_id IS NULL
                   OR upload_post_submitted_at < NOW() - INTERVAL '1 hour')
            RETURNING id
        ` as { id: number }[];
        const count = result.length;
        if (count > 0) {
            logger.warn('Marked stale pending posts as failed', { count });
        }
        return count;
    }
```

- [ ] **Step 1.12: Run the tests and confirm they pass**

Run: `bun test tests/unit/database.test.ts -t "markPendingPostsAsFailed"`

Expected: PASS (3 tests).

- [ ] **Step 1.13: Update `markPostSuccess` to clear the new columns**

Replace the existing `markPostSuccess` method in `src/services/database.ts` (around lines 581–588) with:

```ts
    /**
     * Update post with success status and Instagram post ID. Also clears the in-flight
     * tracking columns (request_id, edited_video_url, pending_user_*) since they're no
     * longer needed after the terminal transition. request_id and submitted_at are kept
     * for audit trail; only the cleanup-relevant columns are cleared.
     */
    async markPostSuccess(postId: number, instagramPostId: string | null): Promise<void> {
        await this.sql`
            UPDATE posts
            SET status = 'success',
                instagram_post_id = ${instagramPostId},
                edited_video_url = NULL,
                pending_user_id = NULL,
                pending_user_name = NULL,
                updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as success', { postId, instagramPostId });
    }
```

- [ ] **Step 1.14: Write the failing test for `markPostSuccess` clearing columns**

Add to the existing `describe('markPostSuccess', …)` block in `tests/unit/database.test.ts`:

```ts
    test('clears in-flight tracking columns on success transition', async () => {
        mockSql.mockResolvedValueOnce([]);

        await db.markPostSuccess(99, 'ig_abc');

        expect(mockSql).toHaveBeenCalledTimes(1);
        const args = mockSql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
        const sqlText = args[0].join('?');
        expect(sqlText).toContain('edited_video_url = NULL');
        expect(sqlText).toContain('pending_user_id = NULL');
        expect(sqlText).toContain('pending_user_name = NULL');
    });
```

- [ ] **Step 1.15: Run all `markPostSuccess` tests and confirm they pass**

Run: `bun test tests/unit/database.test.ts -t "markPostSuccess"`

Expected: PASS (existing test + new one).

- [ ] **Step 1.16: Update `updatePostStatus` to clear in-flight columns on failure transition**

Replace the existing `updatePostStatus` method in `src/services/database.ts` (around lines 569–576) with:

```ts
    /**
     * Update post status. When transitioning to 'failed', also clears the in-flight
     * tracking columns so a stuck row's GCS resource pointer and pending user info
     * get cleaned up. For other statuses the columns are left alone.
     */
    async updatePostStatus(postId: number, status: PostStatus): Promise<void> {
        if (status === 'failed') {
            await this.sql`
                UPDATE posts
                SET status = ${status},
                    edited_video_url = NULL,
                    pending_user_id = NULL,
                    pending_user_name = NULL,
                    updated_at = NOW()
                WHERE id = ${postId}
            `;
        } else {
            await this.sql`
                UPDATE posts
                SET status = ${status}, updated_at = NOW()
                WHERE id = ${postId}
            `;
        }
        logger.debug('Post status updated', { postId, status });
    }
```

- [ ] **Step 1.17: Write the failing test for `updatePostStatus` failure branch**

Add a new `describe('updatePostStatus', …)` block in `tests/unit/database.test.ts` (place after `markPendingPostsAsFailed`):

```ts
describe('updatePostStatus', () => {
    test('clears in-flight tracking columns when transitioning to failed', async () => {
        mockSql.mockResolvedValueOnce([]);

        await db.updatePostStatus(50, 'failed');

        const args = mockSql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
        const sqlText = args[0].join('?');
        expect(sqlText).toContain('edited_video_url = NULL');
        expect(sqlText).toContain('pending_user_id = NULL');
    });

    test('does NOT clear in-flight columns for non-failed transitions', async () => {
        mockSql.mockResolvedValueOnce([]);

        await db.updatePostStatus(50, 'pending');

        const args = mockSql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
        const sqlText = args[0].join('?');
        expect(sqlText).not.toContain('edited_video_url');
        expect(sqlText).not.toContain('pending_user_id');
    });
});
```

- [ ] **Step 1.18: Run the new tests and confirm they pass**

Run: `bun test tests/unit/database.test.ts -t "updatePostStatus"`

Expected: PASS (2 tests).

- [ ] **Step 1.19: Add the SQL migrations to `initializeSchema`**

In `src/services/database.ts`, locate the existing `// Add account_id column if it doesn't exist …` migration block in `initializeSchema()` (around line 243). Insert the following five migration blocks **immediately after** the existing block-of-DO-$$-IF-NOT-EXISTS migrations on the `posts` table (before the `idx_posts_status` CREATE INDEX call). Each follows the same idempotent pattern:

```ts
        // Add upload_post_request_id column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'upload_post_request_id'
                ) THEN
                    ALTER TABLE posts ADD COLUMN upload_post_request_id TEXT;
                END IF;
            END $$
        `;

        // Add upload_post_submitted_at column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'upload_post_submitted_at'
                ) THEN
                    ALTER TABLE posts ADD COLUMN upload_post_submitted_at TIMESTAMP;
                END IF;
            END $$
        `;

        // Add edited_video_url column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'edited_video_url'
                ) THEN
                    ALTER TABLE posts ADD COLUMN edited_video_url TEXT;
                END IF;
            END $$
        `;

        // Add pending_user_id column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'pending_user_id'
                ) THEN
                    ALTER TABLE posts ADD COLUMN pending_user_id UUID;
                END IF;
            END $$
        `;

        // Add pending_user_name column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'pending_user_name'
                ) THEN
                    ALTER TABLE posts ADD COLUMN pending_user_name TEXT;
                END IF;
            END $$
        `;
```

Then locate the `CREATE INDEX IF NOT EXISTS idx_posts_status` call and add a new index call immediately after it:

```ts
        // Partial index — only covers in-flight rows the status cron scans every 10s.
        // Rows transitioning to 'success'/'failed' drop out of the index automatically.
        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_posts_pending_upload_post
            ON posts(upload_post_submitted_at)
            WHERE status = 'pending' AND upload_post_request_id IS NOT NULL
        `;
```

- [ ] **Step 1.20: Stage Task 1**

Run:
```bash
git add src/services/database.ts src/types/index.ts tests/unit/database.test.ts
```

User reviews and commits.

---

## Task 2: Add `postVideoAsync` and `getUploadStatus` to `UploadPostClientService`

Additive — the old `postVideo` and `pollForCompletion` methods stay in place during this task. They're removed in Task 6.

**Files:**
- Modify: `src/services/upload-post-client.ts` — add two new methods + one exported type
- Modify: `tests/unit/upload-post-client.test.ts` — add new test blocks

- [ ] **Step 2.1: Write the failing test for `postVideoAsync`**

Add a new `describe` block in `tests/unit/upload-post-client.test.ts` (place after the existing `describe('postVideo async polling', …)`):

```ts
describe('postVideoAsync', () => {
    test('submits with async_upload=true and X-Request-Id header, resolves on 2xx', async () => {
        const fetchMock = mock(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ request_id: 'req-async' }),
        })) as ReturnType<typeof mock>;
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        await client.postVideoAsync({
            requestId: 'req-async',
            videoUrl: 'https://video.url/x.mp4',
            caption: 'cap',
            hashtags: ['a', 'b'],
            platforms: ['tiktok', 'instagram'],
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.upload-post.com/api/upload');
        expect(options.method).toBe('POST');
        const headers = options.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Apikey test-api-key');
        expect(headers['X-Request-Id']).toBe('req-async');
        // FormData payload includes async_upload, title, video, platform[], user
        const body = options.body as FormData;
        expect(body.get('user')).toBe('test-user');
        expect(body.get('video')).toBe('https://video.url/x.mp4');
        expect(body.get('async_upload')).toBe('true');
        expect(body.get('title')).toBe('cap\n\n#a #b');
        expect(body.getAll('platform[]')).toEqual(['tiktok', 'instagram']);
    });

    test('throws on non-2xx', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'kaboom' }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        await expect(client.postVideoAsync({
            requestId: 'req-x',
            videoUrl: 'https://video.url/x.mp4',
            caption: 'cap',
            hashtags: [],
            platforms: ['tiktok'],
        })).rejects.toThrow(/Upload-Post submission failed: 500/);
    });
});
```

- [ ] **Step 2.2: Run the tests and confirm they fail**

Run: `bun test tests/unit/upload-post-client.test.ts -t "postVideoAsync"`

Expected: FAIL with `client.postVideoAsync is not a function`.

- [ ] **Step 2.3: Implement `postVideoAsync`**

Add the following method inside the `UploadPostClientService` class in `src/services/upload-post-client.ts`. Insert it **above** the existing `postVideo` method (which stays for now):

```ts
    /**
     * Submit a video upload to Upload-Post with async_upload=true. The caller is responsible
     * for persisting the requestId beforehand so the status cron can poll it. This method
     * never polls — it returns once Upload-Post has accepted the submission (2xx) or throws
     * on any failure. The X-Request-Id header makes the submission idempotent: if a network
     * timeout causes a retry with the same requestId, Upload-Post returns the existing job
     * rather than creating a duplicate.
     */
    async postVideoAsync(opts: {
        requestId: string;
        videoUrl: string;
        caption: string;
        hashtags: string[];
        platforms: string[];
        shareToFeed?: boolean;
    }): Promise<void> {
        const hashtagString = opts.hashtags.map((tag) => `#${tag}`).join(' ');
        const fullCaption = opts.hashtags.length > 0
            ? `${opts.caption}\n\n${hashtagString}`
            : opts.caption;

        const formData = new FormData();
        formData.append('user', this.user);
        formData.append('video', opts.videoUrl);
        formData.append('title', fullCaption);
        formData.append('async_upload', 'true');
        if (opts.shareToFeed !== undefined && opts.platforms.includes('instagram')) {
            formData.append('share_to_feed', String(opts.shareToFeed));
        }
        for (const platform of opts.platforms) {
            formData.append('platform[]', platform);
        }

        logger.info('Submitting video to Upload-Post (async)', {
            user: this.user,
            requestId: opts.requestId,
            platforms: opts.platforms,
            videoUrl: opts.videoUrl,
        });

        const response = await fetch(`${this.baseUrl}/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Apikey ${this.apiKey}`,
                'X-Request-Id': opts.requestId,
            },
            body: formData,
        });

        if (!response.ok) {
            let bodyText = '';
            try { bodyText = JSON.stringify(await response.json()); } catch { /* ignore */ }
            logger.error('Upload-Post submission failed', {
                status: response.status,
                requestId: opts.requestId,
                body: bodyText,
            });
            throw new Error(`Upload-Post submission failed: ${response.status}`);
        }
    }
```

- [ ] **Step 2.4: Run the tests and confirm they pass**

Run: `bun test tests/unit/upload-post-client.test.ts -t "postVideoAsync"`

Expected: PASS (2 tests).

- [ ] **Step 2.5: Write the failing tests for `getUploadStatus`**

Add a new `describe` block in `tests/unit/upload-post-client.test.ts` (after the `postVideoAsync` block):

```ts
describe('getUploadStatus', () => {
    test('returns in-progress for each documented in-progress status (regression for the original bug)', async () => {
        const inProgressStatuses = ['pending', 'queued', 'processing', 'in_progress'] as const;
        for (const status of inProgressStatuses) {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ request_id: 'r', status }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe(status);
        }
    });

    test('returns completed with extracted instagramPostId from results.instagram.post_id', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                request_id: 'r',
                status: 'completed',
                results: { instagram: { post_id: 'ig-123', success: true } },
            }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        const result = await client.getUploadStatus('r');

        expect(result.status).toBe('completed');
        if (result.status === 'completed') {
            expect(result.instagramPostId).toBe('ig-123');
        }
    });

    test('falls back to publish_id when post_id is absent in completed response', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                request_id: 'r',
                status: 'completed',
                results: { instagram: { publish_id: 'pub-999' } },
            }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        const result = await client.getUploadStatus('r');

        expect(result.status).toBe('completed');
        if (result.status === 'completed') {
            expect(result.instagramPostId).toBe('pub-999');
        }
    });

    test('returns completed with instagramPostId=null when instagram is absent', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                request_id: 'r',
                status: 'completed',
                results: { tiktok: { success: true } },
            }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        const result = await client.getUploadStatus('r');

        expect(result.status).toBe('completed');
        if (result.status === 'completed') {
            expect(result.instagramPostId).toBeNull();
        }
    });

    test('returns failed with results payload', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                request_id: 'r',
                status: 'failed',
                results: [{ platform: 'tiktok', status: 'failed', error: 'nope' }],
            }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        const result = await client.getUploadStatus('r');

        expect(result.status).toBe('failed');
    });

    test('returns not_found on HTTP 404', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ error: 'not found' }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        const result = await client.getUploadStatus('r');

        expect(result.status).toBe('not_found');
    });

    test('returns unknown for unrecognized status string (does NOT treat as terminal)', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ request_id: 'r', status: 'something-new' }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        const result = await client.getUploadStatus('r');

        expect(result.status).toBe('unknown');
        if (result.status === 'unknown') {
            expect(result.raw).toBe('something-new');
        }
    });

    test('throws on HTTP 5xx', async () => {
        globalThis.fetch = mock(() => Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'kaboom' }),
        })) as typeof fetch;

        const client = new UploadPostClientService('test-api-key', 'test-user');
        await expect(client.getUploadStatus('r')).rejects.toThrow(/Upload-Post status fetch failed: 500/);
    });
});
```

- [ ] **Step 2.6: Run the tests and confirm they fail**

Run: `bun test tests/unit/upload-post-client.test.ts -t "getUploadStatus"`

Expected: FAIL with `client.getUploadStatus is not a function`.

- [ ] **Step 2.7: Implement `getUploadStatus`**

In `src/services/upload-post-client.ts`, add the exported result type near the top of the file (immediately after the `import` line and before the `export class`):

```ts
export type UploadPostStatusResult =
    | { status: 'pending' | 'queued' | 'processing' | 'in_progress'; raw: string; data: unknown }
    | { status: 'completed'; instagramPostId: string | null; raw: string; data: unknown }
    | { status: 'failed'; raw: string; data: unknown }
    | { status: 'not_found' }
    | { status: 'unknown'; raw: string; data: unknown };

const IN_PROGRESS_STATUSES = new Set(['pending', 'queued', 'processing', 'in_progress']);
```

Inside the class, add this method **immediately after** `postVideoAsync`:

```ts
    /**
     * Fetch the current status of an async Upload-Post submission. Returns a typed result
     * matching the documented top-level status field. Unrecognized statuses become
     * `{ status: 'unknown' }` — the cron's caller treats this as no-op and lets the
     * 1-hour safety net handle truly stuck requests.
     */
    async getUploadStatus(requestId: string): Promise<UploadPostStatusResult> {
        const response = await fetch(
            `${this.baseUrl}/uploadposts/status?request_id=${encodeURIComponent(requestId)}`,
            { headers: { 'Authorization': `Apikey ${this.apiKey}` } }
        );

        if (response.status === 404) {
            return { status: 'not_found' };
        }
        if (!response.ok) {
            logger.error('Upload-Post status fetch failed', { requestId, status: response.status });
            throw new Error(`Upload-Post status fetch failed: ${response.status}`);
        }

        const data = await response.json() as Record<string, unknown>;
        const raw = String(data.status ?? '');

        if (IN_PROGRESS_STATUSES.has(raw)) {
            return { status: raw as 'pending' | 'queued' | 'processing' | 'in_progress', raw, data };
        }
        if (raw === 'completed') {
            const igResult = (data.results as Record<string, Record<string, unknown>> | undefined)?.instagram;
            const instagramPostId = (igResult?.post_id ?? igResult?.publish_id ?? null) as string | null;
            return { status: 'completed', instagramPostId, raw, data };
        }
        if (raw === 'failed') {
            return { status: 'failed', raw, data };
        }
        return { status: 'unknown', raw, data };
    }
```

- [ ] **Step 2.8: Run the tests and confirm they pass**

Run: `bun test tests/unit/upload-post-client.test.ts -t "getUploadStatus"`

Expected: PASS (8 tests).

- [ ] **Step 2.9: Run the full upload-post-client test file to confirm nothing else regressed**

Run: `bun test tests/unit/upload-post-client.test.ts`

Expected: PASS (all tests including the older `postVideo`/`postVideo async polling`/`getPostAnalytics`/`getTotalImpressions`/`postVideo instagramPostId extraction` ones).

- [ ] **Step 2.10: Stage Task 2**

Run:
```bash
git add src/services/upload-post-client.ts tests/unit/upload-post-client.test.ts
```

User reviews and commits.

---

## Task 3: `UploadPostStatusCronService` (new file + tests)

**Files:**
- Create: `src/services/upload-post-status-cron.ts`
- Create: `tests/unit/upload-post-status-cron.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `tests/unit/upload-post-status-cron.test.ts`:

```ts
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
        upload_post_submitted_at: new Date(),  // now → not stale
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
        // Reset throttle to 0 so tests don't sleep; reset safety-net and not-found windows
        // to production defaults so tests that don't override them get predictable behavior.
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
            status: 'completed',
            instagramPostId: 'ig-555',
            raw: 'completed',
            data: {},
        });

        const result = await service.tick();

        expect(result.completed).toBe(1);
        expect(mockMarkPostSuccess).toHaveBeenCalledWith(50, 'ig-555');
        expect(mockDeleteEditedVideo).toHaveBeenCalledWith('https://storage.googleapis.com/molars-reels/edited/x.mp4');
    });

    test('completed status creates user_posts row when pending_user_* are set', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({
            id: 51,
            pending_user_id: 'user-uuid-1',
            pending_user_name: 'Alice',
        })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({
            status: 'completed',
            instagramPostId: 'ig-1',
            raw: 'completed',
            data: {},
        });

        await service.tick();

        expect(mockCreateUserPost).toHaveBeenCalledWith(51, 'user-uuid-1', 'Alice');
    });

    test('completed status does NOT create user_posts when pending_user_* are null', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost()]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({
            status: 'completed',
            instagramPostId: 'ig-1',
            raw: 'completed',
            data: {},
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
        const submittedAt = new Date(Date.now() - 60_000); // 1 min ago
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({ upload_post_submitted_at: submittedAt })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({ status: 'not_found' });

        const result = await service.tick();

        expect(result.stillPending).toBe(1);
        expect(mockUpdatePostStatus).not.toHaveBeenCalled();
    });

    test('not_found ≥5min old is treated as failed', async () => {
        const submittedAt = new Date(Date.now() - 6 * 60_000); // 6 min ago
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({
            id: 70,
            upload_post_submitted_at: submittedAt,
        })]);
        mockGetPostAccount.mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform.mockResolvedValueOnce(upCredential());
        mockGetUploadStatus.mockResolvedValueOnce({ status: 'not_found' });

        const result = await service.tick();

        expect(result.failed).toBe(1);
        expect(mockUpdatePostStatus).toHaveBeenCalledWith(70, 'failed');
    });

    test('1h safety net flips stuck rows to failed WITHOUT calling status endpoint', async () => {
        const submittedAt = new Date(Date.now() - 61 * 60_000); // 61 min ago
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([pendingPost({
            id: 80,
            upload_post_submitted_at: submittedAt,
        })]);
        // Safety-net path needs to look up the account to construct VideoSelectorService.
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
            status: 'unknown',
            raw: 'mystery-status',
            data: { status: 'mystery-status' },
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
        // One real run, one short-circuited
        expect(mockGetPendingUploadPostPosts).toHaveBeenCalledTimes(1);
        // The short-circuited tick returns zeros
        expect([r1, r2]).toContainEqual({ scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 });
    });

    test('throws from getUploadStatus are caught and counted as errors, loop continues', async () => {
        mockGetPendingUploadPostPosts.mockResolvedValueOnce([
            pendingPost({ id: 90 }),
            pendingPost({ id: 91 }),
        ]);
        mockGetPostAccount
            .mockResolvedValueOnce(account())
            .mockResolvedValueOnce(account());
        mockGetCredentialsByPlatform
            .mockResolvedValueOnce(upCredential())
            .mockResolvedValueOnce(upCredential());
        mockGetUploadStatus
            .mockRejectedValueOnce(new Error('Upload-Post status fetch failed: 500'))
            .mockResolvedValueOnce({ status: 'completed', instagramPostId: 'ig-91', raw: 'completed', data: {} });

        const result = await service.tick();

        expect(result.errors).toBe(1);
        expect(result.completed).toBe(1);
        expect(mockMarkPostSuccess).toHaveBeenCalledWith(91, 'ig-91');
    });
});
```

- [ ] **Step 3.2: Run the tests and confirm they fail**

Run: `bun test tests/unit/upload-post-status-cron.test.ts`

Expected: FAIL — cannot resolve `'../../src/services/upload-post-status-cron'`.

- [ ] **Step 3.3: Add `getPostAccount` helper to `DatabaseService`**

In `src/services/database.ts`, add this method immediately after `getPendingUploadPostPosts` from Task 1:

```ts
    /**
     * Returns the full account row for a given post. Used by UploadPostStatusCronService
     * to find both the gcs_bucket_name (for GCS cleanup) and the account_id (for credential lookup).
     */
    async getPostAccount(postId: number): Promise<DbAccount | null> {
        const rows = await this.sql`
            SELECT a.id, a.name, a.ig_access_token, a.ig_user_id, a.gcs_bucket_name, a.created_at
            FROM accounts a
            JOIN posts p ON p.account_id = a.id
            WHERE p.id = ${postId}
        ` as DbAccount[];
        return rows.length > 0 ? rows[0] : null;
    }
```

- [ ] **Step 3.4: Implement `UploadPostStatusCronService`**

Create `src/services/upload-post-status-cron.ts`:

```ts
import { DatabaseService } from './database.js';
import { UploadPostClientService } from './upload-post-client.js';
import { VideoSelectorService } from './video-selector.js';
import { logger } from '../utils/logger.js';
import type { UploadPostCredentials, PendingUploadPostPost, DbAccount } from '../types/index.js';

export interface TickResult {
    scanned: number;
    completed: number;
    failed: number;
    stillPending: number;
    errors: number;
}

export class UploadPostStatusCronService {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private db: DatabaseService;
    private isRunning: boolean = false;

    private static readonly TICK_INTERVAL_MS = 10_000;

    /** Delay between per-post Upload-Post status calls. Overridable for tests. */
    static THROTTLE_MS = 200;

    /** Age at which a stuck `pending` row is forcibly failed without calling Upload-Post. */
    static SAFETY_NET_MS = 60 * 60 * 1000;

    /** Grace period before `not_found` is treated as terminal failure. */
    static NOT_FOUND_GRACE_MS = 5 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
    }

    start(): void {
        if (this.timer) {
            logger.warn('Upload-Post status cron job already running');
            return;
        }
        this.timer = setTimeout(() => this.runAndScheduleNext(), UploadPostStatusCronService.TICK_INTERVAL_MS);
        logger.info('Upload-Post status cron job started', {
            intervalMs: UploadPostStatusCronService.TICK_INTERVAL_MS,
        });
    }

    private runAndScheduleNext(): void {
        this.tick().catch((err) => {
            logger.error('Upload-Post status cron tick threw unexpectedly', {
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }).finally(() => {
            this.timer = setTimeout(() => this.runAndScheduleNext(), UploadPostStatusCronService.TICK_INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Upload-Post status cron job stopped');
        }
    }

    /**
     * Single pass over all in-flight Upload-Post posts. Public for direct invocation
     * from tests; the cron loop calls this once every TICK_INTERVAL_MS.
     */
    async tick(): Promise<TickResult> {
        if (this.isRunning) {
            logger.debug('Upload-Post status cron tick already in progress, skipping');
            return { scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 };
        }
        this.isRunning = true;

        const result: TickResult = { scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 };

        try {
            const posts = await this.db.getPendingUploadPostPosts();
            result.scanned = posts.length;
            if (posts.length === 0) {
                return result;
            }

            const now = Date.now();
            for (let i = 0; i < posts.length; i++) {
                const post = posts[i];
                const ageMs = now - new Date(post.upload_post_submitted_at).getTime();

                // Every per-row path needs the account (for GCS bucket name) so look it up first.
                const acct = await this.db.getPostAccount(post.id);
                if (!acct) {
                    logger.warn('Upload-Post status cron: account not found for post', { postId: post.id });
                    result.errors += 1;
                    continue;
                }

                // 1h safety net: flip stuck rows to failed without calling Upload-Post.
                if (ageMs >= UploadPostStatusCronService.SAFETY_NET_MS) {
                    logger.error('Upload-Post status cron: row exceeded 1h, marking failed', {
                        postId: post.id,
                        requestId: post.upload_post_request_id,
                        submittedAt: post.upload_post_submitted_at,
                    });
                    await this.markFailedAndCleanup(post, acct);
                    result.failed += 1;
                    continue;
                }

                try {
                    const credential = await this.db.getCredentialsByPlatform(acct.id, 'upload_post');
                    if (!credential) {
                        logger.warn('Upload-Post status cron: missing upload_post credential for post', {
                            postId: post.id,
                            accountId: acct.id,
                        });
                        result.errors += 1;
                        continue;
                    }
                    const upCreds = credential.credentials as UploadPostCredentials;

                    const client = new UploadPostClientService(upCreds.api_key, upCreds.user);
                    const status = await client.getUploadStatus(post.upload_post_request_id);

                    if (status.status === 'completed') {
                        await this.db.markPostSuccess(post.id, status.instagramPostId);
                        if (post.edited_video_url) {
                            await this.safeDeleteEditedVideo(post.edited_video_url, acct);
                        }
                        if (post.pending_user_id && post.pending_user_name) {
                            try {
                                await this.db.createUserPost(post.id, post.pending_user_id, post.pending_user_name);
                            } catch (e) {
                                logger.warn('Upload-Post status cron: createUserPost failed (non-fatal)', {
                                    postId: post.id,
                                    error: e instanceof Error ? e.message : 'Unknown error',
                                });
                            }
                        }
                        result.completed += 1;
                        continue;
                    }

                    if (status.status === 'failed') {
                        logger.error('Upload-Post status cron: status=failed', {
                            postId: post.id,
                            requestId: post.upload_post_request_id,
                            results: (status.data as Record<string, unknown>)?.results,
                        });
                        await this.markFailedAndCleanup(post, acct);
                        result.failed += 1;
                        continue;
                    }

                    if (status.status === 'not_found') {
                        if (ageMs >= UploadPostStatusCronService.NOT_FOUND_GRACE_MS) {
                            logger.error('Upload-Post status cron: not_found beyond grace period, marking failed', {
                                postId: post.id,
                                requestId: post.upload_post_request_id,
                                ageMs,
                            });
                            await this.markFailedAndCleanup(post, acct);
                            result.failed += 1;
                        } else {
                            logger.debug('Upload-Post status cron: not_found within grace period, deferring', {
                                postId: post.id,
                            });
                            result.stillPending += 1;
                        }
                        continue;
                    }

                    // status === 'unknown' or in-progress → leave alone.
                    if (status.status === 'unknown') {
                        logger.error('Upload-Post status cron: unrecognized status, deferring to safety net', {
                            postId: post.id,
                            raw: status.raw,
                        });
                    }
                    result.stillPending += 1;
                } catch (err) {
                    logger.warn('Upload-Post status cron: per-post error, will retry next tick', {
                        postId: post.id,
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                    result.errors += 1;
                }

                if (i < posts.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, UploadPostStatusCronService.THROTTLE_MS));
                }
            }

            logger.info('Upload-Post status sync completed', result);
        } catch (error) {
            logger.error('Upload-Post status cron tick failed before loop completed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return result;
    }

    private async markFailedAndCleanup(post: PendingUploadPostPost, acct: DbAccount): Promise<void> {
        await this.db.updatePostStatus(post.id, 'failed');
        if (post.edited_video_url) {
            await this.safeDeleteEditedVideo(post.edited_video_url, acct);
        }
    }

    private async safeDeleteEditedVideo(url: string, acct: DbAccount): Promise<void> {
        try {
            // VideoSelectorService.deleteEditedVideo requires this.bucketName to match the
            // URL prefix (`https://storage.googleapis.com/${bucketName}/`), so we must
            // construct it with the account's actual bucket.
            const selector = new VideoSelectorService(acct.gcs_bucket_name);
            await selector.deleteEditedVideo(url);
        } catch (err) {
            logger.warn('Upload-Post status cron: deleteEditedVideo failed (non-fatal)', {
                url,
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }
}
```

- [ ] **Step 3.5: Run the tests and confirm they pass**

Run: `bun test tests/unit/upload-post-status-cron.test.ts`

Expected: PASS (13 tests — includes the new "account fetch returns null" test).

- [ ] **Step 3.6: Verify the upload-post-client and database tests still pass**

Run: `bun test tests/unit/upload-post-client.test.ts tests/unit/database.test.ts`

Expected: PASS.

- [ ] **Step 3.7: Stage Task 3**

Run:
```bash
git add src/services/upload-post-status-cron.ts src/services/database.ts tests/unit/upload-post-status-cron.test.ts
```

User reviews and commits.

---

## Task 4: Wire the cron into `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 4.1: Read the existing cron wiring**

Open `src/index.ts` and locate where the existing cron services are imported, started, and stopped. (`ImpressionsSyncCronService`, `ViewsSyncCronService`, and `AgentEvalCronService` follow the same pattern: import at top, `new XxxCronService()` somewhere near server startup, `service.start()`, then a SIGTERM/SIGINT handler calling `service.stop()`.)

- [ ] **Step 4.2: Add the new cron alongside the others**

Add the import next to the other cron service imports:

```ts
import { UploadPostStatusCronService } from './services/upload-post-status-cron.js';
```

In the same place where the existing cron services are constructed and started, add:

```ts
const uploadPostStatusCron = new UploadPostStatusCronService();
uploadPostStatusCron.start();
```

In the SIGTERM/SIGINT shutdown handler block, add:

```ts
uploadPostStatusCron.stop();
```

(Mirror the exact bracing, ordering, and comma usage of the existing cron service entries — the goal is symmetry, not innovation.)

- [ ] **Step 4.3: Type-check the project**

Run: `bun run tsc --noEmit`

Expected: no errors. (If the project uses a different typecheck script, use it instead; check `package.json` `scripts`.)

- [ ] **Step 4.4: Run the full unit test suite to make sure nothing regressed**

Run: `bun test tests/unit/`

Expected: PASS for all tests modified or added so far.

- [ ] **Step 4.5: Stage Task 4**

Run:
```bash
git add src/index.ts
```

User reviews and commits.

---

## Task 5: Refactor `processPostInBackground` in `post-reel.ts`

This is the largest single edit. The goal: remove the entire `instagram_direct` branching, replace the inline poll with a single `postVideoAsync` submission, persist the request_id + pending user info via `markUploadPostSubmitting`, and let the cron own the success/failure transition.

**Files:**
- Modify: `src/routes/post-reel.ts`

- [ ] **Step 5.1: Replace `processPostInBackground` end-to-end**

Replace the entire `processPostInBackground` function (lines 15–220 of the current `src/routes/post-reel.ts`) with:

```ts
/**
 * Background processing function that handles video editing and Upload-Post submission.
 * This runs asynchronously after the HTTP response has been sent. The actual status of the
 * Upload-Post job is tracked by UploadPostStatusCronService — this function exits as soon
 * as the submission is accepted (or fails immediately).
 */
async function processPostInBackground(
    postId: number,
    account: DbAccount,
    inputVideoPath: string,
    hookText: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean,
    db: DatabaseService,
    userId?: string,
    userName?: string
): Promise<void> {
    let editedVideoPath: string | null = null;
    let editedVideoUrl: string | null = null;
    const videoSelector = new VideoSelectorService(account.gcs_bucket_name);
    const videoEditor = new VideoEditorService();

    try {
        // Step 3: Validate video format
        logger.info('Step 3: Validating video format', { postId });
        const validation_result = await videoEditor.validateVideoFormat(inputVideoPath);
        if (!validation_result.isValid) {
            logger.warn('Video format validation failed', { postId, ...validation_result });
        }

        // Step 4: Add text overlay
        logger.info('Step 4: Adding text overlay to video', { postId });
        editedVideoPath = await videoEditor.addTextOverlay(inputVideoPath, hookText, {
            position: 'top',
            fontSize: 60,
            fontColor: 'white',
            strokeColor: 'black',
            strokeWidth: 3,
        });
        logger.info('Video edited successfully', { postId, editedPath: editedVideoPath });

        // Step 5: Upload edited video to GCS
        logger.info('Step 5: Uploading edited video to GCS', { postId });
        editedVideoUrl = await videoSelector.uploadEditedVideo(editedVideoPath);
        logger.info('Edited video uploaded', { postId, videoUrl: editedVideoUrl });

        // Step 6: Submit to Upload-Post (async). Persist the request_id BEFORE the network call
        // so a crash mid-submission still leaves a row the cron can pick up. The X-Request-Id
        // header makes the submission idempotent if the request is retried.
        logger.info('Step 6: Submitting Reel to Upload-Post', { postId });

        const upCredential = await db.getCredentialsByPlatform(account.id, 'upload_post');
        if (!upCredential) {
            throw new Error(`No upload_post credentials for account ${account.id}`);
        }
        const upCreds = upCredential.credentials as UploadPostCredentials;
        const platforms: string[] = [];
        if (upCreds.youtube) platforms.push('youtube');
        if (upCreds.tiktok) platforms.push('tiktok');
        if (upCreds.twitter) platforms.push('x');
        if (upCreds.instagram) platforms.push('instagram');
        if (platforms.length === 0) {
            throw new Error(`Account ${account.id} has upload_post credentials but no platforms enabled`);
        }

        const requestId = crypto.randomUUID();
        await db.markUploadPostSubmitting(postId, requestId, editedVideoUrl, userId, userName);

        const uploadPostClient = new UploadPostClientService(upCreds.api_key, upCreds.user);
        await uploadPostClient.postVideoAsync({
            requestId,
            videoUrl: editedVideoUrl,
            caption,
            hashtags,
            platforms,
            shareToFeed,
        });

        logger.info('Upload-Post submission accepted; cron will track to completion', {
            postId,
            requestId,
            platforms,
        });

        // Cleanup local files. The GCS edited video stays until the cron sees a terminal status.
        videoSelector.cleanupTempFile(inputVideoPath);
        videoEditor.cleanupTempFile(editedVideoPath);
    } catch (error) {
        logger.error('Error in background post submission', {
            postId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        try {
            await db.updatePostStatus(postId, 'failed');
            logger.info('Post status updated to failed', { postId });
        } catch (dbError) {
            logger.warn('Failed to update post status to failed', {
                postId,
                error: dbError instanceof Error ? dbError.message : 'Unknown error',
            });
        }

        try { videoSelector.cleanupTempFile(inputVideoPath); } catch { /* ignore */ }
        if (editedVideoPath) {
            try { videoEditor.cleanupTempFile(editedVideoPath); } catch { /* ignore */ }
        }
        if (editedVideoUrl) {
            await videoSelector.deleteEditedVideo(editedVideoUrl);
        }
    }
}
```

- [ ] **Step 5.2: Remove the now-unused imports**

Open `src/routes/post-reel.ts` and remove these two imports from the top of the file:

```ts
import { InstagramClientService } from '../services/instagram-client.js';
```

Remove `InstagramDirectCredentials` from the type imports block. The current import line is:

```ts
import type { PostReelResponse, DbAccount, InstagramDirectCredentials, UploadPostCredentials } from '../types/index.js';
```

Replace with:

```ts
import type { PostReelResponse, DbAccount, UploadPostCredentials } from '../types/index.js';
```

- [ ] **Step 5.3: Type-check the project**

Run: `bun run tsc --noEmit`

Expected: no errors related to `post-reel.ts`. If there are errors elsewhere (`test-instagram.ts` still imports `InstagramClientService`), that's expected — Task 6 deletes that file.

- [ ] **Step 5.4: Stage Task 5**

Run:
```bash
git add src/routes/post-reel.ts
```

User reviews and commits.

---

## Task 6: Delete instagram_direct files and the old `postVideo` method

**Files:**
- Delete: `src/services/instagram-client.ts`
- Delete: `tests/unit/instagram-client.test.ts`
- Delete: `src/routes/test-instagram.ts`
- Modify: `src/index.ts` — remove the `/api/test-instagram` route mount + import
- Modify: `src/services/upload-post-client.ts` — remove the now-unused `postVideo` + `pollForCompletion` methods
- Modify: `tests/unit/upload-post-client.test.ts` — remove the now-obsolete `postVideo` and `postVideo async polling` describe blocks (the new `postVideoAsync` + `getUploadStatus` blocks added in Task 2 fully replace them)

- [ ] **Step 6.1: Delete the three files**

Run:
```bash
rm src/services/instagram-client.ts
rm tests/unit/instagram-client.test.ts
rm src/routes/test-instagram.ts
```

- [ ] **Step 6.2: Remove the `/api/test-instagram` route + import from `src/index.ts`**

Delete the import line:

```ts
import { handleTestInstagram } from './routes/test-instagram.js';
```

Delete the route block (currently around lines 226–227):

```ts
      if (url.pathname === '/api/test-instagram' && request.method === 'GET') {
        return withCors(await handleTestInstagram(request), request);
      }
```

(If the surrounding code has a comment like `// Test Instagram endpoint`, delete that too.)

- [ ] **Step 6.3: Remove the obsolete `postVideo` and `pollForCompletion` methods from `upload-post-client.ts`**

In `src/services/upload-post-client.ts`, delete the entire `postVideo` method (it spans roughly lines 17–90 in the current file) and the private `pollForCompletion` method (roughly lines 96–153). The `postVideoAsync` and `getUploadStatus` methods added in Task 2 replace them.

After deletion, verify the file still contains:
- The class declaration and constructor
- The new `UploadPostStatusResult` type and `IN_PROGRESS_STATUSES` set (from Task 2)
- `postVideoAsync` (from Task 2)
- `getUploadStatus` (from Task 2)
- `getPostAnalytics` (existing)
- `getTotalImpressions` (existing)

- [ ] **Step 6.4: Remove the obsolete test blocks from `upload-post-client.test.ts`**

In `tests/unit/upload-post-client.test.ts`, delete:
- The entire `describe('postVideo instagramPostId extraction', …)` block (its 3 tests covered behavior of the deleted `postVideo` method; the new `getUploadStatus` tests cover the equivalent instagramPostId extraction logic on the status response)
- The entire `describe('postVideo async polling', …)` block (added earlier as a regression guard for the inline-polling bug; the polling no longer exists)

Keep:
- `describe('getPostAnalytics', …)`
- `describe('getTotalImpressions', …)`
- `describe('postVideoAsync', …)` (from Task 2)
- `describe('getUploadStatus', …)` (from Task 2)

- [ ] **Step 6.5: Type-check and run all tests**

Run: `bun run tsc --noEmit`

Expected: no errors. (The InstagramDirectCredentials type still exists in `src/types/index.ts` — that's intentional per the spec; cleanup is a follow-up PR.)

Run: `bun test tests/unit/`

Expected: PASS. The deleted `tests/unit/instagram-client.test.ts` is gone; everything else still passes.

- [ ] **Step 6.6: Smoke-test that the server starts**

Run: `bun src/index.ts` (or whatever the existing dev-server command is — check `package.json` `scripts`). After confirming it logs that the four cron services have started (`AgentEvalCronService`, `ImpressionsSyncCronService`, `ViewsSyncCronService`, `UploadPostStatusCronService`) and listens on its configured port, kill it with Ctrl-C.

Expected: clean startup with all four cron jobs initialized; clean shutdown when interrupted.

- [ ] **Step 6.7: Stage Task 6**

Run:
```bash
git add -u src/services/instagram-client.ts tests/unit/instagram-client.test.ts src/routes/test-instagram.ts
git add src/index.ts src/services/upload-post-client.ts tests/unit/upload-post-client.test.ts
```

User reviews and commits.

---

## Spec coverage check (post-implementation)

After all six tasks land, the following spec items should be satisfied:

| Spec section | Implementing task |
|---|---|
| Goal 1: stop marking `failed` while UP processing | Task 2 (`getUploadStatus` returns typed status incl. `unknown`) + Task 3 (cron only marks failed on `failed`/`not_found`-after-grace/1h-safety-net) |
| Goal 2: only `success` on `completed` | Task 3 (cron `completed` branch) |
| Goal 3: survive restarts | Task 1 (persisted `request_id` + tightened `markPendingPostsAsFailed`) + Task 3 (cron resumes from DB) |
| Goal 4: remove instagram_direct | Tasks 5 + 6 |
| Goal 5: FE contract unchanged | Verified by inspection of `usePostStatus.ts` — no code changes to `post-status.ts` route in this plan |
| Data model: 5 new columns + partial index | Task 1.19 |
| `markUploadPostSubmitting`, `getPendingUploadPostPosts`, `getPostAccount`, tightened `markPendingPostsAsFailed`, column-clearing `markPostSuccess`/`updatePostStatus` | Task 1 (1.3–1.18), Task 3 (3.3 adds `getPostAccount`) |
| `postVideoAsync`, `getUploadStatus` + typed result | Task 2 |
| Cron with `tick()`, `isRunning`, throttle, safety net, not_found grace, 429 handling | Task 3 (note: 429 is folded into the per-post error path via the throw in `getUploadStatus` for 5xx — Upload-Post returns 429 with non-2xx; the cron treats it as a retryable error and continues to the next post. If finer-grained 429 handling is desired later, extend `UploadPostStatusResult` to expose it explicitly.) |
| Wire start/stop in `index.ts` | Task 4 |
| post-reel.ts shrinks, deletes instagram_direct branching | Task 5 |
| Files deleted (instagram-client, test-instagram, instagram-client.test) + route mount removed | Task 6 |
| Per-user attribution moved to cron (pending_user_* columns) | Task 1 (columns) + Task 5 (persists during submission) + Task 3 (consumes on success) |
| GCS edited-video cleanup ownership shifted to cron | Task 5 (no longer cleans on success path) + Task 3 (cleans in all terminal branches) |

No tasks for: idempotency-key (the `X-Request-Id` header serves the same purpose, persisted before submission), per-platform DB tracking (out of scope per the design), `platform='instagram_direct'` enum removal (follow-up PR).

---

Plan complete and saved to `docs/superpowers/plans/2026-05-23-upload-post-async-posting-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
