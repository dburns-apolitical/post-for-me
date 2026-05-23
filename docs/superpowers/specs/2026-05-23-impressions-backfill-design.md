# Manual Impressions Backfill — Design

**Date:** 2026-05-23
**Status:** Approved (pending spec review)

## Problem

The daily `ImpressionsSyncCronService` runs at midnight UTC, calls Upload-Post's `/total-impressions` endpoint with `period=last_day`, and writes one row per account into `daily_impressions` keyed by today's date. If the cron misses a run, or a day's data is bad, there is currently no way to refill a specific date — the existing `POST /api/sync-impressions` only re-runs the same "last 24h, store under today" logic.

The Upload-Post API does support per-day historical fetch via `?date=YYYY-MM-DD` on the same endpoint (see `docs/upload-post-llm-context.txt`, lines 567–578). We want to expose that capability through a new admin endpoint that backfills a date range.

## Goals

- Admin can backfill `daily_impressions` rows for any past date range, idempotently (upsert).
- Endpoint runs synchronously and returns a summary the caller can act on.
- Existing daily cron behavior is unchanged — backfill is purely additive.
- Partial failures (one account, one day) do not block the rest of the backfill.

## Non-goals

- No frontend UI change (this repo is backend-only).
- Cron behavior is not modified — it still uses `period=last_day` and stores under today.
- No async/job-queue infrastructure. The endpoint blocks until the loop completes.
- No per-account scoping in v1 — backfill runs for all accounts in the date range.

## API

### `POST /api/impressions/backfill`

**Auth:** `validateAuth` + `isAdmin` (matches `POST /api/sync-impressions`).

**Request body** (JSON):
```json
{ "startDate": "2025-05-01", "endDate": "2025-05-22" }
```

**Validation** — returns `400` with `{ success: false, error: "<message>" }`:
- `startDate` and `endDate` both required, must match `YYYY-MM-DD`.
- `startDate <= endDate`.
- `endDate <= today` (UTC) — no future dates.
- `(endDate - startDate)` inclusive ≤ **31 days**. Bounds worst-case runtime to keep us under common HTTP timeouts (31 days × ~10 accounts × ~500ms ≈ 2.5 min). Easy to raise later.

**Success response** (`200`, returned once the loop completes — even with per-item failures):
```json
{
  "success": true,
  "daysProcessed": 22,
  "accountsPerDay": 5,
  "updated": 108,
  "failed": 2
}
```

**`500`** is returned only when the loop cannot start at all (e.g. DB unavailable while listing accounts).

## Service changes

### `UploadPostClientService.getTotalImpressions`

Add an optional second argument:

```ts
async getTotalImpressions(
  username: string,
  options?: { date?: string }   // YYYY-MM-DD
): Promise<{ instagram: number; youtube: number; tiktok: number; twitter: number }>
```

- If `options.date` is provided → query string is `?breakdown=true&date=<date>`.
- Otherwise → query string is `?breakdown=true&period=last_day` (current behavior, unchanged).

