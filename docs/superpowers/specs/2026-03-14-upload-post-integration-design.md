# Upload-Post Integration Design

## Overview

Add Upload-Post as a second posting platform alongside the existing Instagram direct flow. When posting, check for `instagram_direct` credentials (post via Instagram Graph API if present), then check for `upload_post` credentials (post via Upload-Post API if present). Upload-Post always targets YouTube, and adds Instagram only if the direct flow wasn't used.

## Type Changes

### New UploadPostCredentials interface

Add to `src/types/index.ts`:

```typescript
interface UploadPostCredentials {
    api_key: string;
    user: string;
}
```

### Update DbCredential

Update `DbCredential.credentials` type to be a union:

```typescript
credentials: InstagramDirectCredentials | UploadPostCredentials;
```

No database schema changes needed — `upload_post` already exists in the `platform` PostgreSQL ENUM.

## New Service: UploadPostClientService

New file: `src/services/upload-post-client.ts`

```typescript
class UploadPostClientService {
    constructor(apiKey: string, user: string)

    async postVideo(
        videoUrl: string,
        caption: string,
        hashtags: string[],
        platforms: string[]
    ): Promise<{ success: boolean; requestId?: string }>
}
```

### API Call Details

- **Endpoint**: `POST https://api.upload-post.com/api/upload`
- **Auth**: `Authorization: Apikey ${apiKey}`
- **Body**: Multipart form data with:
  - `user`: Upload-Post profile username (from credentials)
  - `platform[]`: Array of target platforms (e.g., `['youtube']` or `['youtube', 'instagram']`)
  - `video`: GCS URL of the edited video (Upload-Post accepts video URLs)
  - `title`: Full caption text (caption + "\n\n" + hashtags, same format as Instagram flow)
  - `async_upload`: `true` (fire-and-forget, no polling)
- **Response handling**: Log the response (success or error). Return `{ success: true, requestId }` on 200/202, `{ success: false }` on error. Do not throw — callers treat this as fire-and-forget.

## Updated Posting Flow

In `processPostInBackground` (`src/routes/post-reel.ts`), after video editing and GCS upload:

1. Look up `instagram_direct` credentials via `db.getCredentialsByPlatform(accountId, 'instagram_direct')`
2. Look up `upload_post` credentials via `db.getCredentialsByPlatform(accountId, 'upload_post')`
3. If neither exists, throw an error (post marked as failed)

### Instagram Direct (if credentials exist)

Post via `InstagramClientService` using the existing flow. This result determines success/failure of the post.

### Upload-Post (if credentials exist)

Determine target platforms:
- Always include `'youtube'`
- Add `'instagram'` only if no `instagram_direct` credentials were found in step 1

Call `UploadPostClientService.postVideo()` with the GCS video URL, caption, hashtags, and platforms.

### Success/Failure Rules

- **Has `instagram_direct` credentials**: Instagram direct result determines post status. Upload-Post is fire-and-forget (errors logged, don't affect status).
- **No `instagram_direct` credentials**: Upload-Post result determines post status.
- **Timing**: All posting operations must complete before marking the post and before GCS cleanup (the video URL must remain accessible for Upload-Post).

### Error Handling

If `instagram_direct` posting fails, the post is marked as `failed` regardless of Upload-Post success. If `instagram_direct` succeeds but Upload-Post fails, the post is still marked as `success` — the Upload-Post failure is logged as a warning.

If only `upload_post` credentials exist and the call fails, the post is marked as `failed`.

## Credential Validation

Update `src/routes/credentials.ts` to validate `upload_post` credential shape:

```typescript
const uploadPostCredentialsSchema = z.object({
    api_key: z.string().min(1, 'Upload-Post API key is required'),
    user: z.string().min(1, 'Upload-Post user is required'),
});
```

Extend the `createCredentialSchema.refine()` to validate:
- `instagram_direct` → `instagramDirectCredentialsSchema`
- `upload_post` → `uploadPostCredentialsSchema`

Same validation in `handleCredentialById` PATCH handler.

## Files Changed

- **Modify**: `src/types/index.ts` — add `UploadPostCredentials`, update `DbCredential` union
- **Create**: `src/services/upload-post-client.ts` — new Upload-Post API client
- **Modify**: `src/routes/post-reel.ts` — update `processPostInBackground` to support both platforms
- **Modify**: `src/routes/credentials.ts` — add `upload_post` credential validation
