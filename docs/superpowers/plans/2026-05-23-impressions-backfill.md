# Impressions Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only endpoint that backfills `daily_impressions` rows for a past date range by calling Upload-Post's `?date=YYYY-MM-DD` query per day, per account.

**Architecture:** Extend `UploadPostClientService.getTotalImpressions` to accept an optional `date`. Add `backfillImpressions(startDate, endDate)` to `ImpressionsSyncCronService` — same `isRunning` guard as the existing cron, sequential `(date, account)` loop, per-item try/catch. New route handler `handleBackfillImpressions` validates the body and delegates. The existing daily cron is untouched.

**Tech Stack:** Bun runtime, TypeScript, Neon Postgres (`@neondatabase/serverless`), Bun's built-in test runner with `mock.module`.

**Important per-user convention:** Do NOT run `git commit`. The user uses Graphite and runs `gt c` themselves after changes are made. "Commit" steps in this plan stop at `git add ...` and stage the files; the user takes it from there.

**Reference spec:** `docs/superpowers/specs/2026-05-23-impressions-backfill-design.md`
**Upload-Post API reference:** `docs/upload-post-llm-context.txt` (lines 545–612 cover the `/total-impressions` endpoint, including `date`, `start_date`, `end_date`, and `period`).

---

## Task 1: Add optional `date` parameter to `UploadPostClientService.getTotalImpressions`

**Files:**
- Modify: `src/services/upload-post-client.ts:198-231`
- Modify: `tests/unit/upload-post-client.test.ts:115-170`

- [ ] **Step 1.1: Add the failing test for the new `date` option**

Add inside the existing `describe('getTotalImpressions', ...)` block in `tests/unit/upload-post-client.test.ts`, immediately after the `defaults missing platforms to 0` test:

```ts
test('uses ?date=YYYY-MM-DD when options.date is provided (instead of period=last_day)', async () => {
    globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
            total_impressions: 3000,
            breakdown: { instagram: 1500, youtube: 1000, tiktok: 400, twitter: 100 },
        }),
    })) as typeof fetch;

    const client = new UploadPostClientService('test-api-key', 'test-user');
    const result = await client.getTotalImpressions('myprofile', { date: '2025-05-15' });

    expect(result).toEqual({ instagram: 1500, youtube: 1000, tiktok: 400, twitter: 100 });
    const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/uploadposts/total-impressions/myprofile');
    expect(url).toContain('breakdown=true');
    expect(url).toContain('date=2025-05-15');
    expect(url).not.toContain('period=last_day');
});
```

- [ ] **Step 1.2: Run the new test and confirm it fails**

Run: `bun test tests/unit/upload-post-client.test.ts -t "uses ?date="`

Expected: FAIL — the URL will contain `period=last_day`, not `date=2025-05-15` (the method currently ignores extra args).

- [ ] **Step 1.3: Update `getTotalImpressions` to accept the optional `date`**

Replace the current method body in `src/services/upload-post-client.ts` (lines 198–231) with:

