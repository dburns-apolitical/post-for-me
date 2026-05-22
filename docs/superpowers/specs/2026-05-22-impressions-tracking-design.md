# Impressions Tracking: Daily Cron + Dashboard Chart

**Date:** 2026-05-22

## Background

Upload-Post exposes a `total-impressions` endpoint that returns per-platform impression counts for the last 24 hours. We want to collect this data daily per account, store it in a new DB table, and display it as a stacked bar chart in `molars-admin-dashboard` — similar to the existing Views Overview. We also want to reorder the dashboard homepage so Impressions comes first.

## Goals

- A daily cron (`ImpressionsSyncCronService`) fetches total impressions per account from Upload-Post and stores per-platform breakdown in `daily_impressions`.
- A new API endpoint `GET /api/stats/impressions-history` serves 28-day windowed data with totals and delta.
- A new `ImpressionsChart` component in `molars-admin-dashboard` shows a stacked bar chart (per-platform breakdown, last 28 days), total count, and delta vs the previous 28-day window.
- `home.tsx` is reordered: Impressions Overview (with account selector) → Views Overview → Leaderboards.

## Out of Scope

- Backfilling historical impressions data.
- Removing existing views tracking or the `daily_views` table.
- Storing per-post impressions (this tracks account-level daily totals only).

## Design

### 1. DB — `daily_impressions` table

Added to `DatabaseService.initialize()` alongside existing `CREATE TABLE IF NOT EXISTS` migrations:

```sql
CREATE TABLE IF NOT EXISTS daily_impressions (
    id         SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    day        DATE NOT NULL,
    instagram  INTEGER NOT NULL DEFAULT 0,
    youtube    INTEGER NOT NULL DEFAULT 0,
    tiktok     INTEGER NOT NULL DEFAULT 0,
    twitter    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(account_id, day)
);

CREATE INDEX IF NOT EXISTS idx_daily_impressions_day ON daily_impressions(day);
```

New DB methods:

**`insertDailyImpressions(accountId, day, counts)`** — upsert that overwrites (not accumulates) on conflict, since the cron fetches fresh totals each run:

```sql
INSERT INTO daily_impressions (account_id, day, instagram, youtube, tiktok, twitter)
VALUES ($accountId, $day, $instagram, $youtube, $tiktok, $twitter)
ON CONFLICT (account_id, day)
DO UPDATE SET
    instagram = EXCLUDED.instagram,
    youtube   = EXCLUDED.youtube,
    tiktok    = EXCLUDED.tiktok,
    twitter   = EXCLUDED.twitter
```

**`getDailyImpressions(accountId: number | null)`** — fetches last 56 days. When `accountId` is null, sums across all accounts grouped by day (same pattern as `getDailyViews`).

### 2. `UploadPostClientService` — add `getTotalImpressions(username)`

New method:

```ts
async getTotalImpressions(username: string): Promise<{
    instagram: number;
    youtube: number;
    tiktok: number;
    twitter: number;
}>
```

Calls:
```
GET https://api.upload-post.com/api/uploadposts/total-impressions/{username}?breakdown=true&period=last_day
Authorization: Apikey <this.apiKey>
```

Extracts per-platform counts from the breakdown response. The exact field names should be verified against a live response during implementation; expected shape is something like:
```json
{
  "breakdown": {
    "instagram": 2000,
    "youtube": 1500,
    "tiktok": 1000,
    "twitter": 500
  }
}
```

Missing platforms default to `0` rather than throwing — an account may not have all platforms active. Throws on API error (non-ok response) or if the `breakdown` key is absent entirely.

### 3. `ImpressionsSyncCronService`

New service at `src/services/impressions-sync-cron.ts`. Mirrors `ViewsSyncCronService` structure:

- `start()` / `stop()` / `INTERVAL_MS = 24h` — same timer-based scheduling pattern, fires at UTC midnight
- `isRunning` concurrency guard
- `syncImpressions()` public method (for testing and manual triggers via `sync-impressions.ts` route)

Loop:

```
for each account:
  creds = db.getCredentialsByPlatform(account.id, 'upload_post')
  if !creds → log warning, increment failed, continue
  counts = uploadPost.getTotalImpressions(creds.user)  // uses creds.user as username
  db.insertDailyImpressions(account.id, today, counts)
  increment updated
```

Returns `{ updated: number; failed: number }`.

### 4. `src/routes/sync-impressions.ts`

