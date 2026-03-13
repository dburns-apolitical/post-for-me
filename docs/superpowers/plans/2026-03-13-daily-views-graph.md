# Daily Views Graph Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily views graph to the dashboard showing views over the last 28 days, with data captured during the existing views sync cron.

**Architecture:** New `daily_views` table written to during the views sync cron. New API endpoint serves the data. Frontend uses Recharts to render an area chart with period-over-period comparison stats.

**Tech Stack:** TypeScript, Bun, PostgreSQL (Neon serverless), React 19, Recharts, Tailwind CSS, Radix UI

**Spec:** `docs/superpowers/specs/2026-03-13-daily-views-graph-design.md`

---

## Chunk 1: Backend — Database, Types, and Cron Integration

### Task 1: Add types for daily views

**Files:**
- Modify: `src/types/index.ts:225` (append after `AgentEvaluation` interface)

- [ ] **Step 1: Add the new types**

Append to the end of `src/types/index.ts`:

```typescript
export interface DailyViewsEntry {
    day: string;
    views: number;
}

export interface ViewsHistoryResponse {
    success: boolean;
    dailyViews: DailyViewsEntry[];
    last28DaysTotal: number;
    previous28DaysTotal: number;
    deltaPercent: number | null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/dec/development/post-for-me && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add DailyViewsEntry and ViewsHistoryResponse types"
```

---

### Task 2: Add daily_views table and insertDailyViews method

**Files:**
- Modify: `src/services/database.ts:302` (add table creation before the `logger.info` line)
- Modify: `src/services/database.ts:1194` (add new method at end of class)
- Test: `tests/unit/database.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/unit/database.test.ts`:

```typescript
describe('insertDailyViews', () => {
    test('should insert daily views record', async () => {
        mockSql.mockResolvedValueOnce([]);

        await db.insertDailyViews(1, new Date('2026-03-13'), 500, 3);

        expect(mockSql).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dec/development/post-for-me && bun test tests/unit/database.test.ts`
Expected: FAIL — `db.insertDailyViews is not a function`

- [ ] **Step 3: Add daily_views table to initializeSchema**

In `src/services/database.ts`, insert after the `agent_evaluations` CREATE TABLE block (after line 302) and before `logger.info('Database schema initialized')` (line 304):

```typescript
        await this.sql`
            CREATE TABLE IF NOT EXISTS daily_views (
                id SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                day DATE NOT NULL,
                views INTEGER NOT NULL,
                post_count INTEGER NOT NULL,
                UNIQUE(account_id, day)
            )
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_daily_views_day ON daily_views(day)
        `;
```

- [ ] **Step 4: Add insertDailyViews method**

Add before the closing `}` of the `DatabaseService` class (before line 1194):