Existing call sites (the daily cron's `syncImpressions`) are not modified.

### `ImpressionsSyncCronService.backfillImpressions`

New method, sits alongside `syncImpressions`:

```ts
async backfillImpressions(
  startDate: Date,
  endDate: Date,
): Promise<{
  daysProcessed: number;
  accountsPerDay: number;
  updated: number;
  failed: number;
}>
```

Behavior:
- Uses the same `isRunning` guard as `syncImpressions`. If a sync (manual or scheduled) is already in flight, returns `{ daysProcessed: 0, accountsPerDay: 0, updated: 0, failed: 0 }` and logs a warning. Cron and manual backfill cannot stomp on each other.
- Loads accounts once via `db.getAccounts()`. `accountsPerDay` in the return value is `accounts.length` at the moment the backfill started.
- Outer loop iterates each day in `[startDate, endDate]` inclusive, in UTC.
- Inner loop iterates each account:
  - `db.getCredentialsByPlatform(account.id, 'upload_post')` → if missing, count as `failed` and continue.
  - `uploadPost.getTotalImpressions(creds.user, { date: <YYYY-MM-DD> })`.
  - `db.insertDailyImpressions(account.id, date, counts)` — upserts on the existing `UNIQUE(account_id, day)` constraint.
- Per `(date, account)` `try/catch` increments `failed` and logs `{ accountId, date, error }`. The loop always finishes; the method never throws once the loop starts.
- Sequential execution — no `Promise.all`. Cheap insurance against Upload-Post rate limits, and matches the existing cron's pattern.

## Route handler

`src/routes/backfill-impressions.ts` — new file. Mirrors `src/routes/sync-impressions.ts` in shape:

```ts
export async function handleBackfillImpressions(
  request: Request,
  impressionsSyncCron: ImpressionsSyncCronService,
): Promise<Response>
```

Responsibilities:
1. Auth check (`validateAuth` → `unauthorizedResponse` / `forbiddenResponse`).
2. Parse and validate JSON body (see Validation rules above).
3. Convert `startDate` / `endDate` strings → `Date` objects (UTC midnight).
4. Call `impressionsSyncCron.backfillImpressions(...)`.
5. Return `Response.json({ success: true, ...result })`.
6. `500` with `{ success: false, error }` if the call throws before completing.

## Wiring

`src/index.ts`:
- Import `handleBackfillImpressions`.
- Add route:
  ```ts
  if (url.pathname === '/api/impressions/backfill' && request.method === 'POST') {
    return withCors(await handleBackfillImpressions(request, impressionsSyncCron), request);
  }
  ```

## Reference doc

`docs/upload-post-llm-context.txt` is committed alongside this work as the source of truth for the Upload-Post API surface (no current memory entry covers `date` / `start_date` / `end_date` params on `/total-impressions`).

## Testing

Pattern matches existing `tests/unit/impressions-sync-cron.test.ts` and `tests/unit/upload-post-client.test.ts` (Bun test, `mock.module`).

### `tests/unit/upload-post-client.test.ts` — extend
- `getTotalImpressions` builds URL with `?breakdown=true&period=last_day` when no options passed (regression guard for the cron).
- `getTotalImpressions` builds URL with `?breakdown=true&date=2025-05-15` when `{ date: '2025-05-15' }` is passed.
- Existing error/parse tests continue to pass.

### `tests/unit/impressions-sync-cron.test.ts` — extend with `backfillImpressions`
- Happy path: 3-day range × 2 accounts → 6 `getTotalImpressions` calls with the correct per-day date string, 6 `insertDailyImpressions` calls with matching `(accountId, date)`, returns `{ daysProcessed: 3, accountsPerDay: 2, updated: 6, failed: 0 }`.
- Per-item API failure: one account's API call throws on one day → `failed` increments, all other `(date, account)` pairs still processed, method returns normally.
- Missing credentials: one account has no `upload_post` credential → counted as `failed` on every day of the range, others succeed.
- `isRunning` guard: if `syncImpressions` is mid-flight (simulated by setting `isRunning = true`), `backfillImpressions` returns zeros without calling the API or DB.

### `tests/unit/backfill-impressions.test.ts` — new
No route-handler unit tests currently exist in `tests/unit/` (existing pattern tests services directly). This file introduces that pattern for the backfill handler specifically, because the new validation logic — date format, ordering, future-date check, 31-day cap — lives in the route layer and would otherwise be untested. Uses `mock.module` to stub the `ImpressionsSyncCronService` and auth helpers, same toolkit the service tests already use.
- `401` when unauthenticated.
- `403` when authenticated but not admin.
- `400` on missing `startDate` or `endDate`.
- `400` on malformed date string (not `YYYY-MM-DD`).
- `400` when `startDate > endDate`.
- `400` when `endDate` is in the future (UTC).
- `400` when the inclusive range exceeds 31 days.
- `200` on success — body forwarded from `backfillImpressions`.
- `500` when `backfillImpressions` throws before completing the loop (e.g. simulated DB failure).

## Open risks / notes

- **HTTP timeout at the host layer.** 31 days × N accounts is a deliberate cap. If we ever need longer ranges, switch to an async job (request_id + status poll) — out of scope here.
- **Upload-Post rate limits.** Sequential calls keep load gentle. If 429s surface in practice, add backoff in `getTotalImpressions` as a follow-up.
- **Race with the daily cron.** Protected by the shared `isRunning` flag — backfill will refuse to start during a scheduled run and vice versa. Caller sees the all-zeros response and can retry.
