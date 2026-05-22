# Impressions Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily cron that fetches per-platform impression totals from Upload-Post, stores them in a new `daily_impressions` table, exposes them via a new API endpoint, and displays them as a stacked bar chart in `molars-admin-dashboard`.

**Architecture:** Backend (`post-for-me`): new DB table + `DatabaseService` methods, new `getTotalImpressions()` on `UploadPostClientService`, new `ImpressionsSyncCronService`, new `/api/stats/impressions-history` route. Frontend (`molars-admin-dashboard`): new `ImpressionsHistoryData` type, `useImpressionsHistory` hook, `ImpressionsChart` stacked bar component, `home.tsx` reordered with account selector moved to impressions section.

**Tech Stack:** Bun/TypeScript, Neon (serverless Postgres), `@neondatabase/serverless`, Recharts, React, shadcn/ui, Tailwind CSS.

---

## File Map

**`post-for-me`**
- Modify: `src/types/index.ts` — add `DailyImpressionsEntry`, `ImpressionsHistoryResponse`
- Modify: `src/services/database.ts` — add `daily_impressions` table to `initialize()`, add `insertDailyImpressions()`, add `getDailyImpressions()`
- Modify: `src/services/upload-post-client.ts` — add `getTotalImpressions()` method
- Create: `src/services/impressions-sync-cron.ts` — `ImpressionsSyncCronService`
- Create: `src/routes/impressions-history.ts` — `handleImpressionsHistory`
- Create: `src/routes/sync-impressions.ts` — `handleSyncImpressions`
- Modify: `src/index.ts` — import + register routes, instantiate + start/stop cron
- Modify: `tests/unit/upload-post-client.test.ts` — add `getTotalImpressions` tests
- Create: `tests/unit/impressions-sync-cron.test.ts`

**`molars-admin-dashboard`**
- Modify: `src/types/dashboard.ts` — add `DailyImpressionEntry`, `ImpressionsHistoryData`
- Create: `src/hooks/useImpressionsHistory.ts`
- Create: `src/components/ImpressionsChart.tsx`
- Modify: `src/pages/home.tsx` — add impressions section at top, move `AccountFilter`, reorder sections

---

## Task 1: Backend types + DB migration

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/database.ts`

The DB methods (`insertDailyImpressions`, `getDailyImpressions`) are covered by downstream unit tests in Tasks 2–3. This task adds the schema and types; verify by running the full test suite after Task 3.

- [ ] **Step 1: Add types to `src/types/index.ts`**

Append after the existing `ViewsHistoryResponse` interface (currently the last interface in the file):

```typescript
export interface DailyImpressionsEntry {
    day: string;
    instagram: number;
    youtube: number;
    tiktok: number;
    twitter: number;
}

export interface ImpressionsHistoryResponse {
    success: boolean;
    dailyImpressions: DailyImpressionsEntry[];
    last28DaysTotal: number;
    previous28DaysTotal: number;
    deltaPercent: number | null;
}
```

- [ ] **Step 2: Add `daily_impressions` table to `DatabaseService.initialize()`**

In `src/services/database.ts`, after the `daily_views` table block (around line 319 — after the `idx_daily_views_day` index), add:

```typescript
        await this.sql`
            CREATE TABLE IF NOT EXISTS daily_impressions (
                id         SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                day        DATE NOT NULL,
                instagram  INTEGER NOT NULL DEFAULT 0,
                youtube    INTEGER NOT NULL DEFAULT 0,
                tiktok     INTEGER NOT NULL DEFAULT 0,
                twitter    INTEGER NOT NULL DEFAULT 0,
                UNIQUE(account_id, day)
            )
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_daily_impressions_day ON daily_impressions(day)
        `;
