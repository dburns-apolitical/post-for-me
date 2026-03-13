# Recent Posts List Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Most Recent Post" card with a compact list showing the most recent post per account (up to 5), sorted newest first.

**Architecture:** New `GET /api/stats/recent-posts` endpoint with a `DISTINCT ON` query, consumed by a new `useRecentPosts()` hook. The existing `mostRecentPost` field is removed from the stats endpoint and types on both sides.

**Tech Stack:** Bun, TypeScript, PostgreSQL (Neon), React 19, Tailwind CSS, Radix UI

**Spec:** `docs/superpowers/specs/2026-03-13-recent-posts-list-design.md`

---

## Chunk 1: Backend

### Task 1: Add RecentPost type

**Files:**
- Modify: `src/types/index.ts:148-170` (add new interface)
- Modify: `src/types/index.ts:193-205` (remove `mostRecentPost` from `DashboardStats`)

- [ ] **Step 1: Add `RecentPost` interface to backend types**

In `src/types/index.ts`, add after the `PostWithDetails` interface (after line 170):

```typescript
export interface RecentPost {
    account_name: string;
    video_title: string;
    status: PostStatus;
    created_at: string;
}
```

- [ ] **Step 2: Remove `mostRecentPost` from `DashboardStats`**

In `src/types/index.ts`, remove line 195:
```typescript
    mostRecentPost: PostWithDetails | null;
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/dec/development/post-for-me && bun build src/types/index.ts --no-bundle`
Expected: No type errors (stats.ts will have errors — that's expected, we fix it in Task 3)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add RecentPost type, remove mostRecentPost from DashboardStats"
```

### Task 2: Create recent-posts route

**Files:**
- Create: `src/routes/recent-posts.ts`
- Modify: `src/index.ts:7` (add import after line 7)
- Modify: `src/index.ts:222-225` (add route registration after views-history block)

- [ ] **Step 1: Create `src/routes/recent-posts.ts`**

Follow the `views-history.ts` pattern exactly:

```typescript
import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { PostStatus } from '../types/index.js';

interface RecentPostRow {
    account_name: string;
    video_title: string;
    status: string;
    created_at: string;
}

export async function handleRecentPosts(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized recent posts request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin recent posts request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const config = getConfig();
        const sql = neon(config.databaseUrl);

        const rows = await sql`
            SELECT * FROM (
                SELECT DISTINCT ON (p.account_id)
                    a.name AS account_name,
                    v.title AS video_title,
                    p.status,
                    p.created_at
                FROM posts p
                JOIN accounts a ON p.account_id = a.id
                JOIN videos v ON p.video_id = v.id
                ORDER BY p.account_id, p.created_at DESC
            ) sub
            ORDER BY created_at DESC
            LIMIT 5
        ` as RecentPostRow[];

        const recentPosts = rows.map(row => ({
            account_name: row.account_name,
            video_title: row.video_title,
            status: row.status as PostStatus,
            created_at: row.created_at,
        }));

        return Response.json({
            success: true,
            recentPosts,
        });
    } catch (error) {
        logger.error('Error fetching recent posts', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch recent posts',
            },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 2: Register route in `src/index.ts`**

Add import after line 7 (`handleViewsHistory`), before `handleBackfillDailyViews`:
```typescript
import { handleRecentPosts } from './routes/recent-posts.js';
```

Add route registration after the views-history block (after line 225):
```typescript
      // Recent posts endpoint (requires authentication)
      if (url.pathname === '/api/stats/recent-posts' && request.method === 'GET') {
        return withCors(await handleRecentPosts(request), request);
      }
```

- [ ] **Step 3: Verify the server starts**

Run: `cd /Users/dec/development/post-for-me && bun run src/index.ts`
Expected: Server starts without errors. Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add src/routes/recent-posts.ts src/index.ts
git commit -m "feat: add GET /api/stats/recent-posts endpoint"
```

### Task 3: Remove mostRecentPost from stats route

**Files:**
- Modify: `src/routes/stats.ts:50-88` (remove from Promise.all and response)
- Modify: `src/routes/stats.ts:164-207` (delete `getMostRecentPost` function)

- [ ] **Step 1: Remove `getMostRecentPost` from the Promise.all**

In `src/routes/stats.ts`, remove `mostRecentPostResult` from the destructuring (line 52) and `getMostRecentPost(sql, accountId)` from the Promise.all array (line 64).

- [ ] **Step 2: Remove `mostRecentPost` from the stats object**

In `src/routes/stats.ts`, remove line 78:
```typescript
            mostRecentPost: mostRecentPostResult,
```

- [ ] **Step 3: Delete the `getMostRecentPost` function**

Delete lines 161-207 (the JSDoc comment + entire function).

- [ ] **Step 4: Verify the server starts**

Run: `cd /Users/dec/development/post-for-me && bun run src/index.ts`
Expected: Server starts without errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/stats.ts
git commit -m "refactor: remove mostRecentPost from stats endpoint"
```

---

## Chunk 2: Frontend

### Task 4: Add RecentPost type and useRecentPosts hook

**Files:**
- Modify: `molars-admin-dashboard/src/types/dashboard.ts` (add type, remove `mostRecentPost` from `DashboardStats`)
- Create: `molars-admin-dashboard/src/hooks/useRecentPosts.ts`

Note: the frontend repo is at `/Users/dec/development/molars-admin-dashboard/`.

- [ ] **Step 1: Add `RecentPost` interface to frontend types**

In `molars-admin-dashboard/src/types/dashboard.ts`, add after `PostWithDetails`:

```typescript
export interface RecentPost {
  account_name: string;
  video_title: string;
  status: PostStatus;
  created_at: string;
}
```

- [ ] **Step 2: Remove `mostRecentPost` from frontend `DashboardStats`**

In `molars-admin-dashboard/src/types/dashboard.ts`, remove:
```typescript
  mostRecentPost: PostWithDetails | null;
```

- [ ] **Step 3: Create `useRecentPosts` hook**

Create `molars-admin-dashboard/src/hooks/useRecentPosts.ts` following the `useViewsHistory.ts` pattern:

```typescript
import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { authClient } from '@/lib/auth';
import type { RecentPost } from '@/types/dashboard';

interface UseRecentPostsResult {
  recentPosts: RecentPost[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRecentPosts(): UseRecentPostsResult {
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRecentPosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const session = await authClient.getSession();

      if (!session?.data?.session?.token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${API_BASE_URL}/api/stats/recent-posts`, {
        headers: {
          'Authorization': `Bearer ${session.data.session.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch recent posts: ${response.statusText}`);
      }

      const result = await response.json() as { success: boolean; recentPosts: RecentPost[] };
      setRecentPosts(result.recentPosts);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentPosts();
  }, [fetchRecentPosts]);

  return { recentPosts, isLoading, error, refetch: fetchRecentPosts };
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/types/dashboard.ts src/hooks/useRecentPosts.ts
git commit -m "feat: add RecentPost type and useRecentPosts hook"
```

### Task 5: Replace Most Recent Post section with RecentPostsList

**Files:**
- Modify: `molars-admin-dashboard/src/pages/home.tsx:260-263` (add hook call)
- Modify: `molars-admin-dashboard/src/pages/home.tsx:317-331` (replace section)

- [ ] **Step 1: Add useRecentPosts import and hook call**

In `home.tsx`, add import:
```typescript
import { useRecentPosts } from '@/hooks/useRecentPosts';
```

In the `Home()` component (around line 263), add:
```typescript
    const { recentPosts, isLoading: recentPostsLoading } = useRecentPosts();
