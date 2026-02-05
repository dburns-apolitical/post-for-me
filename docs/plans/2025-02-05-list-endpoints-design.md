# List Endpoints Design

## Overview

Add three new GET endpoints to expose captions, hooks, and videos for selection in the dashboard app.

## Endpoints

### GET /api/captions

Returns all captions from the database.

**Authentication:** Required (`X-Dashboard-Password` header or JWT Bearer token)

**Response:**
```json
{
  "success": true,
  "captions": [
    { "id": 1, "text": "Summer vibes only ☀️", "created_at": "2025-01-15T10:30:00Z" },
    { "id": 2, "text": "Living my best life", "created_at": "2025-01-14T08:00:00Z" }
  ]
}
```

**Error Response (401):**
```json
{ "success": false, "error": "Unauthorized" }
```

---

### GET /api/hooks

Returns all hooks from the database.

**Authentication:** Required (`X-Dashboard-Password` header or JWT Bearer token)

**Response:**
```json
{
  "success": true,
  "hooks": [
    { "id": 1, "text": "Wait for it!", "created_at": "2025-01-15T10:30:00Z" },
    { "id": 2, "text": "You won't believe this", "created_at": "2025-01-14T08:00:00Z" }
  ]
}
```

**Error Response (401):**
```json
{ "success": false, "error": "Unauthorized" }
```

---

### GET /api/videos

Returns all video filenames from the GCS bucket.

**Authentication:** Required (`X-Dashboard-Password` header or JWT Bearer token)

**Response:**
```json
{
  "success": true,
  "videos": ["beach_sunset.mp4", "mountain_hike.mov", "city_timelapse.mp4"]
}
```

**Notes:**
- Only returns video files (extensions: .mp4, .mov, .avi, .mkv, .webm)
- Excludes files in the `edited/` folder
- Returns filenames only, not full URLs

**Error Response (401):**
```json
{ "success": false, "error": "Unauthorized" }
```

---

## Frontend Usage Examples

### With Password Auth

```typescript
// Fetch captions
const response = await fetch('https://api.example.com/api/captions', {
  headers: {
    'X-Dashboard-Password': 'your-dashboard-password'
  }
});
const { captions } = await response.json();

// Fetch hooks
const response = await fetch('https://api.example.com/api/hooks', {
  headers: {
    'X-Dashboard-Password': 'your-dashboard-password'
  }
});
const { hooks } = await response.json();

// Fetch videos
const response = await fetch('https://api.example.com/api/videos', {
  headers: {
    'X-Dashboard-Password': 'your-dashboard-password'
  }
});
const { videos } = await response.json();
```

### With JWT Auth

```typescript
const response = await fetch('https://api.example.com/api/captions', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`
  }
});
```

---

## Implementation Details

### New Files
- `src/routes/captions.ts` - GET /api/captions handler
- `src/routes/hooks.ts` - GET /api/hooks handler
- `src/routes/videos.ts` - GET /api/videos handler

### Modified Files
- `src/index.ts` - Add route handlers
- `src/services/database.ts` - Add `getAllCaptions()` and `getAllHooks()`
- `src/services/video-selector.ts` - Add `listAllVideos()`

### Database Queries

```sql
-- getAllCaptions()
SELECT id, text, created_at FROM captions ORDER BY created_at DESC;

-- getAllHooks()
SELECT id, text, created_at FROM hooks ORDER BY created_at DESC;
```

### GCS Logic

`listAllVideos()` reuses existing `fetchVideosFromGCS()` logic:
1. Fetch bucket contents via GCS JSON API
2. Filter to video extensions only (.mp4, .mov, .avi, .mkv, .webm)
3. Exclude files in `edited/` folder
4. Return array of filenames
