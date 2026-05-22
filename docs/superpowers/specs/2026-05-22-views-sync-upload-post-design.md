# Views Sync: Switch to Upload-Post Analytics

**Date:** 2026-05-22

## Background

The views sync cron (`ViewsSyncCronService`) currently fetches Instagram post view counts by calling the Instagram Graph API directly using `instagram_direct` credentials. The goal is to switch this to use the Upload-Post analytics API instead, as part of phasing out `instagram_direct` support. This also requires fixing a gap where the `instagram_post_id` is never captured when a post is published via Upload-Post with Instagram enabled.

## Goals

- Views sync cron fetches view counts via Upload-Post (`GET /api/uploadposts/post-analytics?platform_post_id=...&platform=instagram&user=...`) instead of the Instagram Graph API directly.
- `instagram_post_id` is stored correctly for posts published via Upload-Post with Instagram enabled.
- Accounts without `upload_post` credentials are skipped/failed (same behaviour as current missing-credentials handling).

## Out of Scope

- Migrating existing posts that have `instagram_post_id = null` due to historical Upload-Post uploads.
- Removing `instagram_direct` credential support from other parts of the system (this is a gradual phase-out).
- Adding a DB migration or storing the Upload-Post `request_id` on posts.

## Design

### 1. `UploadPostClientService` — two additions

**1a. Extend `postVideo()` return type**

Change the return type from `{ success: boolean; requestId?: string }` to:

```ts
{ success: boolean; requestId?: string; instagramPostId?: string }
```

After a successful sync upload response, extract the Instagram post ID from the Instagram platform results. The Upload-Post docs list `post_id` and `publish_id` as possible field names — verify the exact field against a live response during implementation:
```ts
const igResult = (data.results as Record<string, any>)?.instagram;
const instagramPostId = igResult?.post_id ?? igResult?.publish_id;
```

In `pollForCompletion`, when the status response is `completed`, extract the same field (checking `post_id` then `publish_id`) from the final poll response and include it in the return value.

The field is optional — callers must handle `undefined`.

**1b. Add `getPostAnalytics(platformPostId: string): Promise<number>`**

Calls:
```
GET https://api.upload-post.com/api/uploadposts/post-analytics
  ?platform_post_id=<platformPostId>
  &platform=instagram
  &user=<this.user>
```

Authorization: `Apikey <this.apiKey>`

Parses `platforms.instagram.post_metrics.views` from the response and returns it as a number. Throws on API error or missing data (so the cron's per-post error handler catches it and increments `failed`).

### 2. `post-reel.ts` — capture Instagram post ID from Upload-Post

In `processPostInBackground`, after the Upload-Post promise resolves, assign `instagramPostId` only if it hasn't already been set (handles the transition period where both credential types may coexist):

```ts
const result = await uploadPostClient.postVideo(...)
if (result.instagramPostId && !instagramPostId) {
    instagramPostId = result.instagramPostId;
}
```

No other changes to the function — `instagramPostId` is already passed to `db.markPostSuccess()` at the end.

### 3. `views-sync-cron.ts` — switch credential type and API client

- Replace `instagram_direct` credential lookup with `upload_post`
- Replace `InstagramClientService.getMediaInsights()` with `UploadPostClientService.getPostAnalytics()`
- Remove `InstagramClientService` and `InstagramDirectCredentials` imports
- Add `UploadPostCredentials` import

Per-post loop change:
```ts
// Before:
const instagram = new InstagramClientService(creds.ig_access_token, creds.ig_user_id);
const views = await instagram.getMediaInsights(post.instagram_post_id);

// After:
const uploadPost = new UploadPostClientService(creds.api_key, creds.user);
const views = await uploadPost.getPostAnalytics(post.instagram_post_id);
```

All other cron logic (daily views aggregation, skip on missing `instagram_post_id`, error handling, concurrency guard) is unchanged.

### 4. Tests — `views-sync-cron.test.ts`

- Replace mock of `InstagramClientService` / `mockGetMediaInsights` with a mock of `UploadPostClientService` / `mockGetPostAnalytics`
- Replace `instagram_direct` credential fixtures with `upload_post` fixtures (`api_key`, `user`)
- All assertions (updated/failed counts, daily views totals) remain the same — only the mocked dependency changes

## Data Flow

```
views-sync-cron
  → db.getCredentialsByPlatform(accountId, 'upload_post')
  → UploadPostClientService.getPostAnalytics(post.instagram_post_id)
      → GET /api/uploadposts/post-analytics?platform_post_id=...&platform=instagram&user=...
      → returns platforms.instagram.post_metrics.views
  → db.updatePostViews(post.id, views)
  → db.insertDailyViews(...)
```

## Error Handling

- Account missing `upload_post` credentials: log warning, increment `failed`, continue (same as current behaviour).
- `getPostAnalytics` throws: caught by existing per-post try/catch, increments `failed`, continues to next post.
- `post_metrics.views` missing in response: `getPostAnalytics` throws with a descriptive message.
