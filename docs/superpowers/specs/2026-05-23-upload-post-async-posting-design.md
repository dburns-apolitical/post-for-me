# Upload-Post async posting (persisted polling)

**Date:** 2026-05-23
**Status:** Approved (design)
**Author:** dec + Claude

## Background

The current Reel-posting flow submits to Upload-Post inside `processPostInBackground` and polls inline for up to 5 minutes (20 attempts × 15s). The poll's "still in progress" check (`upload-post-client.ts:138`) only accepts `'pending'` and `'in_progress'` as continuation statuses, but the Upload-Post API actually returns `'processing'` (and may return `'queued'` and `'in_progress'`). As a result, the very first poll observes `'processing'`, the client bails out, returns `success: false`, and `post-reel.ts:129` throws `"Upload-Post posting failed and no instagram_direct fallback"`. Meanwhile Upload-Post continues processing server-side and the videos do get published — so platforms succeed while the UI shows `failed`.

A targeted fix (adding `'processing'` to the allowlist) addresses the symptom but leaves the underlying architecture brittle:

- Polling lives in-request, so a server restart mid-poll abandons the post.
- The 5-minute polling timeout is far shorter than Upload-Post's own ~1-hour "failed due to inactivity" rule.
- The dual posting paths (`instagram_direct` primary + `upload_post` secondary) add branching that we're committing to remove.

This spec describes a rework where Upload-Post is the only posting path and progress is tracked via a persisted polling worker that survives restarts.

## Goals

1. Stop marking posts `failed` when Upload-Post is still processing.
2. Mark posts `success` only when Upload-Post reports `completed`.
3. Survive server restarts mid-upload without losing in-flight posts.
4. Remove the `instagram_direct` code path (deprecated).
5. Keep the existing frontend contract intact — no FE changes required.

## Non-goals

- Webhook-driven status updates (deferred; the documented webhook payload only carries `job_id` for scheduled posts, making correlation brittle for immediate uploads).
- Per-platform status tracking in the DB (one overall `posts.status` is sufficient for the FE).
- Scheduled posts via Upload-Post's `scheduled_date` parameter.
- Removing the `platform='instagram_direct'` enum value and the `InstagramDirectCredentials` type (separate cleanup PR).
- FE changes to the credentials management UI (a follow-up).

## Architecture

```
POST /api/post-reel
    │
    ├─ Validate, select video, build caption/hashtags
    ├─ Create posts row (status='pending', upload_post_request_id=NULL)
    ├─ Respond 202 { success: true, postId }   ◄── FE navigates to /post/:postId
    │
    └─ setImmediate(processPostInBackground)
            ├─ Edit video, upload to GCS
            ├─ Generate requestId = crypto.randomUUID()
            ├─ markUploadPostSubmitting(postId, requestId, editedVideoUrl)
            ├─ Submit to Upload-Post with async_upload=true, X-Request-Id=<requestId>
            ├─ Cleanup local input file
            └─ Done. The HTTP-adjacent worker exits here.

UploadPostStatusCronService (in-process, started in index.ts)
    │ tick every 10s
    │
    ├─ SELECT posts WHERE status='pending' AND upload_post_request_id IS NOT NULL
    │
    └─ For each row (serial, with 200ms throttle between):
        ├─ If submitted_at < NOW() - INTERVAL '1 hour':
        │    updatePostStatus('failed'); cleanup GCS; log; continue
        ├─ GET /api/uploadposts/status?request_id=<requestId>
        ├─ status='completed' → markPostSuccess(postId, igPostId); cleanup GCS
        ├─ status='failed'    → updatePostStatus('failed'); cleanup GCS; log per-platform errors
        ├─ status in {pending,queued,processing,in_progress} → no-op
        ├─ status='not_found' AND age < 5min → no-op
        ├─ status='not_found' AND age ≥ 5min → updatePostStatus('failed'); cleanup GCS
        └─ unknown status string → log error; no-op (1h safety net handles it)
```

## Components

### `UploadPostClientService` (`src/services/upload-post-client.ts`)

Strip the existing `postVideo` of its sync-mode + inline-polling behavior. Replace with:

```ts
async postVideoAsync(opts: {
    requestId: string;
    videoUrl: string;
    caption: string;
    hashtags: string[];
    platforms: string[];
    shareToFeed?: boolean;
}): Promise<void>
```

- Sends `async_upload=true`, `X-Request-Id: <requestId>` header.
- Throws on non-2xx response or network error (caller handles).
- Does not poll. Does not return a request_id (caller already has it).

```ts
async getUploadStatus(requestId: string): Promise<UploadPostStatusResult>

type UploadPostStatusResult =
    | { status: 'pending' | 'queued' | 'processing' | 'in_progress' }
    | { status: 'completed'; instagramPostId: string | null; results: unknown }
    | { status: 'failed'; results: unknown }
    | { status: 'not_found' }
    | { status: 'unknown'; raw: string; data: unknown };
```

