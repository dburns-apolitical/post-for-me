# Configurable Upload-Post Platforms Design

## Overview

Make the target platforms for Upload-Post configurable per credential. Add `instagram`, `youtube`, `tiktok`, and `twitter` boolean fields to `UploadPostCredentials`. The posting flow reads these booleans to build the `platform[]` array, still skipping `instagram` if `instagram_direct` credentials exist.

## Type Changes

Update `UploadPostCredentials` in `src/types/index.ts`:

```typescript
export interface UploadPostCredentials {
    api_key: string;
    user: string;
    instagram: boolean;
    youtube: boolean;
    tiktok: boolean;
    twitter: boolean;
}
```

No database schema changes — booleans stored in the existing JSONB `credentials` column.

## Backend Validation

Update `uploadPostCredentialsSchema` in `src/routes/credentials.ts`:

```typescript
const uploadPostCredentialsSchema = z.object({
    api_key: z.string().min(1, 'Upload-Post API key is required'),
    user: z.string().min(1, 'Upload-Post user is required'),
    instagram: z.boolean(),
    youtube: z.boolean(),
    tiktok: z.boolean(),
    twitter: z.boolean(),
});
```

## Posting Flow

Update `src/routes/post-reel.ts` — replace the hardcoded `['youtube']` platforms with dynamic platform building:

```typescript
const uploadPostPlatforms: string[] = [];
if (upCreds.youtube) uploadPostPlatforms.push('youtube');
if (upCreds.tiktok) uploadPostPlatforms.push('tiktok');
if (upCreds.twitter) uploadPostPlatforms.push('x');  // Upload-Post uses 'x' for Twitter
if (upCreds.instagram && !igCredential) uploadPostPlatforms.push('instagram');
```

If no platforms are enabled, skip the Upload-Post call entirely (log a warning).

The `instagram` platform is still only included if there are no `instagram_direct` credentials, preserving the existing deduplication logic.

Note: Upload-Post API uses `'x'` as the platform identifier for Twitter, so the `twitter` boolean maps to `'x'` in the platforms array.

## Frontend Changes

Update the `upload_post` credential form in `/Users/dec/development/molars-admin-dashboard/src/pages/accounts.tsx`:

Add 4 checkboxes below the `api_key` and `user` fields:
- Instagram
- YouTube
- TikTok
- Twitter

Using the existing `Checkbox` component from `@/components/ui/checkbox`.

Update `credentialFormData` state to include the 4 boolean fields (default `false`).

Update `handleSaveCredential` to include the booleans in the credentials payload for `upload_post`.

Update `isCredentialFormValid` — the api_key and user are still required, booleans are always valid (can all be false).

## Files Changed

**Backend (`post-for-me`):**
- Modify: `src/types/index.ts` — update `UploadPostCredentials`
- Modify: `src/routes/credentials.ts` — update `uploadPostCredentialsSchema`
- Modify: `src/routes/post-reel.ts` — dynamic platform building from credential booleans

**Frontend (`molars-admin-dashboard`):**
- Modify: `src/pages/accounts.tsx` — add platform checkboxes to upload_post credential form
