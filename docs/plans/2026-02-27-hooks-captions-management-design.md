# Hooks & Captions Management — Design Document

**Date:** 2026-02-27
**Status:** Approved

## Overview

Add the ability to manage hooks and captions through the API: create new entries, enable/disable existing ones, and filter by enabled state. The random selection logic used during post creation will respect the enabled/disabled state.

## Database Changes

### Schema Additions

Both `hooks` and `captions` tables gain an `enabled` column:

```sql
ALTER TABLE hooks ADD COLUMN enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE captions ADD COLUMN enabled BOOLEAN DEFAULT TRUE;
```

All existing rows receive `enabled = TRUE` via the default.

### Updated TypeScript Types

```typescript
export interface DbHook {
    id: number;
    text: string;
    enabled: boolean;
    created_at: Date;
}

export interface DbCaption {
    id: number;
    text: string;
    enabled: boolean;
    created_at: Date;
}
```

## API Endpoints

All endpoints require admin authentication (same as existing endpoints).

---

### GET /api/hooks

List hooks. By default returns only enabled hooks (for post-creation UI). Pass `?all=true` to get all hooks including disabled (for management UI).

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `all` | string | — | If `"true"`, return all hooks including disabled |

**Response (200):**

```json
{
  "success": true,
  "hooks": [
    {
      "id": 1,
      "text": "Watch this...",
      "enabled": true,
      "created_at": "2025-02-20T10:30:00Z"
    }
  ]
}
```

**Notes:**
- Without `?all=true`: returns hooks where `enabled = TRUE`, ordered by `created_at DESC`
- With `?all=true`: returns all hooks regardless of enabled state, ordered by `created_at DESC`
- The `enabled` field is always included in the response

---

### GET /api/captions

List captions. Same behavior as `GET /api/hooks`.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `all` | string | — | If `"true"`, return all captions including disabled |

**Response (200):**

```json
{
  "success": true,
  "captions": [
    {
      "id": 1,
      "text": "Amazing dental content...",
      "enabled": true,
      "created_at": "2025-02-20T10:30:00Z"
    }
  ]
}
```

---

### POST /api/hooks

Create a new hook. New hooks are enabled by default.

**Request Body:**

```json
{
  "text": "You won't believe what happens next..."
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `text` | string | Yes | 1-500 characters, must be unique |

**Response (201):**

```json
{
  "success": true,
  "hook": {
    "id": 3,
    "text": "You won't believe what happens next...",
    "enabled": true,
    "created_at": "2026-02-27T10:30:00Z"
  }
}
```

**Error (409 — duplicate):**

```json
{
  "success": false,
  "error": "A hook with this text already exists"
}
```

---

### POST /api/captions

Create a new caption. Same behavior as `POST /api/hooks`.

**Request Body:**

```json
{
  "text": "Transform your smile today..."
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `text` | string | Yes | 1-2200 characters, must be unique |

**Response (201):**

```json
{
  "success": true,
  "caption": {
    "id": 5,
    "text": "Transform your smile today...",
    "enabled": true,
    "created_at": "2026-02-27T10:30:00Z"
  }
}
```

**Error (409 — duplicate):**

```json
{
  "success": false,
  "error": "A caption with this text already exists"
}
```

---

### PATCH /api/hooks/:id

Toggle a hook's enabled state.

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Hook ID |

**Request Body:**

```json
{
  "enabled": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | New enabled state |

**Response (200):**

```json
{
  "success": true,
  "hook": {
    "id": 1,
    "text": "Watch this...",
    "enabled": false,
    "created_at": "2025-02-20T10:30:00Z"
  }
}
```

**Error (404):**

```json
{
  "success": false,
  "error": "Hook not found"
}
```

---

### PATCH /api/captions/:id

Toggle a caption's enabled state. Same behavior as `PATCH /api/hooks/:id`.

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | number | Caption ID |

**Request Body:**

```json
{
  "enabled": true
}
```

**Response (200):**

```json
{
  "success": true,
  "caption": {
    "id": 2,
    "text": "Amazing dental content...",
    "enabled": true,
    "created_at": "2025-02-20T10:30:00Z"
  }
}
```

**Error (404):**

```json
{
  "success": false,
  "error": "Caption not found"
}
```

---

## Random Selection Behavior

The random selection queries used during auto-selection in `POST /api/post-reel` are updated to only select from enabled items:

```sql
-- Before
SELECT id, text, created_at FROM hooks ORDER BY RANDOM() LIMIT 1;

-- After
SELECT id, text, enabled, created_at FROM hooks WHERE enabled = TRUE ORDER BY RANDOM() LIMIT 1;
```

Same change for captions. If all items are disabled, the existing 400 error response applies:
- `"No hookText provided and no hooks in database"`
- `"No caption provided and no captions in database"`

## What Doesn't Change

- **POST /api/post-reel** — unchanged flow, benefits from filtered random selection automatically
- **GET /api/stats** — still shows stats for all hooks/captions (including disabled) since historical data should remain visible
- **Frontend post-creation** — `GET /api/hooks` without `?all=true` returns enabled-only, so existing behavior is preserved

## New Database Methods

| Method | Purpose |
|--------|---------|
| `getAllHooks(enabledOnly?: boolean)` | Get hooks, optionally filtered to enabled-only |
| `getAllCaptions(enabledOnly?: boolean)` | Get captions, optionally filtered to enabled-only |
| `createHook(text: string)` | Insert new hook (enabled=true), return it |
| `createCaption(text: string)` | Insert new caption (enabled=true), return it |
| `updateHookEnabled(id: number, enabled: boolean)` | Set hook enabled state |
| `updateCaptionEnabled(id: number, enabled: boolean)` | Set caption enabled state |

Updated methods:
- `getRandomHook()` — adds `WHERE enabled = TRUE`
- `getRandomCaption()` — adds `WHERE enabled = TRUE`