```

- [ ] **Step 3: Add `insertDailyImpressions()` to `DatabaseService`**

Append before the closing `}` of the `DatabaseService` class (after `insertDailyViews`, around line 1344):

```typescript
    async insertDailyImpressions(
        accountId: number,
        day: Date,
        counts: { instagram: number; youtube: number; tiktok: number; twitter: number }
    ): Promise<void> {
        await this.sql`
            INSERT INTO daily_impressions (account_id, day, instagram, youtube, tiktok, twitter)
            VALUES (
                ${accountId},
                ${day.toISOString().split('T')[0]},
                ${counts.instagram},
                ${counts.youtube},
                ${counts.tiktok},
                ${counts.twitter}
            )
            ON CONFLICT (account_id, day)
            DO UPDATE SET
                instagram = EXCLUDED.instagram,
                youtube   = EXCLUDED.youtube,
                tiktok    = EXCLUDED.tiktok,
                twitter   = EXCLUDED.twitter
        `;
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/services/database.ts
git commit -m "feat: add daily_impressions table and DatabaseService methods"
```

---

## Task 2: UploadPostClientService.getTotalImpressions()

**Files:**
- Modify: `tests/unit/upload-post-client.test.ts`
- Modify: `src/services/upload-post-client.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe('getTotalImpressions', ...)` block at the end of `tests/unit/upload-post-client.test.ts`, before the closing `});` of the outer `describe`:

```typescript
    describe('getTotalImpressions', () => {
        test('returns per-platform counts from breakdown response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 5000,
                    breakdown: { instagram: 2000, youtube: 1500, tiktok: 1000, twitter: 500 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result).toEqual({ instagram: 2000, youtube: 1500, tiktok: 1000, twitter: 500 });
            const [url, options] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/uploadposts/total-impressions/myprofile');
            expect(url).toContain('breakdown=true');
            expect(url).toContain('period=last_day');
            expect((options.headers as Record<string, string>)['Authorization']).toBe('Apikey test-api-key');
        });

        test('throws when API response is not ok', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 401,
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getTotalImpressions('myprofile')).rejects.toThrow('Failed to fetch total impressions: 401');
        });

        test('throws when breakdown is absent in response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ total_impressions: 5000 }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getTotalImpressions('myprofile')).rejects.toThrow('No breakdown in total-impressions response for user myprofile');
        });

        test('defaults missing platforms to 0', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 2000,
                    breakdown: { instagram: 2000 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result).toEqual({ instagram: 2000, youtube: 0, tiktok: 0, twitter: 0 });
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/upload-post-client.test.ts
```

Expected: 4 new tests FAIL with "getTotalImpressions is not a function" (or similar).

- [ ] **Step 3: Implement `getTotalImpressions` in `src/services/upload-post-client.ts`**

Append after `getPostAnalytics` (before the closing `}`):

```typescript
    /**
     * Fetches per-platform total impressions for the given Upload-Post username
     * for the last 24 hours. Platforms absent from the breakdown default to 0.
     * Throws on API failure or if the breakdown key is missing entirely.
     *
     * Note: the Upload-Post API docs do not show a concrete response example;
     * verify the exact breakdown key names against a live response if values
     * are unexpectedly 0.
     */
    async getTotalImpressions(username: string): Promise<{
        instagram: number;
        youtube: number;
        tiktok: number;
        twitter: number;
    }> {
        const url = `${this.baseUrl}/uploadposts/total-impressions/${encodeURIComponent(username)}?breakdown=true&period=last_day`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Apikey ${this.apiKey}` },
        });

        if (!response.ok) {
            logger.error('Upload-Post total-impressions request failed', {
                status: response.status,
                username,
            });
            throw new Error(`Failed to fetch total impressions: ${response.status}`);
        }

        const data = await response.json() as Record<string, unknown>;
        const breakdown = data.breakdown as Record<string, unknown> | undefined;

        if (!breakdown || typeof breakdown !== 'object') {
            throw new Error(`No breakdown in total-impressions response for user ${username}`);
        }

        return {
            instagram: typeof breakdown.instagram === 'number' ? breakdown.instagram : 0,
            youtube:   typeof breakdown.youtube   === 'number' ? breakdown.youtube   : 0,
            tiktok:    typeof breakdown.tiktok    === 'number' ? breakdown.tiktok    : 0,
            twitter:   typeof breakdown.twitter   === 'number' ? breakdown.twitter   : 0,
        };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/upload-post-client.test.ts
```

Expected: all 10 tests PASS (6 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/services/upload-post-client.ts tests/unit/upload-post-client.test.ts
git commit -m "feat: add getTotalImpressions to UploadPostClientService"
```

---

## Task 3: ImpressionsSyncCronService

**Files:**
- Create: `tests/unit/impressions-sync-cron.test.ts`
- Create: `src/services/impressions-sync-cron.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/impressions-sync-cron.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import type { DbCredential, Platform } from '../../src/types/index';

const mockGetAccounts = mock(
    (): Promise<{ id: number; ig_access_token: string; ig_user_id: string }[]> => Promise.resolve([])
);
const mockGetCredentialsByPlatform = mock(
    (_accountId: number, _platform: Platform): Promise<DbCredential | null> => Promise.resolve(null)
);
const mockInsertDailyImpressions = mock(
    (_accountId: number, _day: Date, _counts: { instagram: number; youtube: number; tiktok: number; twitter: number }): Promise<void> => Promise.resolve()
);

mock.module('../../src/services/database', () => ({
    DatabaseService: class {
        getAccounts = mockGetAccounts;
        getCredentialsByPlatform = mockGetCredentialsByPlatform;
        insertDailyImpressions = mockInsertDailyImpressions;
    },
}));

const mockGetTotalImpressions = mock(
    () => Promise.resolve({ instagram: 0, youtube: 0, tiktok: 0, twitter: 0 })
);

mock.module('../../src/services/upload-post-client', () => ({
    UploadPostClientService: class {
        constructor() {}
        getTotalImpressions = mockGetTotalImpressions;
    },
}));

import { ImpressionsSyncCronService } from '../../src/services/impressions-sync-cron';

describe('ImpressionsSyncCronService', () => {
    let service: ImpressionsSyncCronService;

    beforeEach(() => {
        mockGetAccounts.mockClear();
        mockGetCredentialsByPlatform.mockClear();
        mockInsertDailyImpressions.mockClear();
        mockGetTotalImpressions.mockClear();
        service = new ImpressionsSyncCronService();
    });

    test('returns 0 counts when no accounts exist', async () => {
        mockGetAccounts.mockResolvedValueOnce([]);

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 0, failed: 0 });
        expect(mockInsertDailyImpressions).not.toHaveBeenCalled();
    });

    test('syncs impressions for all accounts with upload_post credentials', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
            { id: 20, ig_access_token: 'token2', ig_user_id: 'user2' },
        ]);
        mockGetCredentialsByPlatform
            .mockResolvedValueOnce({
                id: 1, account_id: 10, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key1', user: 'upuser1', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            })
            .mockResolvedValueOnce({
                id: 2, account_id: 20, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key2', user: 'upuser2', instagram: true, youtube: true, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            });
        mockGetTotalImpressions
            .mockResolvedValueOnce({ instagram: 1000, youtube: 500, tiktok: 0, twitter: 0 })
            .mockResolvedValueOnce({ instagram: 800, youtube: 600, tiktok: 200, twitter: 0 });

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 2, failed: 0 });
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(2);
        expect(mockInsertDailyImpressions.mock.calls[0][0]).toBe(10);
        expect(mockInsertDailyImpressions.mock.calls[0][2]).toEqual({ instagram: 1000, youtube: 500, tiktok: 0, twitter: 0 });
        expect(mockInsertDailyImpressions.mock.calls[1][0]).toBe(20);
        expect(mockInsertDailyImpressions.mock.calls[1][2]).toEqual({ instagram: 800, youtube: 600, tiktok: 200, twitter: 0 });
    });

    test('increments failed and skips when account has no upload_post credentials', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
        ]);
        mockGetCredentialsByPlatform.mockResolvedValueOnce(null);

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 0, failed: 1 });
        expect(mockInsertDailyImpressions).not.toHaveBeenCalled();
    });

    test('increments failed when getTotalImpressions throws, continues remaining accounts', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            { id: 10, ig_access_token: 'token1', ig_user_id: 'user1' },
            { id: 20, ig_access_token: 'token2', ig_user_id: 'user2' },
        ]);
        mockGetCredentialsByPlatform
            .mockResolvedValueOnce({
                id: 1, account_id: 10, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key1', user: 'upuser1', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            })
            .mockResolvedValueOnce({
                id: 2, account_id: 20, platform: 'upload_post' as Platform,
                credentials: { api_key: 'key2', user: 'upuser2', instagram: true, youtube: false, tiktok: false, twitter: false },
                active: true, created_at: new Date(),
            });
        mockGetTotalImpressions
            .mockRejectedValueOnce(new Error('API error'))
            .mockResolvedValueOnce({ instagram: 500, youtube: 0, tiktok: 0, twitter: 0 });

        const result = await service.syncImpressions();

        expect(result).toEqual({ updated: 1, failed: 1 });
        expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(1);
        expect(mockInsertDailyImpressions.mock.calls[0][0]).toBe(20);
    });

    test('second call while first is running returns 0 without re-running', async () => {
        let resolveFirst!: () => void;
        const firstRunning = new Promise<void>((res) => { resolveFirst = res; });

        mockGetAccounts.mockImplementationOnce(() => firstRunning.then(() => []));

        const first = service.syncImpressions();
        const second = service.syncImpressions();
        resolveFirst();

        const [r1, r2] = await Promise.all([first, second]);
        expect(r2).toEqual({ updated: 0, failed: 0 });
        expect(mockGetAccounts).toHaveBeenCalledTimes(1);
    });
});

