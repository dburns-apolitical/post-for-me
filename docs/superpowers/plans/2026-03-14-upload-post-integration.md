# Upload-Post Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Upload-Post as a second posting platform so that videos are posted to YouTube (and optionally Instagram) via the Upload-Post API alongside the existing Instagram direct flow.

**Architecture:** New `UploadPostClientService` handles Upload-Post API calls. The posting flow in `post-reel.ts` checks for both credential types and runs them concurrently. Instagram direct determines success/failure when present; Upload-Post is fire-and-forget in that case.

**Tech Stack:** Bun, TypeScript, Upload-Post API (multipart form data), Zod validation

**Spec:** `docs/superpowers/specs/2026-03-14-upload-post-integration-design.md`

---

## Chunk 1: Types, Service, and DB Changes

### Task 1: Add UploadPostCredentials type and update DbCredential union

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add UploadPostCredentials interface and update DbCredential**

Add after the `InstagramDirectCredentials` interface (after line 138):

```typescript
export interface UploadPostCredentials {
    api_key: string;
    user: string;
}
```

Update `DbCredential.credentials` type (line 144) from:

```typescript
    credentials: InstagramDirectCredentials;
```

To:

```typescript
    credentials: InstagramDirectCredentials | UploadPostCredentials;
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add UploadPostCredentials type and update DbCredential union"
```

---

### Task 2: Update markPostSuccess to accept null instagramPostId

**Files:**
- Modify: `src/services/database.ts:552-558`

- [ ] **Step 1: Update method signature and SQL**

Change `markPostSuccess` from:

```typescript
    async markPostSuccess(postId: number, instagramPostId: string): Promise<void> {
        await this.sql`
            UPDATE posts
            SET status = 'success', instagram_post_id = ${instagramPostId}, updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as success', { postId, instagramPostId });
    }
