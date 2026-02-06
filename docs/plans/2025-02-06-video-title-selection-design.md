# Video Title Selection Design

## Overview

Add optional `videoTitle` parameter to POST /api/post-reel endpoint, allowing the dashboard to specify which video to use by its exact filename (as returned by GET /api/videos).

## API Change

### POST /api/post-reel

**Request body (updated):**

```typescript
{
  caption?: string,
  hookText?: string,
  hashtags?: string[],
  shareToFeed?: boolean,
  accountId?: number,
  videoTitle?: string  // NEW - exact filename from /api/videos
}
```

### Behavior

1. If `videoTitle` is provided:
   - Search GCS bucket for video with exact matching filename
   - If found → use that video (skip prioritized selection)
   - If not found → silently fall back to normal prioritized selection

2. If `videoTitle` is not provided:
   - Use existing prioritized selection (newest unused video)

### Validation

- Optional string
- Max length 500 characters
- No special regex (GCS filenames can have various characters)

## Implementation Details

### Files to Modify

1. **src/utils/validation.ts** - Add `videoTitle` to Zod schema
2. **src/services/video-selector.ts** - Add `findVideoByTitle()` method
3. **src/routes/post-reel.ts** - Use `videoTitle` if provided

### New Method: VideoSelectorService.findVideoByTitle()

```typescript
async findVideoByTitle(title: string): Promise<VideoFile | null> {
    const videos = await this.listVideos();
    return videos.find(v => v.name === title) ?? null;
}
```

### Updated Flow in post-reel.ts

```typescript
// Current: Always use prioritized selection
const { videoFile, localPath } = await videoSelector.getPrioritizedVideo(postedVideos);

// New: Try videoTitle first, fall back to prioritized
let videoFile: VideoFile;
let localPath: string;

if (validation.data.videoTitle) {
    const requestedVideo = await videoSelector.findVideoByTitle(validation.data.videoTitle);
    if (requestedVideo) {
        videoFile = requestedVideo;
        localPath = await videoSelector.downloadVideo(requestedVideo);
    } else {
        // Fallback to prioritized selection
        const result = await videoSelector.getPrioritizedVideo(postedVideos);
        videoFile = result.videoFile;
        localPath = result.localPath;
    }
} else {
    const result = await videoSelector.getPrioritizedVideo(postedVideos);
    videoFile = result.videoFile;
    localPath = result.localPath;
}
```

## Frontend Usage

```typescript
// Get available videos
const { videos } = await fetch('/api/videos', { headers }).then(r => r.json());

// Post with specific video
await fetch('/api/post-reel', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...authHeaders },
  body: JSON.stringify({
    videoTitle: videos[0],  // e.g., "beach_sunset.mp4"
    caption: "Summer vibes",
    hookText: "Wait for it!",
    hashtags: ["summer", "beach"]
  })
});
```

## Error Handling

- Video not found → Silent fallback to prioritized selection (no error)
- GCS API failure → Existing error handling (500 response)
- Invalid videoTitle format → Validation error (400 response, only if over 500 chars)