```typescript
    /**
     * Insert or update daily views aggregate for an account
     * Uses ON CONFLICT to handle re-triggers on the same day (additive)
     */
    async insertDailyViews(accountId: number, day: Date, views: number, postCount: number): Promise<void> {
        await this.sql`
            INSERT INTO daily_views (account_id, day, views, post_count)
            VALUES (${accountId}, ${day.toISOString().split('T')[0]}, ${views}, ${postCount})
            ON CONFLICT (account_id, day)
            DO UPDATE SET
                views = daily_views.views + EXCLUDED.views,
                post_count = daily_views.post_count + EXCLUDED.post_count
        `;
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/dec/development/post-for-me && bun test tests/unit/database.test.ts`
Expected: All PASS

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/dec/development/post-for-me && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/services/database.ts tests/unit/database.test.ts
git commit -m "feat: add daily_views table and insertDailyViews method"
```

---

### Task 3: Integrate daily views recording into views sync cron

**Files:**
- Modify: `src/services/views-sync-cron.ts`

- [ ] **Step 1: Modify syncViews to accumulate per-account views**

Replace the `syncViews` method in `src/services/views-sync-cron.ts` with:

```typescript
    async syncViews(): Promise<{ updated: number; failed: number }> {
        if (this.isRunning) {
            logger.warn('Views sync already in progress, skipping');
            return { updated: 0, failed: 0 };
        }

        this.isRunning = true;
        logger.info('Starting views sync...');

        let updated = 0;
        let failed = 0;

        try {
            const posts = await this.db.getPostsNeedingViewsUpdate();

            if (posts.length === 0) {
                logger.info('No posts need views update');
                return { updated: 0, failed: 0 };
            }

            logger.info('Found posts needing views update', { count: posts.length });

            // Load all accounts for credential lookup
            const accounts = await this.db.getAccounts();
            const accountMap = new Map(accounts.map(a => [a.id, a]));

            // Track per-account views for daily_views table
            const accountViewTotals = new Map<number, { views: number; postCount: number }>();

            for (const post of posts) {
                try {
                    if (!post.instagram_post_id) {
                        logger.warn('Post missing instagram_post_id, skipping', { postId: post.id });
                        failed++;
                        continue;
                    }

                    const account = accountMap.get(post.account_id);
                    if (!account) {
                        logger.warn('Account not found for post, skipping', { postId: post.id, accountId: post.account_id });
                        failed++;
                        continue;
                    }

                    const instagram = new InstagramClientService(account.ig_access_token, account.ig_user_id);
                    const views = await instagram.getMediaInsights(post.instagram_post_id);
                    await this.db.updatePostViews(post.id, views);

                    // Accumulate for daily_views
                    const existing = accountViewTotals.get(post.account_id) || { views: 0, postCount: 0 };
                    existing.views += views;
                    existing.postCount += 1;
                    accountViewTotals.set(post.account_id, existing);

                    logger.info('Updated views for post', {
                        postId: post.id,
                        instagramPostId: post.instagram_post_id,
                        views,
                    });

                    updated++;
                } catch (error) {
                    logger.error('Failed to update views for post', {
                        postId: post.id,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                    failed++;
                }
            }

            // Write daily views aggregates
            const today = new Date();
            for (const [accountId, totals] of accountViewTotals) {
                try {
                    await this.db.insertDailyViews(accountId, today, totals.views, totals.postCount);
                    logger.info('Recorded daily views', { accountId, views: totals.views, postCount: totals.postCount });
                } catch (error) {
                    logger.error('Failed to record daily views', {
                        accountId,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
            }

            logger.info('Views sync completed', { updated, failed, total: posts.length });
        } catch (error) {
            logger.error('Views sync failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return { updated, failed };
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/dec/development/post-for-me && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/views-sync-cron.ts
git commit -m "feat: record daily views aggregates during views sync"
```

---

### Task 4: Create views-history API endpoint

**Files:**
- Create: `src/routes/views-history.ts`
- Modify: `src/index.ts:6` (add import) and `src/index.ts:217` (add route)

- [ ] **Step 1: Create the route handler**

Create `src/routes/views-history.ts`:

```typescript
import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { DailyViewsEntry } from '../types/index.js';

export async function handleViewsHistory(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized views history request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin views history request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');
        let accountId: number | null = null;

        if (accountIdParam !== null) {
            accountId = parseInt(accountIdParam, 10);
            if (isNaN(accountId) || accountId < 1) {
                return Response.json(
                    { success: false, error: 'accountId must be a positive integer' },
                    { status: 400 }
                );
            }
        }

        const config = getConfig();
        const sql = neon(config.databaseUrl);

        const rows = accountId !== null
            ? await sql`
                SELECT day::text, views
                FROM daily_views
                WHERE account_id = ${accountId}
                  AND day >= CURRENT_DATE - INTERVAL '56 days'
                ORDER BY day ASC
            ` as { day: string; views: string }[]
            : await sql`
                SELECT day::text, SUM(views)::integer as views
                FROM daily_views
                WHERE day >= CURRENT_DATE - INTERVAL '56 days'
                GROUP BY day
                ORDER BY day ASC
            ` as { day: string; views: string }[];

        const dailyViews: DailyViewsEntry[] = rows.map(row => ({
            day: row.day,
            views: parseInt(row.views, 10) || 0,
        }));

        const now = new Date();
        const twentyEightDaysAgo = new Date(now);
        twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
        const cutoff = twentyEightDaysAgo.toISOString().split('T')[0];

        let last28DaysTotal = 0;
        let previous28DaysTotal = 0;

        for (const entry of dailyViews) {
            if (entry.day >= cutoff) {
                last28DaysTotal += entry.views;
            } else {
                previous28DaysTotal += entry.views;
            }
        }

        let deltaPercent: number | null = null;
        if (previous28DaysTotal > 0) {
            deltaPercent = Math.round(((last28DaysTotal - previous28DaysTotal) / previous28DaysTotal) * 100 * 100) / 100;
        }

        return Response.json({
            success: true,
            dailyViews,
            last28DaysTotal,
            previous28DaysTotal,
            deltaPercent,
        });
    } catch (error) {
        logger.error('Error fetching views history', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch views history',
            },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 2: Register the route in index.ts**

Add the import at the top of `src/index.ts` (after the `handleStats` import on line 6):

```typescript
import { handleViewsHistory } from './routes/views-history.js';
```

Add the route handler after the `/api/stats` route (after line 218):

```typescript
      // Views history endpoint (requires authentication)
      if (url.pathname === '/api/stats/views-history' && request.method === 'GET') {
        return withCors(await handleViewsHistory(request), request);
      }
```

**Important:** This must be placed BEFORE any regex-based route matching to avoid conflicts. Place it right after the `/api/stats` handler.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/dec/development/post-for-me && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/views-history.ts src/index.ts
git commit -m "feat: add views-history API endpoint"
```

---

### Task 4b: Add tests for views sync cron daily views integration

**Files:**
- Create: `tests/unit/views-sync-cron.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/views-sync-cron.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock dependencies before importing
const mockGetPostsNeedingViewsUpdate = mock(() => Promise.resolve([]));
const mockGetAccounts = mock(() => Promise.resolve([]));
const mockUpdatePostViews = mock(() => Promise.resolve());
const mockInsertDailyViews = mock(() => Promise.resolve());

mock.module('../../src/services/database', () => ({
    DatabaseService: class {
        getPostsNeedingViewsUpdate = mockGetPostsNeedingViewsUpdate;
        getAccounts = mockGetAccounts;
        updatePostViews = mockUpdatePostViews;
        insertDailyViews = mockInsertDailyViews;
    },
}));

const mockGetMediaInsights = mock(() => Promise.resolve(100));

mock.module('../../src/services/instagram-client', () => ({
    InstagramClientService: class {
        constructor() {}
        getMediaInsights = mockGetMediaInsights;
    },
}));

import { ViewsSyncCronService } from '../../src/services/views-sync-cron';

describe('ViewsSyncCronService', () => {
    let service: ViewsSyncCronService;

    beforeEach(() => {
        mockGetPostsNeedingViewsUpdate.mockClear();
        mockGetAccounts.mockClear();
        mockUpdatePostViews.mockClear();
        mockInsertDailyViews.mockClear();
        mockGetMediaInsights.mockClear();
        service = new ViewsSyncCronService();
    });

    test('should not write daily views when no posts need update', async () => {
        mockGetPostsNeedingViewsUpdate.mockResolvedValueOnce([]);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 0, failed: 0 });
        expect(mockInsertDailyViews).not.toHaveBeenCalled();
    });

    test('should write daily views after syncing posts', async () => {
        mockGetPostsNeedingViewsUpdate.mockResolvedValueOnce([
            { id: 1, account_id: 10, instagram_post_id: 'ig_1' },
            { id: 2, account_id: 10, instagram_post_id: 'ig_2' },
            { id: 3, account_id: 20, instagram_post_id: 'ig_3' },
        ]);
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
            { id: 20, ig_access_token: 'token2', ig_user_id: 'user2' },
        ]);
        mockGetMediaInsights
            .mockResolvedValueOnce(200)
            .mockResolvedValueOnce(300)
            .mockResolvedValueOnce(150);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 3, failed: 0 });
        expect(mockInsertDailyViews).toHaveBeenCalledTimes(2);

        // Account 10: 200 + 300 = 500 views, 2 posts
        const call1Args = mockInsertDailyViews.mock.calls[0];
        expect(call1Args[0]).toBe(10);
        expect(call1Args[2]).toBe(500);
        expect(call1Args[3]).toBe(2);

        // Account 20: 150 views, 1 post
        const call2Args = mockInsertDailyViews.mock.calls[1];
        expect(call2Args[0]).toBe(20);
        expect(call2Args[2]).toBe(150);
        expect(call2Args[3]).toBe(1);
    });

    test('should still write daily views for successful posts when some fail', async () => {
        mockGetPostsNeedingViewsUpdate.mockResolvedValueOnce([
            { id: 1, account_id: 10, instagram_post_id: 'ig_1' },
            { id: 2, account_id: 10, instagram_post_id: null },
        ]);
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
        ]);
        mockGetMediaInsights.mockResolvedValueOnce(200);

        const result = await service.syncViews();

        expect(result).toEqual({ updated: 1, failed: 1 });
        expect(mockInsertDailyViews).toHaveBeenCalledTimes(1);
        expect(mockInsertDailyViews.mock.calls[0][2]).toBe(200);
        expect(mockInsertDailyViews.mock.calls[0][3]).toBe(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/dec/development/post-for-me && bun test tests/unit/views-sync-cron.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/views-sync-cron.test.ts
git commit -m "test: add views sync cron daily views integration tests"
```

---

## Chunk 2: Frontend — Chart Component and Dashboard Integration

### Task 5: Add recharts dependency

**Files:**
- Modify: `/Users/dec/development/molars-admin-dashboard/package.json`

- [ ] **Step 1: Install recharts**

Run: `cd /Users/dec/development/molars-admin-dashboard && npm install recharts`

- [ ] **Step 2: Verify install succeeded**

Run: `cd /Users/dec/development/molars-admin-dashboard && npm ls recharts`
Expected: Shows recharts version

- [ ] **Step 3: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add package.json package-lock.json
git commit -m "deps: add recharts for views chart"
```

---

### Task 6: Add frontend types for views history

**Files:**
- Modify: `/Users/dec/development/molars-admin-dashboard/src/types/dashboard.ts:87` (append at end)

- [ ] **Step 1: Add the types**

Append to the end of `src/types/dashboard.ts`:

```typescript

export interface DailyViewsEntry {
  day: string;
  views: number;
}

export interface ViewsHistoryData {
  dailyViews: DailyViewsEntry[];
  last28DaysTotal: number;
  previous28DaysTotal: number;
  deltaPercent: number | null;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/types/dashboard.ts
git commit -m "feat: add ViewsHistoryData types"
```

---

### Task 7: Create useViewsHistory hook

**Files:**
- Create: `/Users/dec/development/molars-admin-dashboard/src/hooks/useViewsHistory.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useViewsHistory.ts` following the exact pattern of `src/hooks/useStats.ts`:

```typescript
import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { authClient } from '@/lib/auth';
import type { ViewsHistoryData } from '@/types/dashboard';

interface UseViewsHistoryResult {
  data: ViewsHistoryData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useViewsHistory(accountId: number | null = null): UseViewsHistoryResult {
  const [data, setData] = useState<ViewsHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchViewsHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const session = await authClient.getSession();

      if (!session?.data?.session?.token) {
        throw new Error('Not authenticated');
      }

      const url = accountId
        ? `${API_BASE_URL}/api/stats/views-history?accountId=${accountId}`
        : `${API_BASE_URL}/api/stats/views-history`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${session.data.session.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch views history: ${response.statusText}`);
      }

      const result = await response.json() as ViewsHistoryData & { success: boolean };
      setData({
        dailyViews: result.dailyViews,
        last28DaysTotal: result.last28DaysTotal,
        previous28DaysTotal: result.previous28DaysTotal,
        deltaPercent: result.deltaPercent,
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchViewsHistory();
  }, [fetchViewsHistory]);

  return { data, isLoading, error, refetch: fetchViewsHistory };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/hooks/useViewsHistory.ts
git commit -m "feat: add useViewsHistory hook"
```

---

### Task 8: Extract DeltaIndicator to shared component

**Files:**
- Create: `/Users/dec/development/molars-admin-dashboard/src/components/DeltaIndicator.tsx`
- Modify: `/Users/dec/development/molars-admin-dashboard/src/pages/home.tsx:86-95`

- [ ] **Step 1: Create the shared component**

Create `src/components/DeltaIndicator.tsx`:

```typescript
export function DeltaIndicator({ delta }: { delta: number | null }) {
    if (delta === null) return <span className="text-muted-foreground text-sm">N/A</span>;

    const isPositive = delta >= 0;
    return (
        <span className={`text-sm font-medium ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
        </span>
    );
}
```

- [ ] **Step 2: Update home.tsx to use the shared component**

In `src/pages/home.tsx`:

1. Add import at top (after line 25): `import { DeltaIndicator } from '@/components/DeltaIndicator';`
2. Remove the local `DeltaIndicator` function (lines 86-95)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/components/DeltaIndicator.tsx src/pages/home.tsx
git commit -m "refactor: extract DeltaIndicator to shared component"
```

---

### Task 9: Create ViewsChart component

**Files:**
- Create: `/Users/dec/development/molars-admin-dashboard/src/components/ViewsChart.tsx`

- [ ] **Step 1: Create the chart component**

Create `src/components/ViewsChart.tsx`:

```typescript
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeltaIndicator } from '@/components/DeltaIndicator';
import type { ViewsHistoryData } from '@/types/dashboard';

function formatNumber(num: number): string {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
}

function formatChartDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTooltipDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ViewsChartProps {
    data: ViewsHistoryData | null;
    isLoading: boolean;
}

function fillDateGaps(dailyViews: { day: string; views: number }[]): { day: string; views: number }[] {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 27);

    const viewsByDay = new Map(dailyViews.map(d => [d.day, d.views]));
    const filled: { day: string; views: number }[] = [];

    for (let i = 0; i < 28; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dayStr = date.toISOString().split('T')[0];
        filled.push({ day: dayStr, views: viewsByDay.get(dayStr) ?? 0 });
    }

    return filled;
}

function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
            <p className="font-medium">{formatTooltipDate(label)}</p>
            <p className="text-muted-foreground">{formatNumber(payload[0].value)} views</p>
        </div>
    );
}

export function ViewsChart({ data, isLoading }: ViewsChartProps) {
    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardDescription>Views Over Last 28 Days</CardDescription>
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-[250px] w-full" />
                    <div className="flex justify-between mt-4">
                        <Skeleton className="h-10 w-32" />
                        <Skeleton className="h-10 w-32" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!data || data.dailyViews.length === 0) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardDescription>Views Over Last 28 Days</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                        Views data will appear after the first sync
                    </div>
                </CardContent>
            </Card>
        );
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const chartData = fillDateGaps(
        data.dailyViews.filter(d => d.day >= cutoffStr)
    );

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardDescription>Views Over Last 28 Days</CardDescription>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis
                            dataKey="day"
                            tickFormatter={formatChartDate}
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tickFormatter={(v: number) => formatNumber(v)}
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="views"
                            stroke="hsl(217, 91%, 60%)"
                            strokeWidth={2}
                            fill="url(#viewsFill)"
                        />
                    </AreaChart>
                </ResponsiveContainer>

                <div className="flex justify-between items-end mt-4 pt-4 border-t">
                    <div>
                        <p className="text-sm text-muted-foreground">Previous 28 days</p>
                        <p className="text-2xl font-bold tracking-tight">
                            {formatNumber(data.previous28DaysTotal)}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm text-muted-foreground">Last 28 days</p>
                        <p className="text-2xl font-bold tracking-tight">
                            {formatNumber(data.last28DaysTotal)}
                        </p>
                        <DeltaIndicator delta={data.deltaPercent} />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/components/ViewsChart.tsx
git commit -m "feat: add ViewsChart component with Recharts area chart"
```

---

### Task 10: Integrate ViewsChart into the home page

**Files:**
- Modify: `/Users/dec/development/molars-admin-dashboard/src/pages/home.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `src/pages/home.tsx`:

```typescript
import { ViewsChart } from '@/components/ViewsChart';
import { useViewsHistory } from '@/hooks/useViewsHistory';
```

- [ ] **Step 2: Add the hook call**

Inside the `Home` function, find where `useStats` is called (something like `const { data, isLoading, error, refetch } = useStats(accountId);`). Add after it:

```typescript
const { data: viewsHistoryData, isLoading: viewsHistoryLoading } = useViewsHistory(accountId);
```

- [ ] **Step 3: Replace the Views Overview section**

Find the Views Overview section in `home.tsx` (the `{/* Metrics Section */}` comment, lines 371-420). Replace it with:

```tsx
            {/* Views Overview */}
            <section>
                <h2 className="text-lg font-semibold mb-5">Views Overview</h2>
                <div className="grid gap-4 md:grid-cols-3">
                    {isLoading ? (
                        <MetricsCardSkeleton />
                    ) : (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardDescription>All Time Views</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold tracking-tight">
                                    {formatNumber(data?.viewsMetrics.allTime ?? 0)}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    <div className="md:col-span-2">
                        <ViewsChart data={viewsHistoryData} isLoading={viewsHistoryLoading} />
                    </div>
                </div>
            </section>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Visual verification**

Run: `cd /Users/dec/development/molars-admin-dashboard && npm run dev`

Open in browser and verify:
- All Time Views card renders on the left
- Views chart card renders on the right (spanning 2 columns)
- Chart shows empty state message if no data
- Account filter changes update the chart

- [ ] **Step 6: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/pages/home.tsx
git commit -m "feat: replace views overview cards with views chart"
```