```ts
async getTotalImpressions(
    username: string,
    options?: { date?: string }
): Promise<{
    instagram: number;
    youtube: number;
    tiktok: number;
    twitter: number;
}> {
    const params = new URLSearchParams({ breakdown: 'true' });
    if (options?.date) {
        params.set('date', options.date);
    } else {
        params.set('period', 'last_day');
    }
    const url = `${this.baseUrl}/uploadposts/total-impressions/${encodeURIComponent(username)}?${params.toString()}`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Apikey ${this.apiKey}` },
    });

    if (!response.ok) {
        logger.error('Upload-Post total-impressions request failed', {
            status: response.status,
            username,
            date: options?.date,
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

Also update the JSDoc immediately above the method (currently at lines 189–197) to reflect the new option:

```ts
/**
 * Fetches per-platform total impressions for the given Upload-Post username.
 * - With no options (or `options.date` omitted): rolling last 24 hours (`period=last_day`).
 *   This is what the daily cron uses.
 * - With `options.date` (YYYY-MM-DD): impressions for that specific past day, used by the
 *   manual backfill endpoint.
 *
 * Platforms absent from the breakdown default to 0. Throws on API failure or if the
 * breakdown key is missing entirely.
 */
```

- [ ] **Step 1.4: Run the full `upload-post-client` test suite and confirm everything passes**

Run: `bun test tests/unit/upload-post-client.test.ts`

Expected: PASS for all tests, including the existing `period=last_day` regression test (line 116) and the new `?date=` test.

- [ ] **Step 1.5: Stage the changes (do not commit)**

```bash
git add src/services/upload-post-client.ts tests/unit/upload-post-client.test.ts
```

Stop here. Do not run `git commit`.

---

## Task 2: Add `backfillImpressions` to `ImpressionsSyncCronService`

**Files:**
- Modify: `src/services/impressions-sync-cron.ts` (add a new method; do not touch `syncImpressions`, `start`, `stop`)
- Modify: `tests/unit/impressions-sync-cron.test.ts` (extend existing suite)

- [ ] **Step 2.1: Add the happy-path test**

Append to `tests/unit/impressions-sync-cron.test.ts`, inside the `describe('ImpressionsSyncCronService', ...)` block (just before the closing brace at line 138):

```ts
test('backfillImpressions iterates each day × account and inserts with the requested date', async () => {
    mockGetAccounts.mockResolvedValueOnce([
        { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
        { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
    ]);
    mockGetCredentialsByPlatform.mockResolvedValue({
        id: 1, account_id: 0, platform: 'upload_post' as Platform,
        credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
        active: true, created_at: new Date(),
    });
    mockGetTotalImpressions.mockResolvedValue({ instagram: 100, youtube: 0, tiktok: 0, twitter: 0 });

    const start = new Date(Date.UTC(2025, 4, 1));  // 2025-05-01
    const end   = new Date(Date.UTC(2025, 4, 3));  // 2025-05-03

    const result = await service.backfillImpressions(start, end);

    expect(result).toEqual({ daysProcessed: 3, accountsPerDay: 2, updated: 6, failed: 0 });
    expect(mockGetTotalImpressions).toHaveBeenCalledTimes(6);
    expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(6);

    // First call: 2025-05-01, account 10
    const firstInsert = mockInsertDailyImpressions.mock.calls[0];
    expect(firstInsert[0]).toBe(10);
    expect((firstInsert[1] as Date).toISOString().split('T')[0]).toBe('2025-05-01');

    // Last call: 2025-05-03, account 20
    const lastInsert = mockInsertDailyImpressions.mock.calls[5];
    expect(lastInsert[0]).toBe(20);
    expect((lastInsert[1] as Date).toISOString().split('T')[0]).toBe('2025-05-03');
});
```

- [ ] **Step 2.2: Run the new test and confirm it fails**

Run: `bun test tests/unit/impressions-sync-cron.test.ts -t "iterates each day"`

Expected: FAIL — `service.backfillImpressions is not a function`.

- [ ] **Step 2.3: Implement the minimal happy-path version**

Add the method inside the class in `src/services/impressions-sync-cron.ts`, immediately after `syncImpressions` (after the closing brace of `syncImpressions` at line 113):

```ts
/**
 * Backfills daily_impressions rows for each day in [startDate, endDate] inclusive,
 * for every account that has upload_post credentials. Called from the manual
 * backfill admin endpoint; the daily cron uses syncImpressions instead.
 *
 * Shares the `isRunning` guard with syncImpressions so the cron and a manual
 * backfill can't run concurrently.
 *
 * Per-(date, account) errors are caught and counted as `failed`; the loop always
 * completes once it has started.
 */
async backfillImpressions(
    startDate: Date,
    endDate: Date,
): Promise<{ daysProcessed: number; accountsPerDay: number; updated: number; failed: number }> {
    if (this.isRunning) {
        logger.warn('Impressions sync already in progress, skipping backfill');
        return { daysProcessed: 0, accountsPerDay: 0, updated: 0, failed: 0 };
    }

    this.isRunning = true;
    logger.info('Starting impressions backfill', {
        startDate: startDate.toISOString().split('T')[0],
        endDate:   endDate.toISOString().split('T')[0],
    });

    let updated = 0;
    let failed = 0;
    let daysProcessed = 0;
    let accountsPerDay = 0;

    try {
        const accounts = await this.db.getAccounts();
        accountsPerDay = accounts.length;

        if (accounts.length === 0) {
            logger.info('No accounts to backfill impressions for');
            return { daysProcessed: 0, accountsPerDay: 0, updated: 0, failed: 0 };
        }

        // Iterate each UTC day from start to end inclusive.
        const cursor = new Date(Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            startDate.getUTCDate(),
        ));
        const endUtc = new Date(Date.UTC(
            endDate.getUTCFullYear(),
            endDate.getUTCMonth(),
            endDate.getUTCDate(),
        ));

        while (cursor.getTime() <= endUtc.getTime()) {
            const dateStr = cursor.toISOString().split('T')[0];

            for (const account of accounts) {
                try {
                    const credential = await this.db.getCredentialsByPlatform(account.id, 'upload_post');
                    if (!credential) {
                        logger.warn('No upload_post credentials for account during backfill, skipping', {
                            accountId: account.id, date: dateStr,
                        });
                        failed++;
                        continue;
                    }

                    const creds = credential.credentials as UploadPostCredentials;
                    const uploadPost = new UploadPostClientService(creds.api_key, creds.user);
                    const counts = await uploadPost.getTotalImpressions(creds.user, { date: dateStr });
                    await this.db.insertDailyImpressions(account.id, new Date(cursor.getTime()), counts);

                    logger.info('Backfilled daily impressions', { accountId: account.id, date: dateStr, ...counts });
                    updated++;
                } catch (error) {
                    logger.error('Failed to backfill impressions for (account, date)', {
                        accountId: account.id,
                        date: dateStr,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                    failed++;
                }
            }

            daysProcessed++;
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        logger.info('Impressions backfill completed', { daysProcessed, accountsPerDay, updated, failed });
    } catch (error) {
        logger.error('Impressions backfill failed before loop completed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
    } finally {
        this.isRunning = false;
    }

    return { daysProcessed, accountsPerDay, updated, failed };
}
```

- [ ] **Step 2.4: Run the happy-path test and confirm it passes**

Run: `bun test tests/unit/impressions-sync-cron.test.ts -t "iterates each day"`

Expected: PASS.

- [ ] **Step 2.5: Add the per-item error test**

Append inside the same `describe` block:

```ts
test('backfillImpressions counts a failure when getTotalImpressions throws for one (date, account) pair', async () => {
    mockGetAccounts.mockResolvedValueOnce([
        { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
        { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
    ]);
    mockGetCredentialsByPlatform.mockResolvedValue({
        id: 1, account_id: 0, platform: 'upload_post' as Platform,
        credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
        active: true, created_at: new Date(),
    });
    // 2 days × 2 accounts = 4 calls. Make the 2nd call (day 1, account 20) throw.
    mockGetTotalImpressions
        .mockResolvedValueOnce({ instagram: 100, youtube: 0, tiktok: 0, twitter: 0 })
        .mockRejectedValueOnce(new Error('upstream 500'))
        .mockResolvedValueOnce({ instagram: 200, youtube: 0, tiktok: 0, twitter: 0 })
        .mockResolvedValueOnce({ instagram: 300, youtube: 0, tiktok: 0, twitter: 0 });

    const start = new Date(Date.UTC(2025, 4, 1));
    const end   = new Date(Date.UTC(2025, 4, 2));

    const result = await service.backfillImpressions(start, end);

    expect(result).toEqual({ daysProcessed: 2, accountsPerDay: 2, updated: 3, failed: 1 });
    expect(mockGetTotalImpressions).toHaveBeenCalledTimes(4);
    expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2.6: Run the new test and confirm it passes**

The current implementation already handles this (per-item try/catch). Run: `bun test tests/unit/impressions-sync-cron.test.ts -t "counts a failure when getTotalImpressions throws"`

Expected: PASS.

If it fails, the loop is bubbling errors instead of catching them per item — fix the try/catch in `backfillImpressions`.

- [ ] **Step 2.7: Add the missing-credentials test**

Append:

```ts
test('backfillImpressions counts every day as failed for an account with no upload_post credentials', async () => {
    mockGetAccounts.mockResolvedValueOnce([
        { id: 10, ig_access_token: 't1', ig_user_id: 'u1' },
        { id: 20, ig_access_token: 't2', ig_user_id: 'u2' },
    ]);
    // Account 10 has no upload_post credentials; account 20 does.
    mockGetCredentialsByPlatform.mockImplementation(async (accountId: number) => {
        if (accountId === 10) return null;
        return {
            id: 1, account_id: 20, platform: 'upload_post' as Platform,
            credentials: { api_key: 'key', user: 'upuser', instagram: true, youtube: false, tiktok: false, twitter: false },
            active: true, created_at: new Date(),
        };
    });
    mockGetTotalImpressions.mockResolvedValue({ instagram: 50, youtube: 0, tiktok: 0, twitter: 0 });

    const start = new Date(Date.UTC(2025, 4, 1));
    const end   = new Date(Date.UTC(2025, 4, 3));  // 3 days

    const result = await service.backfillImpressions(start, end);

    // 3 days × 1 missing-cred account = 3 failed; 3 days × 1 valid account = 3 updated.
    expect(result).toEqual({ daysProcessed: 3, accountsPerDay: 2, updated: 3, failed: 3 });
    expect(mockGetTotalImpressions).toHaveBeenCalledTimes(3);
    expect(mockInsertDailyImpressions).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2.8: Run and confirm it passes**

Run: `bun test tests/unit/impressions-sync-cron.test.ts -t "counts every day as failed"`

Expected: PASS.

- [ ] **Step 2.9: Add the `isRunning` guard test**

Append:

```ts
test('backfillImpressions returns zeros when a sync is already in progress', async () => {
    // Simulate a sync mid-flight by holding syncImpressions open.
    let resolveSync!: () => void;
    const syncRunning = new Promise<void>((res) => { resolveSync = res; });
    mockGetAccounts.mockImplementationOnce(() => syncRunning.then(() => []));

    const sync = service.syncImpressions();
    // At this point isRunning is true (syncImpressions has started but not finished).
    const start = new Date(Date.UTC(2025, 4, 1));
    const end   = new Date(Date.UTC(2025, 4, 3));
    const backfillResult = await service.backfillImpressions(start, end);

    expect(backfillResult).toEqual({ daysProcessed: 0, accountsPerDay: 0, updated: 0, failed: 0 });
    // Backfill must not call the API or DB while sync is running.
    expect(mockGetTotalImpressions).not.toHaveBeenCalled();
    expect(mockInsertDailyImpressions).not.toHaveBeenCalled();

    resolveSync();
    await sync;
});
```

- [ ] **Step 2.10: Run and confirm it passes**

Run: `bun test tests/unit/impressions-sync-cron.test.ts -t "returns zeros when a sync"`

Expected: PASS.

- [ ] **Step 2.11: Run the full file and confirm all existing tests still pass**

Run: `bun test tests/unit/impressions-sync-cron.test.ts`

Expected: PASS for every test (existing 5 + new 4).

- [ ] **Step 2.12: Stage the changes (do not commit)**

```bash
git add src/services/impressions-sync-cron.ts tests/unit/impressions-sync-cron.test.ts
```

Stop here. Do not run `git commit`.

---

## Task 3: Create the `handleBackfillImpressions` route handler

**Files:**
- Create: `src/routes/backfill-impressions.ts`
- Create: `tests/unit/backfill-impressions.test.ts`

This task introduces the first route-handler unit test in this repo. Pattern matches the service tests: stub the service via `mock.module`, stub auth, then invoke the handler with synthetic `Request` objects.

- [ ] **Step 3.1: Create the failing test file with auth and validation tests**

Create `tests/unit/backfill-impressions.test.ts`:

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockValidateAuth = mock(() => Promise.resolve({ authenticated: true, isAdmin: true, method: 'password' as const }));

mock.module('../../src/utils/auth', () => ({
    validateAuth: mockValidateAuth,
    unauthorizedResponse: (msg: string) => Response.json({ success: false, error: 'Unauthorized', message: msg }, { status: 401 }),
    forbiddenResponse:    (msg: string) => Response.json({ success: false, error: 'Forbidden',    message: msg }, { status: 403 }),
}));

const mockBackfillImpressions = mock(
    (_start: Date, _end: Date) => Promise.resolve({ daysProcessed: 1, accountsPerDay: 1, updated: 1, failed: 0 })
);

const mockService = { backfillImpressions: mockBackfillImpressions } as unknown as import('../../src/services/impressions-sync-cron').ImpressionsSyncCronService;

import { handleBackfillImpressions } from '../../src/routes/backfill-impressions';

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/impressions/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Password': 'pw' },
        body: JSON.stringify(body),
    });
}

describe('handleBackfillImpressions', () => {
    beforeEach(() => {
        mockValidateAuth.mockClear();
        mockBackfillImpressions.mockClear();
        mockValidateAuth.mockResolvedValue({ authenticated: true, isAdmin: true, method: 'password' as const });
    });

    test('returns 401 when unauthenticated', async () => {
        mockValidateAuth.mockResolvedValueOnce({ authenticated: false, isAdmin: false, error: 'bad pw' });
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(401);
        expect(mockBackfillImpressions).not.toHaveBeenCalled();
    });

    test('returns 403 when authenticated but not admin', async () => {
        mockValidateAuth.mockResolvedValueOnce({ authenticated: true, isAdmin: false, method: 'bearer' as const, userId: 'u1' });
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(403);
        expect(mockBackfillImpressions).not.toHaveBeenCalled();
    });

    test('returns 400 when startDate is missing', async () => {
        const res = await handleBackfillImpressions(postReq({ endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when endDate is missing', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when startDate is not YYYY-MM-DD', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '05/01/2025', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when startDate > endDate', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-10', endDate: '2025-05-01' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when endDate is in the future', async () => {
        // Build a date string for tomorrow UTC.
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: tomorrow }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 400 when range exceeds 31 days inclusive', async () => {
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-04-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(400);
    });

    test('returns 200 and forwards the service result on success', async () => {
        mockBackfillImpressions.mockResolvedValueOnce({ daysProcessed: 2, accountsPerDay: 3, updated: 5, failed: 1 });
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, daysProcessed: 2, accountsPerDay: 3, updated: 5, failed: 1 });
        expect(mockBackfillImpressions).toHaveBeenCalledTimes(1);
        const [start, end] = mockBackfillImpressions.mock.calls[0];
        expect((start as Date).toISOString().split('T')[0]).toBe('2025-05-01');
        expect((end   as Date).toISOString().split('T')[0]).toBe('2025-05-02');
    });

    test('returns 500 when the service throws', async () => {
        mockBackfillImpressions.mockRejectedValueOnce(new Error('db down'));
        const res = await handleBackfillImpressions(postReq({ startDate: '2025-05-01', endDate: '2025-05-02' }), mockService);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('db down');
    });
});
```

- [ ] **Step 3.2: Run the test file and confirm it fails on the import**

Run: `bun test tests/unit/backfill-impressions.test.ts`

Expected: FAIL — `Cannot find module '../../src/routes/backfill-impressions'`.

- [ ] **Step 3.3: Create the handler**

Create `src/routes/backfill-impressions.ts`:

```ts
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { ImpressionsSyncCronService } from '../services/impressions-sync-cron.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface BackfillBody {
    startDate?: unknown;
    endDate?: unknown;
}

function badRequest(error: string): Response {
    return Response.json({ success: false, error }, { status: 400 });
}

/**
 * Parse a YYYY-MM-DD string into a UTC-midnight Date. Returns null on parse failure
 * or if the parsed components don't round-trip (e.g. 2025-02-30 → 2025-03-02).
 */
function parseUtcDate(input: string): Date | null {
    if (!DATE_RE.test(input)) return null;
    const [y, m, d] = input.split('-').map(n => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        return null;
    }
    return dt;
}

export async function handleBackfillImpressions(
    request: Request,
    impressionsSyncCron: ImpressionsSyncCronService,
): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized backfill-impressions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin backfill-impressions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    let body: BackfillBody;
    try {
        body = await request.json() as BackfillBody;
    } catch {
        return badRequest('Body must be valid JSON');
    }

    if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
        return badRequest('startDate and endDate are required strings in YYYY-MM-DD format');
    }

    const start = parseUtcDate(body.startDate);
    const end   = parseUtcDate(body.endDate);
    if (!start || !end) {
        return badRequest('startDate and endDate must be valid dates in YYYY-MM-DD format');
    }

    if (start.getTime() > end.getTime()) {
        return badRequest('startDate must be on or before endDate');
    }

    const todayUtc = new Date();
    const todayMidnight = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
    if (end.getTime() > todayMidnight) {
        return badRequest('endDate must not be in the future (UTC)');
    }

    const rangeDaysInclusive = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    if (rangeDaysInclusive > MAX_RANGE_DAYS) {
        return badRequest(`Date range must not exceed ${MAX_RANGE_DAYS} days (got ${rangeDaysInclusive})`);
    }

    logger.info('Manual impressions backfill triggered', {
        method: authResult.method,
        startDate: body.startDate,
        endDate: body.endDate,
        rangeDaysInclusive,
    });

    try {
        const result = await impressionsSyncCron.backfillImpressions(start, end);
        return Response.json({ success: true, ...result });
    } catch (error) {
        logger.error('Manual impressions backfill failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to backfill impressions' },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 3.4: Run the route handler tests and confirm they pass**

Run: `bun test tests/unit/backfill-impressions.test.ts`

Expected: PASS for all 11 tests.

- [ ] **Step 3.5: Stage the changes (do not commit)**

```bash
git add src/routes/backfill-impressions.ts tests/unit/backfill-impressions.test.ts
```

Stop here. Do not run `git commit`.

---

## Task 4: Wire the new route in `src/index.ts`

**Files:**
- Modify: `src/index.ts:9` (new import) and `src/index.ts:281-284` (new route block)

- [ ] **Step 4.1: Add the import**

In `src/index.ts`, add this line right after the existing `handleSyncImpressions` import (line 9):

```ts
import { handleBackfillImpressions } from './routes/backfill-impressions.js';
```

- [ ] **Step 4.2: Add the route block**

In `src/index.ts`, immediately after the existing `Manual impressions sync endpoint` block (currently lines 281–284), add:

```ts
      // Manual impressions backfill endpoint (requires admin authentication)
      if (url.pathname === '/api/impressions/backfill' && request.method === 'POST') {
        return withCors(await handleBackfillImpressions(request, impressionsSyncCron), request);
      }
```

- [ ] **Step 4.3: Run the full test suite and confirm nothing broke**

Run: `bun test`

Expected: PASS for all tests. (No new tests in this task — wiring is exercised manually in Step 4.4.)

- [ ] **Step 4.4: Smoke test against a running dev server**

Start the dev server in a separate terminal (`bun run dev` or however this repo runs locally — see `package.json` scripts). Then:

```bash
curl -X POST http://localhost:3000/api/impressions/backfill \
  -H 'Content-Type: application/json' \
  -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" \
  -d '{"startDate":"2025-05-20","endDate":"2025-05-22"}'
```

Expected: HTTP 200 with `{ success: true, daysProcessed: 3, accountsPerDay: <N>, updated: <N*3>, failed: <0 or small> }`.

Also verify these error paths return 400:

```bash
# Missing endDate
curl -i -X POST http://localhost:3000/api/impressions/backfill \
  -H 'Content-Type: application/json' \
  -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" \
  -d '{"startDate":"2025-05-20"}'

# Range too large
curl -i -X POST http://localhost:3000/api/impressions/backfill \
  -H 'Content-Type: application/json' \
  -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" \
  -d '{"startDate":"2025-01-01","endDate":"2025-05-01"}'
```

If you cannot run a dev server in this environment, skip Step 4.4 and report it — the route is fully covered by Task 3's unit tests, so the manual smoke is a confidence check, not a hard gate.

- [ ] **Step 4.5: Stage the changes (do not commit)**

```bash
git add src/index.ts
```

Stop here. Do not run `git commit`.

---

## Task 5: Stage the Upload-Post API reference doc

The user asked for `docs/upload-post-llm-context.txt` to land in this PR alongside the feature changes. The file should already exist in the worktree (it was copied in during brainstorming); this task just stages it.

**Files:**
- Stage: `docs/upload-post-llm-context.txt`

- [ ] **Step 5.1: Verify the file exists**

Run: `ls -lh docs/upload-post-llm-context.txt`

Expected: file present (~277 KB, ~6880 lines).

If missing, copy it from the user's main checkout:
```bash
cp /Users/dec/development/post-for-me/docs/upload-post-llm-context.txt docs/upload-post-llm-context.txt
```

- [ ] **Step 5.2: Stage it**

```bash
git add docs/upload-post-llm-context.txt
```

Stop here. Do not run `git commit`.

---

## Task 6: Hand off to the user

- [ ] **Step 6.1: Confirm everything is staged**

Run: `git status`

Expected staged files:
- `docs/superpowers/specs/2026-05-23-impressions-backfill-design.md`
- `docs/superpowers/plans/2026-05-23-impressions-backfill.md`
- `docs/upload-post-llm-context.txt`
- `src/services/upload-post-client.ts`
- `src/services/impressions-sync-cron.ts`
- `src/routes/backfill-impressions.ts`
- `src/index.ts`
- `tests/unit/upload-post-client.test.ts`
- `tests/unit/impressions-sync-cron.test.ts`
- `tests/unit/backfill-impressions.test.ts`

- [ ] **Step 6.2: Final test run**

Run: `bun test`

Expected: ALL PASS.

- [ ] **Step 6.3: Hand off**

Report to the user:
- Tests passing.
- Files staged but not committed (per user's no-commit rule).
- User can now run `gt c` to create a Graphite branch on top of the current stack with these changes.

Suggested commit message for `gt c`:
```
feat: add manual impressions backfill endpoint

POST /api/impressions/backfill (admin-only) takes a {startDate, endDate}
range (max 31 days) and refills daily_impressions by calling Upload-Post
with ?date=YYYY-MM-DD per day, per account. Extends getTotalImpressions
with an optional date param; daily cron behavior is unchanged. Also
commits the Upload-Post API reference doc for future work.
```