- HTTP 404 → `{ status: 'not_found' }`.
- HTTP 2xx with a known top-level `status` value → typed result.
- HTTP 2xx with an unrecognized status string → `{ status: 'unknown', raw, data }`.
- HTTP 5xx or network error → throws.

The private `pollForCompletion` method is deleted. The existing `getPostAnalytics` and `getTotalImpressions` methods are untouched.

### `UploadPostStatusCronService` (`src/services/upload-post-status-cron.ts`, new)

Mirrors the structure of `ImpressionsSyncCronService`:

- `start()` / `stop()` lifecycle managed from `index.ts`.
- `setTimeout` chain with `TICK_INTERVAL_MS = 10_000`.
- `isRunning` guard prevents overlapping ticks.
- `tick()` is the unit-testable entrypoint: takes no args, returns `{ scanned, completed, failed, stillPending, errors }`.
- `static THROTTLE_MS = 200` between per-row Upload-Post status calls; overridable for tests.
- `static SAFETY_NET_MS = 60 * 60 * 1000` (1h); overridable for tests.
- `static NOT_FOUND_GRACE_MS = 5 * 60 * 1000` (5min); overridable for tests.

Logs once per tick at info level:
`Upload-Post status sync completed { scanned, completed, failed, stillPending, errors }`

Per-post errors (Upload-Post 5xx, network blips) are caught, counted as `errors`, and skipped — the next tick retries. 429 from Upload-Post: log warn, break out of the per-row loop early, continue next tick.

GCS cleanup of `edited_video_url` is owned by this cron (the only thing that knows the final outcome). On any terminal transition it calls `videoSelector.deleteEditedVideo(url)` and then nulls the column via `markPostSuccess` / `updatePostStatus`. Cleanup failures are logged but don't block the status transition.

### `processPostInBackground` in `src/routes/post-reel.ts`

Shrinks substantially. The new flow:

```ts
try {
    // Steps 3–5 unchanged: validate format, add overlay, upload to GCS
    const editedVideoUrl = await videoSelector.uploadEditedVideo(editedVideoPath);

    const upCredential = await db.getCredentialsByPlatform(account.id, 'upload_post');
    if (!upCredential) {
        throw new Error(`No upload_post credentials for account ${account.id}`);
    }
    const upCreds = upCredential.credentials as UploadPostCredentials;
    // Same platform-derivation as the current post-reel.ts:103-108 (youtube/tiktok/x/instagram
    // toggles on the credentials object). Inline; no new helper required.
    const platforms: string[] = [];
    if (upCreds.youtube) platforms.push('youtube');
    if (upCreds.tiktok) platforms.push('tiktok');
    if (upCreds.twitter) platforms.push('x');
    if (upCreds.instagram) platforms.push('instagram');
    if (platforms.length === 0) {
        throw new Error(`Account ${account.id} has upload_post credentials but no platforms enabled`);
    }

    const requestId = crypto.randomUUID();
    await db.markUploadPostSubmitting(postId, requestId, editedVideoUrl);

    const client = new UploadPostClientService(upCreds.api_key, upCreds.user);
    await client.postVideoAsync({
        requestId,
        videoUrl: editedVideoUrl,
        caption,
        hashtags,
        platforms,
        shareToFeed,
    });

    // The cron takes over. Don't touch post status here.
    videoSelector.cleanupTempFile(inputVideoPath);
    videoEditor.cleanupTempFile(editedVideoPath);
} catch (error) {
    // Submission failed before reaching the cron — mark failed and cleanup GCS now.
    logger.error('Background submission failed', { postId, error: ... });
    await db.updatePostStatus(postId, 'failed');
    videoSelector.cleanupTempFile(inputVideoPath);
    if (editedVideoPath) videoEditor.cleanupTempFile(editedVideoPath);
    if (editedVideoUrl) await videoSelector.deleteEditedVideo(editedVideoUrl);
}
```

Deleted: the `igCredential` / `igPromise` / `primaryError` / "Upload-Post posting failed and no instagram_direct fallback" branching (~60 lines). `InstagramClientService` import removed.

`user_posts` creation moves from `processPostInBackground` to the cron's `completed` branch — it represents "this user successfully posted," so attributing before Upload-Post confirms would be wrong. The `userId` and `userName` must therefore be persisted with the post; add columns `pending_user_id UUID` and `pending_user_name TEXT` (nullable) to `posts`, set during `processPostInBackground`, read by the cron on success, cleared after `user_posts` insert.

### `DatabaseService` (`src/services/database.ts`)

New methods:

```ts
markUploadPostSubmitting(
    postId: number,
    requestId: string,
    editedVideoUrl: string,
    pendingUserId?: string,
    pendingUserName?: string,
): Promise<void>

getPendingUploadPostPosts(): Promise<Array<{
    id: number;
    upload_post_request_id: string;
    upload_post_submitted_at: Date;
    edited_video_url: string | null;
    pending_user_id: string | null;
    pending_user_name: string | null;
}>>
```

Modified methods:

- `markPostSuccess(postId, instagramPostId)` — additionally clears `edited_video_url`, `pending_user_id`, `pending_user_name`.
- `updatePostStatus(postId, status)` — when transitioning to `'failed'`, also clears `edited_video_url`, `pending_user_id`, `pending_user_name`.
- `markPendingPostsAsFailed()` — tightened to skip in-flight rows:
  ```sql
  UPDATE posts
  SET status='failed', updated_at=NOW()
  WHERE status='pending'
    AND (upload_post_request_id IS NULL
         OR upload_post_submitted_at < NOW() - INTERVAL '1 hour')
  RETURNING id
  ```

### `index.ts`

Start/stop the new cron alongside the existing three (`AgentEvalCronService`, `ImpressionsSyncCronService`, `ViewsSyncCronService`).

## Data model

```sql
ALTER TABLE posts ADD COLUMN upload_post_request_id TEXT;
ALTER TABLE posts ADD COLUMN upload_post_submitted_at TIMESTAMP;
ALTER TABLE posts ADD COLUMN edited_video_url TEXT;
ALTER TABLE posts ADD COLUMN pending_user_id UUID;
ALTER TABLE posts ADD COLUMN pending_user_name TEXT;

CREATE INDEX idx_posts_pending_upload_post
    ON posts(upload_post_submitted_at)
    WHERE status = 'pending' AND upload_post_request_id IS NOT NULL;
```

All columns nullable; the partial index keeps the cron's scan query cheap by only indexing rows currently in flight. Rows in terminal states (`success`, `failed`) drop out of the index automatically.

Migration goes in `initializeSchema()` via the existing `DO $$ IF NOT EXISTS ... ALTER TABLE` pattern.

## Status semantics

Frontend `PostStatus` enum (unchanged): `'pending' | 'posted' | 'failed' | 'scheduled' | 'success'`. The backend continues to use only `'pending'`, `'success'`, `'failed'`.

| Upload-Post top-level status | Cron action |
|---|---|
| `pending` / `queued` / `processing` / `in_progress` | No-op |
| `completed` | `markPostSuccess(postId, instagramPostId)`; cleanup GCS |
| `failed` | `updatePostStatus('failed')`; cleanup GCS; log per-platform errors |
| `not_found` (HTTP 404), age < 5min | No-op |
| `not_found` (HTTP 404), age ≥ 5min | `updatePostStatus('failed')`; cleanup GCS |
| any unrecognized status string | Log error; no-op (1h safety net catches it) |
| HTTP 5xx / network error | Log warn; no-op; next tick retries |
| Age ≥ 1 hour, still `pending` | `updatePostStatus('failed')`; cleanup GCS; log full last payload |

The unknown-status branch is the key fix vs the original bug: we never transition to `failed` based on a status string we don't recognize. Only on `completed`, explicit `failed`, or the 1h safety net.

## Frontend contract

No changes required. The FE flow (`molars-admin-dashboard`):

1. `POST /api/post-reel` → `{ success, postId }` → navigates to `/post/:postId`.
2. `usePostStatus.ts` polls `GET /api/post-status?postId=X` every 10s.
3. Stops polling when `status === 'success' || status === 'failed'`.
4. Renders an amber spinner while `pending`.
5. Reads `instagram_post_id` and `views` when present.

Latency: FE polls every 10s, BE status cron polls Upload-Post every 10s → worst case ~20s lag between Upload-Post completing and the UI showing success.

The FE will see `pending` for longer than today (real Upload-Post processing duration: typically 30–90s, occasionally several minutes). The existing UI copy ("Your post is being processed. This page will update automatically.") already handles this correctly.

## Error handling

| Scenario | Behavior |
|---|---|
| Submission throws (network/4xx/5xx/429) | `processPostInBackground` catches → `status='failed'` + GCS cleanup. The `request_id` was persisted before the submit call (for idempotency/crash recovery), but because the catch flips status to `failed` immediately, the cron's `status='pending'` filter excludes the row. |
| Server crash between submission and next cron tick | Restart: tightened `markPendingPostsAsFailed` keeps the row (has `request_id`, age < 1h). Next cron tick picks it up. |
| Server crash during video editing/GCS upload | `request_id` still NULL → `markPendingPostsAsFailed` marks it `failed` on startup. |
| Cron tick crashes mid-batch | `isRunning` clears in `finally`. Next tick re-scans. Already-terminal rows excluded by partial index. |
| Upload-Post 5xx / network blip on status fetch | Log warn, skip row this tick, retry next tick. |
| Upload-Post `not_found` < 5min old | No-op (UP may not have registered the request yet). |
| Upload-Post `not_found` ≥ 5min old | Treat as failed. |
| Upload-Post unknown status string | Log error, no-op. Safety net handles after 1h. |
| Upload-Post stuck in `processing` forever | 1h safety net flips to `failed`, logs last payload. |
| GCS delete fails on terminal cleanup | Log warn; status transition completes anyway. |
| Upload-Post 429 during a cron tick | Log warn, break out of per-row loop, continue next tick. |

