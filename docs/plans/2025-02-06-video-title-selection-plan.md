# Video Title Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional `videoTitle` parameter to POST /api/post-reel to allow selecting a specific video by filename.

**Architecture:** Add videoTitle to Zod schema, add findVideoByTitle method to VideoSelectorService, update post-reel route to use videoTitle if provided with silent fallback to prioritized selection.

**Tech Stack:** Bun, TypeScript, Zod validation, bun:test

---

## Task 1: Add videoTitle to validation schema

**Files:**
- Modify: `src/utils/validation.ts`
- Test: `tests/unit/validation.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/validation.test.ts` before the closing `});`:

```typescript
        test('should pass with valid videoTitle', () => {
            const input = {
                videoTitle: 'beach_sunset.mp4',
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.videoTitle).toBe('beach_sunset.mp4');
            }
        });

        test('should pass when videoTitle is not provided', () => {
            const input = {
                caption: 'Caption',
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.videoTitle).toBeUndefined();
            }
        });

        test('should fail when videoTitle is too long', () => {
            const input = {
                videoTitle: 'a'.repeat(501),
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail when videoTitle is empty string', () => {
            const input = {
                videoTitle: '',
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/validation.test.ts`
Expected: FAIL - videoTitle not in schema

**Step 3: Write minimal implementation**

Update `src/utils/validation.ts`:

```typescript
import { z } from 'zod';

export const postReelSchema = z.object({
    caption: z.string().min(1, 'Caption cannot be empty').max(2200, 'Caption too long').optional(),
    hookText: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long').optional(),
    hashtags: z.array(z.string().regex(/^[a-zA-Z0-9_]+$/, 'Invalid hashtag format'))
        .min(1, 'At least one hashtag required if provided')
        .max(30, 'Maximum 30 hashtags allowed')
        .optional(),
    shareToFeed: z.boolean().optional(),
    accountId: z.number().int().min(1).max(2).optional(),
    videoTitle: z.string().min(1, 'Video title cannot be empty').max(500, 'Video title too long').optional(),
});

export type PostReelInput = z.infer<typeof postReelSchema>;

export function validatePostReelRequest(data: unknown) {
    return postReelSchema.safeParse(data);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/validation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/validation.ts tests/unit/validation.test.ts
git commit -m "feat: add videoTitle to post-reel validation schema"
```

---

## Task 2: Add findVideoByTitle to VideoSelectorService

**Files:**
- Modify: `src/services/video-selector.ts`
- Test: `tests/unit/video-selector.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/video-selector.test.ts` inside the main `describe` block, after the `listAllVideoNames` tests:

```typescript
  describe('findVideoByTitle', () => {
    test('should return video when title matches exactly', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
            { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.findVideoByTitle('video1.mp4');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('video1.mp4');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should return null when title does not match', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
            { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.findVideoByTitle('nonexistent.mp4');

        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should be case-sensitive (exact match only)', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'Video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.findVideoByTitle('video1.mp4');

        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/video-selector.test.ts`
Expected: FAIL with "service.findVideoByTitle is not a function"

**Step 3: Write minimal implementation**

Add to `src/services/video-selector.ts` after the `listAllVideoNames()` method:

```typescript
    /**
     * Find a specific video by its exact title/filename
     * Returns null if not found
     */
    async findVideoByTitle(title: string): Promise<VideoFile | null> {
        const videos = await this.listVideos();
        return videos.find((v) => v.name === title) ?? null;
    }
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/video-selector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/video-selector.ts tests/unit/video-selector.test.ts
git commit -m "feat: add findVideoByTitle method to VideoSelectorService"
```

---

## Task 3: Update post-reel route to use videoTitle

**Files:**
- Modify: `src/routes/post-reel.ts:214-223`

**Step 1: Run all tests to ensure baseline passes**

Run: `bun test tests/unit`
Expected: All tests pass

**Step 2: Update the video selection logic**

In `src/routes/post-reel.ts`, replace lines 214-223:

```typescript
        // Step 1: Select and download prioritized video from GCS (newest unused first)
        logger.info('Step 1: Selecting prioritized video from storage');
        const postedVideos = await db.getPostedVideoTitles(accountId);
        const { videoFile, localPath } = await videoSelector.getPrioritizedVideo(postedVideos);

        logger.info('Video selected', {
            videoName: videoFile.name,
            localPath,
            createdAt: videoFile.createdAt.toISOString(),
        });
```

With this new code:

```typescript
        // Step 1: Select video - use videoTitle if provided, otherwise prioritized selection
        logger.info('Step 1: Selecting video from storage');
        const postedVideos = await db.getPostedVideoTitles(accountId);

        let videoFile;
        let localPath;
        const requestedTitle = validation.data.videoTitle;

        if (requestedTitle) {
            logger.info('Attempting to find requested video', { videoTitle: requestedTitle });
            const foundVideo = await videoSelector.findVideoByTitle(requestedTitle);

            if (foundVideo) {
                videoFile = foundVideo;
                localPath = await videoSelector.downloadVideo(foundVideo);
                logger.info('Using requested video', { videoName: videoFile.name });
            } else {
                logger.info('Requested video not found, falling back to prioritized selection', {
                    videoTitle: requestedTitle
                });
                const result = await videoSelector.getPrioritizedVideo(postedVideos);
                videoFile = result.videoFile;
                localPath = result.localPath;
            }
        } else {
            const result = await videoSelector.getPrioritizedVideo(postedVideos);
            videoFile = result.videoFile;
            localPath = result.localPath;
        }

        logger.info('Video selected', {
            videoName: videoFile.name,
            localPath,
            createdAt: videoFile.createdAt.toISOString(),
        });
```

**Step 3: Run all tests to verify nothing broke**

Run: `bun test tests/unit`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: use videoTitle parameter in post-reel for specific video selection"
```

---

## Task 4: Update post-reel logging to include videoTitle

**Files:**
- Modify: `src/routes/post-reel.ts:206-212`

**Step 1: Update the request logging**

In `src/routes/post-reel.ts`, update the log at lines 206-212 to include videoTitle:

```typescript
        logger.info('Post reel request received', {
            captionLength: caption.length,
            hookText,
            hashtagCount: hashtags.length,
            shareToFeed,
            accountId,
            videoTitle: validation.data.videoTitle || null,
        });
```

**Step 2: Run tests to verify nothing broke**

Run: `bun test tests/unit`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: log videoTitle parameter in post-reel requests"
```

