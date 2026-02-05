# List Endpoints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three GET endpoints (`/api/captions`, `/api/hooks`, `/api/videos`) for the dashboard to list available content for selection.

**Architecture:** Three simple authenticated GET endpoints following existing patterns. Database methods in `DatabaseService`, GCS listing in `VideoSelectorService`, route handlers following `stats.ts` pattern.

**Tech Stack:** Bun, TypeScript, Neon PostgreSQL, GCS public JSON API, bun:test

---

## Frontend Integration Reference

### Authentication

All endpoints require one of:
- Header: `X-Dashboard-Password: <password>`
- Header: `Authorization: Bearer <jwt_token>`

### Endpoint Contracts

```typescript
// GET /api/captions
interface CaptionsResponse {
  success: true;
  captions: Array<{
    id: number;
    text: string;
    created_at: string; // ISO 8601
  }>;
}

// GET /api/hooks
interface HooksResponse {
  success: true;
  hooks: Array<{
    id: number;
    text: string;
    created_at: string; // ISO 8601
  }>;
}

// GET /api/videos
interface VideosResponse {
  success: true;
  videos: string[]; // filenames only, e.g. ["video1.mp4", "beach.mov"]
}

// Error response (401)
interface ErrorResponse {
  success: false;
  error: string;
}
```

### Usage Examples

```typescript
// Fetch captions
const res = await fetch('https://your-api.com/api/captions', {
  headers: { 'X-Dashboard-Password': password }
});
const { captions } = await res.json();

// Fetch hooks
const res = await fetch('https://your-api.com/api/hooks', {
  headers: { 'X-Dashboard-Password': password }
});
const { hooks } = await res.json();

// Fetch videos
const res = await fetch('https://your-api.com/api/videos', {
  headers: { 'X-Dashboard-Password': password }
});
const { videos } = await res.json();
```

---

## Task 1: Add getAllCaptions to DatabaseService

**Files:**
- Modify: `src/services/database.ts:474-483` (add method after getAccounts)
- Test: `tests/unit/database.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/database.test.ts` before the closing `});`:

```typescript
    describe('getAllCaptions', () => {
        test('should return all captions ordered by created_at desc', async () => {
            const mockCaptions = [
                { id: 2, text: 'Newer caption', created_at: new Date('2025-02-01') },
                { id: 1, text: 'Older caption', created_at: new Date('2025-01-01') },
            ];
            mockSql.mockResolvedValueOnce(mockCaptions);

            const result = await db.getAllCaptions();

            expect(result).toEqual(mockCaptions);
            expect(result).toHaveLength(2);
        });

        test('should return empty array when no captions', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getAllCaptions();

            expect(result).toEqual([]);
        });
    });
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/database.test.ts`
Expected: FAIL with "db.getAllCaptions is not a function"

**Step 3: Write minimal implementation**

Add to `src/services/database.ts` after `getAccounts()` method (around line 483):

```typescript
    /**
     * Get all captions from the database
     */
    async getAllCaptions(): Promise<DbCaption[]> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM captions
            ORDER BY created_at DESC
        ` as DbCaption[];
        return result;
    }
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/database.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/database.test.ts src/services/database.ts
git commit -m "feat: add getAllCaptions method to DatabaseService"
```

---

## Task 2: Add getAllHooks to DatabaseService

**Files:**
- Modify: `src/services/database.ts` (add method after getAllCaptions)
- Test: `tests/unit/database.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/database.test.ts` before the closing `});`:

```typescript
    describe('getAllHooks', () => {
        test('should return all hooks ordered by created_at desc', async () => {
            const mockHooks = [
                { id: 2, text: 'Newer hook', created_at: new Date('2025-02-01') },
                { id: 1, text: 'Older hook', created_at: new Date('2025-01-01') },
            ];
            mockSql.mockResolvedValueOnce(mockHooks);

            const result = await db.getAllHooks();

            expect(result).toEqual(mockHooks);
            expect(result).toHaveLength(2);
        });

        test('should return empty array when no hooks', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getAllHooks();

            expect(result).toEqual([]);
        });
    });
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/database.test.ts`
Expected: FAIL with "db.getAllHooks is not a function"

**Step 3: Write minimal implementation**

Add to `src/services/database.ts` after `getAllCaptions()` method:

```typescript
    /**
     * Get all hooks from the database
     */
    async getAllHooks(): Promise<DbHook[]> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM hooks
            ORDER BY created_at DESC
        ` as DbHook[];
        return result;
    }
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/database.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/database.test.ts src/services/database.ts
git commit -m "feat: add getAllHooks method to DatabaseService"
```