Minimal admin-only POST endpoint to trigger `syncImpressions()` manually (same pattern as `sync-views.ts`):

```
POST /api/stats/sync-impressions
```

### 5. `src/routes/impressions-history.ts`

New route, mirrors `views-history.ts`:

```
GET /api/stats/impressions-history?accountId=<n>
```

Auth: Bearer token, admin only.

Queries `daily_impressions` for last 56 days. Computes:
- `last28DaysTotal` — sum of all four platforms across days ≥ cutoff
- `previous28DaysTotal` — sum across days < cutoff
- `deltaPercent` — `((last - prev) / prev) * 100`, `null` if `prev === 0`

Response:

```ts
{
  success: true,
  dailyImpressions: { day: string; instagram: number; youtube: number; tiktok: number; twitter: number }[];
  last28DaysTotal: number;
  previous28DaysTotal: number;
  deltaPercent: number | null;
}
```

### 6. `src/index.ts`

- Import and instantiate `ImpressionsSyncCronService`
- Register `impressions-history` route at `GET /api/stats/impressions-history`
- Register `sync-impressions` route at `POST /api/stats/sync-impressions`
- Start/stop cron in `initialize()` / `shutdown()`

---

## Frontend (`molars-admin-dashboard`)

### 7. `src/types/dashboard.ts` — new types

```ts
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

### 8. `src/hooks/useImpressionsHistory.ts`

Mirrors `useViewsHistory.ts`. Calls `GET /api/stats/impressions-history?accountId=N`. Returns `{ data: ImpressionsHistoryData | null; isLoading: boolean; error: Error | null; refetch: () => void }`.

### 9. `src/components/ImpressionsChart.tsx`

Recharts `BarChart` with stacked bars. One `Bar` per platform, each a distinct color:

| Platform  | Color (HSL)                        |
|-----------|-------------------------------------|
| Instagram | `hsl(292, 84%, 61%)` — purple-pink  |
| YouTube   | `hsl(0, 84%, 60%)` — red            |
| TikTok    | `hsl(180, 84%, 40%)` — teal         |
| Twitter   | `hsl(203, 89%, 53%)` — blue         |

Props: `{ data: ImpressionsHistoryData | null; isLoading: boolean }`.

Uses a `fillDateGaps` helper (same logic as `ViewsChart`) to fill missing days with zeros for all four platforms.

Tooltip shows date, total impressions, and per-platform breakdown.

Below the chart: "Previous 28 days" / "Last 28 days" totals + `DeltaIndicator` — identical layout to `ViewsChart`.

Loading state: `<Skeleton>` placeholders matching the chart dimensions.

Empty state: "Impressions data will appear after the first sync."

### 10. `src/pages/home.tsx` — section reorder + account selector move

New section order:
1. **Impressions Overview** — `AccountFilter` here (moved from Leaderboards), `useImpressionsHistory(accountId)`, `<ImpressionsChart>`
2. **Views Overview** — `useViewsHistory(accountId)`, `<ViewsChart>`
3. **Leaderboards** — `AccountFilter` removed from here; section heading only
4. All remaining sections unchanged (Recent Posts, Latest Evaluation, etc.)

`AccountFilter` drives `accountId` for impressions, views, stats (leaderboards, rankings, etc.) as before — it was already wired via `useAccountFilter()`. Moving it to the top of the page does not change its data scope.

---

## Data Flow

```
ImpressionsSyncCronService (daily, UTC midnight)
  → db.getAccounts()
  → for each account:
      db.getCredentialsByPlatform(account.id, 'upload_post')
      UploadPostClientService.getTotalImpressions(creds.user)
          → GET /api/uploadposts/total-impressions/{user}?breakdown=true&period=last_day
          → returns { instagram, youtube, tiktok, twitter }
      db.insertDailyImpressions(account.id, today, counts)  // upsert

GET /api/stats/impressions-history?accountId=N
  → query daily_impressions (56 days)
  → compute 28-day totals + delta
  → return dailyImpressions + totals

ImpressionsChart
  ← useImpressionsHistory(accountId)
  → BarChart (stacked, per-platform color-coded)
  → totals + DeltaIndicator
```

## Error Handling

- Account missing `upload_post` credentials: log warning, increment `failed`, continue.
- `getTotalImpressions` throws (non-ok response): caught per-account, increment `failed`, continue.
- `breakdown` key absent in response: `getTotalImpressions` throws with a descriptive message.
- Individual platform key absent: default to `0` (platform not connected).