```

To:

```typescript
    async markPostSuccess(postId: number, instagramPostId: string | null): Promise<void> {
        await this.sql`
            UPDATE posts
            SET status = 'success', instagram_post_id = ${instagramPostId}, updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as success', { postId, instagramPostId });
    }
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/database.ts
git commit -m "feat: update markPostSuccess to accept null instagramPostId"
```

---

### Task 3: Create UploadPostClientService

**Files:**
- Create: `src/services/upload-post-client.ts`

- [ ] **Step 1: Create the service**

```typescript
import { logger } from '../utils/logger.js';

export class UploadPostClientService {
    private baseUrl = 'https://api.upload-post.com/api';

    constructor(
        private apiKey: string,
        private user: string
    ) {}

    /**
     * Post a video to Upload-Post platforms (fire-and-forget style).
     * Never throws — returns { success: false } on error.
     */
    async postVideo(
        videoUrl: string,
        caption: string,
        hashtags: string[],
        platforms: string[]
    ): Promise<{ success: boolean; requestId?: string }> {
        try {
            const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
            const fullCaption = `${caption}\n\n${hashtagString}`;

            const formData = new FormData();
            formData.append('user', this.user);
            formData.append('video', videoUrl);
            formData.append('title', fullCaption);
            formData.append('async_upload', 'true');

            for (const platform of platforms) {
                formData.append('platform[]', platform);
            }

            logger.info('Posting video to Upload-Post', {
                user: this.user,
                platforms,
                videoUrl,
            });

            const response = await fetch(`${this.baseUrl}/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Apikey ${this.apiKey}`,
                },
                body: formData,
            });

            const data = await response.json() as Record<string, unknown>;

            if (response.ok) {
                const requestId = (data as { request_id?: string }).request_id;
                logger.info('Upload-Post request accepted', {
                    status: response.status,
                    requestId,
                    platforms,
                });
                return { success: true, requestId: requestId || undefined };
            }

            logger.error('Upload-Post request failed', {
                status: response.status,
                response: data,
                platforms,
            });
            return { success: false };
        } catch (error) {
            logger.error('Error calling Upload-Post API', {
                error: error instanceof Error ? error.message : 'Unknown error',
                platforms,
            });
            return { success: false };
        }
    }
}
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/upload-post-client.ts
git commit -m "feat: add UploadPostClientService for Upload-Post API integration"
```

---

## Chunk 2: Update Posting Flow and Credential Validation

### Task 4: Update post-reel to support both platforms concurrently

**Files:**
- Modify: `src/routes/post-reel.ts`

- [ ] **Step 1: Add UploadPostClientService import**

Add after line 7 (`import { InstagramClientService } from '../services/instagram-client.js';`):

```typescript
import { UploadPostClientService } from '../services/upload-post-client.js';
```

- [ ] **Step 2: Rewrite the credential lookup and posting logic inside the try block**

Replace the current credential lookup and Instagram posting code inside the `try` block of `processPostInBackground` (lines 31-81, from the credential lookup through `markPostSuccess`) with:

```typescript
        // Look up credentials for both platforms
        const igCredential = await db.getCredentialsByPlatform(account.id, 'instagram_direct');
        const upCredential = await db.getCredentialsByPlatform(account.id, 'upload_post');

        if (!igCredential && !upCredential) {
            throw new Error(`No credentials found for account ${account.id} (need instagram_direct or upload_post)`);
        }

        // Build concurrent posting promises
        const postingPromises: Promise<void>[] = [];
        let instagramPostId: string | null = null;
        let igError: Error | null = null;

        // Instagram direct posting (if credentials exist)
        if (igCredential) {
            const igPromise = (async () => {
                const instagramClient = new InstagramClientService(
                    igCredential.credentials.ig_access_token,
                    igCredential.credentials.ig_user_id
                );

                logger.info('Posting Reel to Instagram (direct)', { postId });
                const instagramPost = await instagramClient.postReel(
                    editedVideoUrl!,
                    caption,
                    hashtags,
                    shareToFeed
                );

                instagramPostId = instagramPost.id;
                logger.info('Reel posted to Instagram successfully', {
                    postId,
                    instagramPostId: instagramPost.id,
                    status: instagramPost.status,
                });
            })();
            postingPromises.push(igPromise.catch((err) => { igError = err; }));
        }

        // Upload-Post posting (if credentials exist)
        if (upCredential) {
            const uploadPostPlatforms: string[] = ['youtube'];
            if (!igCredential) {
                uploadPostPlatforms.push('instagram');
            }

            const upPromise = (async () => {
                const uploadPostClient = new UploadPostClientService(
                    upCredential.credentials.api_key,
                    upCredential.credentials.user
                );

                logger.info('Posting video to Upload-Post', { postId, platforms: uploadPostPlatforms });
                const result = await uploadPostClient.postVideo(
                    editedVideoUrl!,
                    caption,
                    hashtags,
                    uploadPostPlatforms
                );

                if (!result.success && !igCredential) {
                    throw new Error('Upload-Post posting failed and no instagram_direct fallback');
                }

                if (!result.success) {
                    logger.warn('Upload-Post posting failed (non-critical, instagram_direct is primary)', { postId });
                }
            })();
            postingPromises.push(upPromise.catch((err) => {
                if (!igCredential) {
                    igError = err; // Use igError to propagate failure when Upload-Post is primary
                } else {
                    logger.warn('Upload-Post error (non-critical)', {
                        postId,
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }));
        }

        // Wait for all posting operations to complete
        await Promise.all(postingPromises);

        // Check for errors from the primary platform
        if (igError) {
            throw igError;
        }

        // Mark post as success
        logger.info('Updating post status to success', { postId });
        await db.markPostSuccess(postId, instagramPostId);
```

Note: The `igCredential.credentials` property access works because when `platform === 'instagram_direct'`, the credentials are `InstagramDirectCredentials`. Similarly, `upCredential.credentials` when `platform === 'upload_post'` are `UploadPostCredentials`. TypeScript may require type narrowing — cast with `as InstagramDirectCredentials` or `as UploadPostCredentials` as needed since the platform check serves as a discriminant.

- [ ] **Step 3: Verify types compile**

Run: `bunx tsc --noEmit`

If TypeScript complains about the union type on `credentials`, add explicit casts:
- `(igCredential.credentials as InstagramDirectCredentials).ig_access_token`
- `(upCredential.credentials as UploadPostCredentials).api_key`

And add the imports at the top:
```typescript
import type { InstagramDirectCredentials, UploadPostCredentials } from '../types/index.js';
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: update post-reel to support concurrent Instagram direct and Upload-Post posting"
```

---

### Task 5: Update credential validation for upload_post

**Files:**
- Modify: `src/routes/credentials.ts`

- [ ] **Step 1: Add uploadPostCredentialsSchema**

Add after the `instagramDirectCredentialsSchema` definition (after line 13):

```typescript
const uploadPostCredentialsSchema = z.object({
    api_key: z.string().min(1, 'Upload-Post API key is required'),
    user: z.string().min(1, 'Upload-Post user is required'),
});
```

- [ ] **Step 2: Update createCredentialSchema refine**

Replace the `createCredentialSchema` refine callback (lines 18-26):

```typescript
const createCredentialSchema = z.object({
    platform: z.enum(platformValues),
    credentials: z.record(z.unknown()),
}).refine(
    (data) => {
        if (data.platform === 'instagram_direct') {
            return instagramDirectCredentialsSchema.safeParse(data.credentials).success;
        }
        if (data.platform === 'upload_post') {
            return uploadPostCredentialsSchema.safeParse(data.credentials).success;
        }
        return false;
    },
    { message: 'Invalid credentials for the specified platform' }
);
```

- [ ] **Step 3: Update PATCH handler validation**

In `handleCredentialById`, after the `instagram_direct` validation block (line 138), add an `else if` for `upload_post`:

```typescript
            } else if (existing.platform === 'upload_post') {
                const platformValidation = uploadPostCredentialsSchema.safeParse(parsed.data.credentials);
                if (!platformValidation.success) {
                    return Response.json(
                        { success: false, error: platformValidation.error.errors[0].message },
                        { status: 400 }
                    );
                }
            }
```

- [ ] **Step 4: Update type imports and casts**

Update the import (line 6) to include `UploadPostCredentials`:

```typescript
import type { Platform, InstagramDirectCredentials, UploadPostCredentials } from '../types/index.js';
```

Update the POST handler cast (line 76) from:
```typescript
                parsed.data.credentials as unknown as InstagramDirectCredentials
```
To:
```typescript
                parsed.data.credentials as unknown as (InstagramDirectCredentials | UploadPostCredentials)
```

Update the PATCH handler cast (line 140) similarly:
```typescript
                parsed.data.credentials as unknown as (InstagramDirectCredentials | UploadPostCredentials)
```

- [ ] **Step 5: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/credentials.ts
git commit -m "feat: add upload_post credential validation, tighten refine fallback"
```

---

### Task 6: Run full test suite

- [ ] **Step 1: Run all unit tests**

Run: `bun test tests/unit/`
Expected: Same baseline as before (44 pass / 62 fail — pre-existing)

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit any fixes if needed**