---

## Task 3: Add listAllVideoNames to VideoSelectorService

**Files:**
- Modify: `src/services/video-selector.ts` (add method after listVideos)
- Test: `tests/unit/video-selector.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/video-selector.test.ts` inside the main `describe` block:

```typescript
  describe('listAllVideoNames', () => {
    test('should return array of video filenames', async () => {
      const service = new VideoSelectorService();

      // Mock fetch for GCS API
      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
            { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
            { name: 'edited/video3.mp4', timeCreated: '2025-01-03T00:00:00Z' },
            { name: 'document.pdf', timeCreated: '2025-01-04T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.listAllVideoNames();

        expect(result).toEqual(['video1.mp4', 'video2.mov']);
        expect(result).not.toContain('edited/video3.mp4');
        expect(result).not.toContain('document.pdf');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should return empty array when no videos', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.listAllVideoNames();
        expect(result).toEqual([]);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/video-selector.test.ts`
Expected: FAIL with "service.listAllVideoNames is not a function"

**Step 3: Write minimal implementation**

Add to `src/services/video-selector.ts` after the `listVideos()` method (around line 70):

```typescript
    /**
     * List all video filenames in the GCS bucket (names only, no metadata)
     * Used by the dashboard to display available videos for selection
     */
    async listAllVideoNames(): Promise<string[]> {
        const videos = await this.listVideos();
        return videos.map((v) => v.name);
    }
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/video-selector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/video-selector.test.ts src/services/video-selector.ts
git commit -m "feat: add listAllVideoNames method to VideoSelectorService"
```

---

## Task 4: Create /api/captions route handler

**Files:**
- Create: `src/routes/captions.ts`
- Test: `tests/integration/captions.test.ts`

**Step 1: Write the failing test**

Create `tests/integration/captions.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the neon module
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleCaptions } from '../../src/routes/captions';

describe('GET /api/captions', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/captions', {
            method: 'GET',
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return captions with valid password auth', async () => {
        const mockCaptions = [
            { id: 1, text: 'Test caption', created_at: new Date() },
        ];
        mockSql.mockResolvedValueOnce(mockCaptions);

        const request = new Request('http://localhost/api/captions', {
            method: 'GET',
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.captions).toBeDefined();
        expect(Array.isArray(body.captions)).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/captions.test.ts`
Expected: FAIL with "Cannot find module '../../src/routes/captions'"

**Step 3: Write minimal implementation**

Create `src/routes/captions.ts`:

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';

export async function handleCaptions(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized captions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin captions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Captions request authenticated', { method: authResult.method });

    try {
        const db = new DatabaseService();
        const captions = await db.getAllCaptions();

        return Response.json({
            success: true,
            captions,
        });
    } catch (error) {
        logger.error('Error fetching captions', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch captions',
            },
            { status: 500 }
        );
    }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/captions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/captions.ts tests/integration/captions.test.ts
git commit -m "feat: add /api/captions route handler"
```

---

## Task 5: Create /api/hooks route handler

**Files:**
- Create: `src/routes/hooks.ts`
- Test: `tests/integration/hooks.test.ts`

**Step 1: Write the failing test**

Create `tests/integration/hooks.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the neon module
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleHooks } from '../../src/routes/hooks';