## Testing

Unit:

- `tests/unit/upload-post-client.test.ts` additions:
  - `postVideoAsync` sends `async_upload=true`, `X-Request-Id` header.
  - `postVideoAsync` throws on non-2xx.
  - `getUploadStatus` returns typed result for each known status.
  - `getUploadStatus` returns `not_found` on HTTP 404.
  - `getUploadStatus` returns `{ status: 'unknown', raw, data }` on unrecognized status (regression test for the original bug — `'processing'`, `'queued'` must NOT return `unknown`).
  - `getUploadStatus` throws on 5xx.

- `tests/unit/upload-post-status-cron.test.ts` (new):
  - Skips rows with no `request_id` (sanity, though the query filter already excludes these).
  - All in-progress statuses → no DB write.
  - `completed` → `markPostSuccess` called with extracted `instagram_post_id`; `deleteEditedVideo` called.
  - `failed` → `updatePostStatus('failed')`; `deleteEditedVideo` called; per-platform errors logged.
  - `not_found` < 5min → no-op; ≥ 5min → failed.
  - 1h safety net flips stale `pending` to `failed` without calling the status endpoint.
  - Unknown status string → no-op + error log. **Regression guard for the original bug.**
  - `isRunning` guard prevents overlapping ticks.
  - 429 response → break out of loop, no further per-row calls this tick.
  - `user_posts` row created on `completed` when `pending_user_id`/`pending_user_name` are set.

- `tests/unit/database.test.ts` additions:
  - `markUploadPostSubmitting` writes all columns.
  - `getPendingUploadPostPosts` returns only `pending` rows with a non-null `request_id`.
  - `markPendingPostsAsFailed` skips rows with `request_id` and `submitted_at` < 1h ago.
  - `markPendingPostsAsFailed` includes rows with `request_id` but `submitted_at` ≥ 1h ago.
  - `markPostSuccess` and `updatePostStatus('failed')` clear `edited_video_url` and `pending_user_*`.

Integration:

- `tests/integration/post-reel.test.ts`:
  - Submits a post, asserts row is `pending` with non-null `request_id`, `submitted_at`, `edited_video_url`.
  - Calls `cron.tick()` directly with a mocked `completed` response, asserts `status='success'` and `instagram_post_id` populated.
  - Calls `cron.tick()` with a mocked `failed` response, asserts `status='failed'` and `edited_video_url` cleared.

Files deleted:

- `src/services/instagram-client.ts`
- `tests/unit/instagram-client.test.ts`
- `src/routes/test-instagram.ts` (confirmed: solely an `instagram_direct` test endpoint)
- Route mount + import in `src/index.ts` (line 5, lines 226–227): `handleTestInstagram` and the `/api/test-instagram` handler

## Rollout

1. **Single deploy, no feature flag.** Migration runs on startup via the existing `initializeSchema` pattern.
2. **In-flight posts at deploy time:** anything `pending` with no `request_id` is from the old code path. The tightened `markPendingPostsAsFailed` running on startup will mark them `failed`. If undesirable, deploy during a quiet window or temporarily leave `markPendingPostsAsFailed` untightened for the first deploy and tighten it in a follow-up.
3. **Observability:** the cron logs `Upload-Post status sync completed { scanned, completed, failed, stillPending, errors }` once per tick. Per-row transitions log at info; errors at error.
4. **No `instagram_direct` credential cleanup** in this PR. They stay dormant in the DB; the `platform` enum keeps both values. Cleanup is a separate follow-up PR.

## LOC estimate

| Change | Approx LOC |
|---|---|
| Delete `instagram-client.ts` + tests + branching in post-reel.ts | -250 |
| Strip polling from `upload-post-client.ts` | -60 |
| New `upload-post-status-cron.ts` + tests | +250 |
| DB methods + migration + tests | +120 |
| Updated `upload-post-client.ts` tests | +60 |
| **Net** | **~ +120 LOC** |

Well under the 400–600 target.

## Open questions / follow-ups

- Remove `platform='instagram_direct'` enum value and `InstagramDirectCredentials` type once we're confident no rows reference it.
- FE: hide `instagram_direct` from the credentials management UI.
- Consider webhooks once Upload-Post adds `request_id` to the `upload_completed` payload (if/when they do).