afterAll(async () => {
    const resolvedPath = require.resolve('../../src/services/upload-post-client');
    delete require.cache[resolvedPath];
    await mock.module('../../src/services/upload-post-client', async () => {
        return import(`../../src/services/upload-post-client?t=${Date.now()}`);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/impressions-sync-cron.test.ts
```

Expected: all 5 tests FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Create `src/services/impressions-sync-cron.ts`**

```typescript
import { DatabaseService } from './database.js';
import { UploadPostClientService } from './upload-post-client.js';
import { logger } from '../utils/logger.js';
import type { UploadPostCredentials } from '../types/index.js';

export class ImpressionsSyncCronService {
    private timer: Timer | null = null;
    private db: DatabaseService;
    private isRunning: boolean = false;

    private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
    }

    start(): void {
        if (this.timer) {
            logger.warn('Impressions sync cron job already running');
            return;
        }

        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        setTimeout(() => {
            this.runAndScheduleNext();
        }, msUntilMidnight);

        logger.info('Impressions sync cron job started', {
            nextRunAt: nextMidnight.toISOString(),
            msUntilFirstRun: msUntilMidnight,
        });
    }

    private runAndScheduleNext(): void {
        this.syncImpressions().finally(() => {
            this.timer = setTimeout(() => {
                this.runAndScheduleNext();
            }, ImpressionsSyncCronService.INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Impressions sync cron job stopped');
        }
    }

    async syncImpressions(): Promise<{ updated: number; failed: number }> {
        if (this.isRunning) {
            logger.warn('Impressions sync already in progress, skipping');
            return { updated: 0, failed: 0 };
        }

        this.isRunning = true;
        logger.info('Starting impressions sync...');

        let updated = 0;
        let failed = 0;

        try {
            const accounts = await this.db.getAccounts();

            if (accounts.length === 0) {
                logger.info('No accounts to sync impressions for');
                return { updated: 0, failed: 0 };
            }

            logger.info('Syncing impressions for accounts', { count: accounts.length });

            const today = new Date();

            for (const account of accounts) {
                try {
                    const credential = await this.db.getCredentialsByPlatform(account.id, 'upload_post');
                    if (!credential) {
                        logger.warn('No upload_post credentials for account, skipping', { accountId: account.id });
                        failed++;
                        continue;
                    }

                    const creds = credential.credentials as UploadPostCredentials;
                    const uploadPost = new UploadPostClientService(creds.api_key, creds.user);
                    const counts = await uploadPost.getTotalImpressions(creds.user);
                    await this.db.insertDailyImpressions(account.id, today, counts);

                    logger.info('Recorded daily impressions', { accountId: account.id, ...counts });
                    updated++;
                } catch (error) {
                    logger.error('Failed to sync impressions for account', {
                        accountId: account.id,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                    failed++;
                }
            }

            logger.info('Impressions sync completed', { updated, failed, total: accounts.length });
        } catch (error) {
            logger.error('Impressions sync failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return { updated, failed };
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/impressions-sync-cron.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
bun test tests/unit
```

Expected: all existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/impressions-sync-cron.ts tests/unit/impressions-sync-cron.test.ts
git commit -m "feat: add ImpressionsSyncCronService"
```

---

## Task 4: impressions-history route

**Files:**
- Create: `src/routes/impressions-history.ts`

No unit tests — the route delegates all logic to `neon` (same as `views-history.ts`). Verify manually after wiring in Task 5.

- [ ] **Step 1: Create `src/routes/impressions-history.ts`**

```typescript
import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { DailyImpressionsEntry } from '../types/index.js';

export async function handleImpressionsHistory(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized impressions history request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin impressions history request', { userId: authResult.userId });
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

        type Row = { day: string; instagram: string; youtube: string; tiktok: string; twitter: string };

        const rows: Row[] = accountId !== null
            ? await sql`
                SELECT day::text, instagram, youtube, tiktok, twitter
                FROM daily_impressions
                WHERE account_id = ${accountId}
                  AND day >= CURRENT_DATE - INTERVAL '56 days'
                ORDER BY day ASC
              ` as Row[]
            : await sql`
                SELECT
                    day::text,
                    SUM(instagram)::integer AS instagram,
                    SUM(youtube)::integer   AS youtube,
                    SUM(tiktok)::integer    AS tiktok,
                    SUM(twitter)::integer   AS twitter
                FROM daily_impressions
                WHERE day >= CURRENT_DATE - INTERVAL '56 days'
                GROUP BY day
                ORDER BY day ASC
              ` as Row[];

        const dailyImpressions: DailyImpressionsEntry[] = rows.map(row => ({
            day:       row.day,
            instagram: parseInt(row.instagram, 10) || 0,
            youtube:   parseInt(row.youtube,   10) || 0,
            tiktok:    parseInt(row.tiktok,    10) || 0,
            twitter:   parseInt(row.twitter,   10) || 0,
        }));

        const now = new Date();
        const twentyEightDaysAgo = new Date(now);
        twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
        const cutoff = twentyEightDaysAgo.toISOString().split('T')[0];

        let last28DaysTotal = 0;
        let previous28DaysTotal = 0;

        for (const entry of dailyImpressions) {
            const dayTotal = entry.instagram + entry.youtube + entry.tiktok + entry.twitter;
            if (entry.day >= cutoff) {
                last28DaysTotal += dayTotal;
            } else {
                previous28DaysTotal += dayTotal;
            }
        }

        const deltaPercent = previous28DaysTotal > 0
            ? Math.round(((last28DaysTotal - previous28DaysTotal) / previous28DaysTotal) * 100 * 100) / 100
            : null;

        return Response.json({
            success: true,
            dailyImpressions,
            last28DaysTotal,
            previous28DaysTotal,
            deltaPercent,
        });
    } catch (error) {
        logger.error('Error fetching impressions history', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to fetch impressions history' },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/impressions-history.ts
git commit -m "feat: add impressions-history route"
```

---

## Task 5: sync-impressions route + index.ts wiring

**Files:**
- Create: `src/routes/sync-impressions.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create `src/routes/sync-impressions.ts`**

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { ImpressionsSyncCronService } from '../services/impressions-sync-cron.js';

export async function handleSyncImpressions(
    request: Request,
    impressionsSyncCron: ImpressionsSyncCronService
): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized sync-impressions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin sync-impressions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Manual impressions sync triggered', { method: authResult.method });

    try {
        const result = await impressionsSyncCron.syncImpressions();
        return Response.json({ success: true, ...result });
    } catch (error) {
        logger.error('Manual impressions sync failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to sync impressions' },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 2: Update `src/index.ts` — imports**

Add these imports alongside the existing similar imports:

```typescript
import { handleImpressionsHistory } from './routes/impressions-history.js';
import { handleSyncImpressions } from './routes/sync-impressions.js';
import { ImpressionsSyncCronService } from './services/impressions-sync-cron.js';
```

- [ ] **Step 3: Update `src/index.ts` — instantiate cron**

After line 26 (`const viewsSyncCron = new ViewsSyncCronService();`), add:

```typescript
const impressionsSyncCron = new ImpressionsSyncCronService();
```

- [ ] **Step 4: Update `src/index.ts` — register routes**

After line 226 (the `views-history` route block), add:

```typescript
      // Impressions history endpoint (requires authentication)
      if (url.pathname === '/api/stats/impressions-history' && request.method === 'GET') {
        return withCors(await handleImpressionsHistory(request), request);
      }
```

After line 263 (the `sync-views` route block), add:

```typescript
      if (url.pathname === '/api/sync-impressions' && request.method === 'POST') {
        return withCors(await handleSyncImpressions(request, impressionsSyncCron), request);
      }
```

- [ ] **Step 5: Update `src/index.ts` — start/stop cron**

In `initialize()`, after `viewsSyncCron.start();` (line 105), add:

```typescript
  // Start the impressions sync cron job
  impressionsSyncCron.start();
```

In `shutdown()`, after `viewsSyncCron.stop();` (line 120), add:

```typescript
  // Stop the impressions sync cron job
  impressionsSyncCron.stop();
```

- [ ] **Step 6: Type-check and build**

```bash
bun run --bun tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 7: Run full test suite**

```bash
bun test tests/unit
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/sync-impressions.ts src/index.ts
git commit -m "feat: wire impressions cron and routes in index.ts"
```

---

## Task 6: Frontend types

**Files:**
- Modify: `/Users/dec/Documents/Development/molars-admin-dashboard/src/types/dashboard.ts`

All following tasks are in the `molars-admin-dashboard` repo.

- [ ] **Step 1: Add types to `src/types/dashboard.ts`**

Append after the existing `ViewsHistoryData` interface (the last interface in the file):

```typescript
export interface DailyImpressionEntry {
  day: string;
  instagram: number;
  youtube: number;
  tiktok: number;
  twitter: number;
}

export interface ImpressionsHistoryData {
  dailyImpressions: DailyImpressionEntry[];
  last28DaysTotal: number;
  previous28DaysTotal: number;
  deltaPercent: number | null;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/dec/Documents/Development/molars-admin-dashboard
git add src/types/dashboard.ts
git commit -m "feat: add ImpressionsHistoryData types"
```

---

## Task 7: useImpressionsHistory hook

**Files:**
- Create: `src/hooks/useImpressionsHistory.ts`

- [ ] **Step 1: Create `src/hooks/useImpressionsHistory.ts`**

```typescript
import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { authClient } from '@/lib/auth';
import type { ImpressionsHistoryData } from '@/types/dashboard';

interface UseImpressionsHistoryResult {
  data: ImpressionsHistoryData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useImpressionsHistory(accountId: number | null = null): UseImpressionsHistoryResult {
  const [data, setData] = useState<ImpressionsHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchImpressionsHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const session = await authClient.getSession();

      if (!session?.data?.session?.token) {
        throw new Error('Not authenticated');
      }

      const url = accountId
        ? `${API_BASE_URL}/api/stats/impressions-history?accountId=${accountId}`
        : `${API_BASE_URL}/api/stats/impressions-history`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${session.data.session.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch impressions history: ${response.statusText}`);
      }

      const result = await response.json() as ImpressionsHistoryData & { success: boolean };
      setData({
        dailyImpressions: result.dailyImpressions,
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
    fetchImpressionsHistory();
  }, [fetchImpressionsHistory]);

  return { data, isLoading, error, refetch: fetchImpressionsHistory };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useImpressionsHistory.ts
git commit -m "feat: add useImpressionsHistory hook"
```

---

## Task 8: ImpressionsChart component

**Files:**
- Create: `src/components/ImpressionsChart.tsx`

- [ ] **Step 1: Create `src/components/ImpressionsChart.tsx`**

```typescript
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeltaIndicator } from '@/components/DeltaIndicator';
import type { ImpressionsHistoryData } from '@/types/dashboard';

function formatNumber(num: number): string {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
}

function formatTooltipDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const PLATFORM_COLORS = {
    instagram: 'hsl(292, 84%, 61%)',
    youtube:   'hsl(0, 84%, 60%)',
    tiktok:    'hsl(180, 84%, 40%)',
    twitter:   'hsl(203, 89%, 53%)',
} as const;

interface ImpressionsChartProps {
    data: ImpressionsHistoryData | null;
    isLoading: boolean;
}

function fillDateGaps(
    dailyImpressions: { day: string; instagram: number; youtube: number; tiktok: number; twitter: number }[]
): { day: string; instagram: number; youtube: number; tiktok: number; twitter: number }[] {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 27);

    const dataByDay = new Map(dailyImpressions.map(d => [d.day, d]));
    const filled: { day: string; instagram: number; youtube: number; tiktok: number; twitter: number }[] = [];

    for (let i = 0; i < 28; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dayStr = date.toISOString().split('T')[0];
        const existing = dataByDay.get(dayStr);
        filled.push({
            day:       dayStr,
            instagram: existing?.instagram ?? 0,
            youtube:   existing?.youtube   ?? 0,
            tiktok:    existing?.tiktok    ?? 0,
            twitter:   existing?.twitter   ?? 0,
        });
    }

    return filled;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const total = (payload as { value: number }[]).reduce((sum, p) => sum + p.value, 0);
    return (
        <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
            <p className="font-medium">{formatTooltipDate(label as string)}</p>
            <p className="text-muted-foreground">{formatNumber(total)} total</p>
            {(payload as { name: string; value: number; color: string }[]).map(p =>
                p.value > 0 ? (
                    <p key={p.name} style={{ color: p.color }}>
                        {p.name}: {formatNumber(p.value)}
                    </p>
                ) : null
            )}
        </div>
    );
}

export function ImpressionsChart({ data, isLoading }: ImpressionsChartProps) {
    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardDescription>Impressions Over Last 28 Days</CardDescription>
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

    if (!data || data.dailyImpressions.length === 0) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardDescription>Impressions Over Last 28 Days</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                        Impressions data will appear after the first sync
                    </div>
                </CardContent>
            </Card>
        );
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const chartData = fillDateGaps(
        data.dailyImpressions.filter(d => d.day >= cutoffStr)
    );

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardDescription>Impressions Over Last 28 Days</CardDescription>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <XAxis dataKey="day" hide />
                        <YAxis
                            tickFormatter={(v: number) => formatNumber(v)}
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="instagram" stackId="a" fill={PLATFORM_COLORS.instagram} name="Instagram" />
                        <Bar dataKey="youtube"   stackId="a" fill={PLATFORM_COLORS.youtube}   name="YouTube" />
                        <Bar dataKey="tiktok"    stackId="a" fill={PLATFORM_COLORS.tiktok}    name="TikTok" />
                        <Bar dataKey="twitter"   stackId="a" fill={PLATFORM_COLORS.twitter}   name="Twitter" radius={[2, 2, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>

                <div className="flex justify-between items-start mt-4 pt-4 border-t">
                    <div>
                        <p className="text-sm text-muted-foreground">Previous 28 days</p>
                        <p className="text-2xl font-bold tracking-tight">
                            {formatNumber(data.previous28DaysTotal)}
                        </p>
                        <span className="text-sm invisible">placeholder</span>
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

```bash
cd /Users/dec/Documents/Development/molars-admin-dashboard
bun run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ImpressionsChart.tsx
git commit -m "feat: add ImpressionsChart stacked bar component"
```

---

## Task 9: home.tsx reorder + AccountFilter move

**Files:**
- Modify: `src/pages/home.tsx`

Move `AccountFilter` from the Leaderboards section to a new Impressions Overview section at the top. New section order: Impressions Overview → Views Overview → Leaderboards → (rest unchanged).

- [ ] **Step 1: Add imports to `src/pages/home.tsx`**

Find the existing import block and add:

```typescript
import { ImpressionsChart } from '@/components/ImpressionsChart';
import { useImpressionsHistory } from '@/hooks/useImpressionsHistory';
```

- [ ] **Step 2: Add impressions hook call in the `Home` component**

Find:
```typescript
    const { data: viewsHistoryData, isLoading: viewsHistoryLoading } = useViewsHistory(accountId);
```

Add immediately after it:
```typescript
    const { data: impressionsHistoryData, isLoading: impressionsHistoryLoading } = useImpressionsHistory(accountId);
```

- [ ] **Step 3: Replace the opening `<div>` content in the return statement**

Find the current JSX return (the opening `<div className="space-y-10 md:space-y-12">` and everything through the closing `</div>`). Replace just the first two sections (Leaderboards and Views Overview) and insert the new Impressions section at the top.

The new section order at the top of the return should be:

```tsx
        <div className="space-y-10 md:space-y-12">
            {/* Impressions Overview */}
            <section>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-semibold">Impressions Overview</h2>
                    <AccountFilter />
                </div>
                <ImpressionsChart
                    data={impressionsHistoryData}
                    isLoading={impressionsHistoryLoading}
                />
            </section>

            {/* Views Overview */}
            <section>
                <h2 className="text-lg font-semibold mb-5">Views Overview</h2>
                <ViewsChart
                    data={viewsHistoryData}
                    isLoading={viewsHistoryLoading}
                    allTimeViews={data?.viewsMetrics.allTime}
                />
            </section>

            {/* Leaderboards */}
            <section>
                <h2 className="text-lg font-semibold mb-5">Leaderboards</h2>
                <div className="grid gap-4 md:grid-cols-2">
                    <LeaderboardCard
                        title="Posts by User"
                        items={data?.userLeaderboard ?? []}
                        valueKey="posts"
                        isLoading={isLoading}
                    />
                    <LeaderboardCard
                        title="Views per Video"
                        items={data?.userViewsPerVideo ?? []}
                        valueKey="viewsPerVideo"
                        isLoading={isLoading}
                    />
                </div>
            </section>
```

This replaces the existing Leaderboards section (which had `AccountFilter`) and the Views Overview section. All sections after Leaderboards (Recent Posts, Latest Evaluation, etc.) remain unchanged.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
bun run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/home.tsx
git commit -m "feat: add impressions chart to home, reorder sections, move account filter"
```