describe('GET /api/hooks', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/hooks', {
            method: 'GET',
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return hooks with valid password auth', async () => {
        const mockHooks = [
            { id: 1, text: 'Wait for it!', created_at: new Date() },
        ];
        mockSql.mockResolvedValueOnce(mockHooks);

        const request = new Request('http://localhost/api/hooks', {
            method: 'GET',
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.hooks).toBeDefined();
        expect(Array.isArray(body.hooks)).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/hooks.test.ts`
Expected: FAIL with "Cannot find module '../../src/routes/hooks'"

**Step 3: Write minimal implementation**

Create `src/routes/hooks.ts`:

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';

export async function handleHooks(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized hooks request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin hooks request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Hooks request authenticated', { method: authResult.method });

    try {
        const db = new DatabaseService();
        const hooks = await db.getAllHooks();

        return Response.json({
            success: true,
            hooks,
        });
    } catch (error) {
        logger.error('Error fetching hooks', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch hooks',
            },
            { status: 500 }
        );
    }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/hooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/hooks.ts tests/integration/hooks.test.ts
git commit -m "feat: add /api/hooks route handler"
```

---

## Task 6: Create /api/videos route handler

**Files:**
- Create: `src/routes/videos.ts`
- Test: `tests/integration/videos.test.ts`

**Step 1: Write the failing test**

Create `tests/integration/videos.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock fetch for GCS API
const mockFetch = mock(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
}) as unknown as typeof fetch);

// Store original fetch
const originalFetch = global.fetch;

// Mock the neon module (needed for validateAuth)
mock.module('@neondatabase/serverless', () => ({
    neon: () => mock(() => Promise.resolve([])),
}));

// Import after mocking
import { handleVideos } from '../../src/routes/videos';

describe('GET /api/videos', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch;
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/videos', {
            method: 'GET',
        });

        const response = await handleVideos(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return videos with valid password auth', async () => {
        mockFetch.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                items: [
                    { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
                    { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
                ],
            }),
        }) as unknown as ReturnType<typeof fetch>);

        const request = new Request('http://localhost/api/videos', {
            method: 'GET',
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const response = await handleVideos(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.videos).toBeDefined();
        expect(Array.isArray(body.videos)).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/videos.test.ts`
Expected: FAIL with "Cannot find module '../../src/routes/videos'"

**Step 3: Write minimal implementation**

Create `src/routes/videos.ts`:

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { VideoSelectorService } from '../services/video-selector.js';

export async function handleVideos(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized videos request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin videos request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Videos request authenticated', { method: authResult.method });

    try {
        const videoSelector = new VideoSelectorService();
        const videos = await videoSelector.listAllVideoNames();

        return Response.json({
            success: true,
            videos,
        });
    } catch (error) {
        logger.error('Error fetching videos', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch videos',
            },
            { status: 500 }
        );
    }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/videos.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/videos.ts tests/integration/videos.test.ts
git commit -m "feat: add /api/videos route handler"
```

---

## Task 7: Wire up routes in main server

**Files:**
- Modify: `src/index.ts`

**Step 1: Run all tests to ensure baseline passes**

Run: `bun test`
Expected: All existing tests pass

**Step 2: Add imports and route handlers**

In `src/index.ts`, add imports after line 6:

```typescript
import { handleCaptions } from './routes/captions.js';
import { handleHooks } from './routes/hooks.js';
import { handleVideos } from './routes/videos.js';
```

**Step 3: Add route handlers in fetch function**

In `src/index.ts`, add routes after the `/api/stats` handler (around line 200):

```typescript
      // List captions endpoint (requires authentication)
      if (url.pathname === '/api/captions' && request.method === 'GET') {
        return withCors(await handleCaptions(request), request);
      }

      // List hooks endpoint (requires authentication)
      if (url.pathname === '/api/hooks' && request.method === 'GET') {
        return withCors(await handleHooks(request), request);
      }

      // List videos endpoint (requires authentication)
      if (url.pathname === '/api/videos' && request.method === 'GET') {
        return withCors(await handleVideos(request), request);
      }
```

**Step 4: Run all tests to verify nothing broke**

Run: `bun test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up captions, hooks, and videos endpoints"
```

---

## Task 8: Manual verification

**Step 1: Start the development server**

Run: `bun run src/index.ts`

**Step 2: Test each endpoint with curl**

```bash
# Test /api/captions
curl -X GET http://localhost:3000/api/captions \
  -H "X-Dashboard-Password: $DASHBOARD_PASSWORD"

# Test /api/hooks
curl -X GET http://localhost:3000/api/hooks \
  -H "X-Dashboard-Password: $DASHBOARD_PASSWORD"

# Test /api/videos
curl -X GET http://localhost:3000/api/videos \
  -H "X-Dashboard-Password: $DASHBOARD_PASSWORD"
```

**Step 3: Verify responses match expected format**

Each should return:
```json
{ "success": true, "captions|hooks|videos": [...] }
```

**Step 4: Test unauthorized access**

```bash
curl -X GET http://localhost:3000/api/captions
```

Should return: `{ "success": false, "error": "Unauthorized" }` with status 401

**Step 5: Final commit**

```bash
git add -A
git commit -m "docs: add list endpoints design and implementation plan"
```