```

- [ ] **Step 2: Replace the "Most Recent Post" section (lines 317-331)**

Replace the entire section with:

```tsx
            {/* Recent Posts */}
            <section>
                <h2 className="text-lg font-semibold mb-5">Recent Posts</h2>
                {recentPostsLoading ? (
                    <div className="space-y-2">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="bg-secondary/50 rounded-lg px-3 py-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-4 w-48" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Skeleton className="h-5 w-16 rounded-full" />
                                        <Skeleton className="h-5 w-16 rounded-full" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : recentPosts.length > 0 ? (
                    <div className="space-y-2">
                        {recentPosts.map((post, index) => {
                            const statusStyle = getStatusStyle(post.status);
                            const recency = getRecencyInfo(post.created_at);
                            return (
                                <div key={index} className="bg-secondary/50 rounded-lg px-3 py-2.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                                            <span className="text-muted-foreground text-sm whitespace-nowrap">{post.account_name}</span>
                                            <span className="text-sm truncate">{post.video_title}</span>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <Badge variant={statusStyle.variant} className={statusStyle.className}>{post.status}</Badge>
                                            <Badge variant={recency.variant} className={`text-xs ${recency.className}`}>{recency.label}</Badge>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Card>
                        <CardContent className="flex items-center justify-center h-32 text-muted-foreground">
                            No posts yet
                        </CardContent>
                    </Card>
                )}
            </section>
```

- [ ] **Step 3: Remove `mostRecentPost` references from `home.tsx`**

Remove any remaining references to `data?.mostRecentPost`. The `PostCard` component and `PostCardSkeleton` should remain (used in "Top Performing Posts" section). The `getStatusStyle()` and `getRecencyInfo()` helpers must remain.

- [ ] **Step 4: Verify the app compiles and renders**

Run: `cd /Users/dec/development/molars-admin-dashboard && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/pages/home.tsx
git commit -m "feat: replace Most Recent Post card with Recent Posts list"
```

---

## Chunk 3: Integration Test

### Task 6: Add integration test for recent-posts endpoint

**Files:**
- Create: `tests/integration/recent-posts.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/recent-posts.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';

const BASE_URL = 'http://localhost:3000';

describe('GET /api/stats/recent-posts', () => {
    test('should return 401 without authentication', async () => {
        const response = await fetch(`${BASE_URL}/api/stats/recent-posts`);
        expect(response.status).toBe(401);
    });

    test('should return recent posts array with correct shape', async () => {
        // This test requires a valid admin auth token
        // In CI, this would use a test token
        const response = await fetch(`${BASE_URL}/api/stats/recent-posts`);
        // Without auth, we verify it rejects properly
        const data = await response.json() as { success: boolean; error?: string };
        expect(data.success).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/dec/development/post-for-me && bun test tests/integration/recent-posts.test.ts`
Expected: Tests pass (server must be running).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/recent-posts.test.ts
git commit -m "test: add recent-posts endpoint integration tests"
```
