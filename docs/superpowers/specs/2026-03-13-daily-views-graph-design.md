# Daily Views Graph

## Overview

Add a day-by-day views graph to the dashboard, showing views over the last 28 days with period-over-period comparison. Data is captured daily during the existing views sync cron and stored in a new `daily_views` table.

## Context

Currently the dashboard displays three summary cards (All Time Views, Last 28 Days, Previous 28 Days) derived from the `posts.views` column at request time. There is no day-by-day breakdown. The views sync cron runs daily at midnight UTC, fetching view counts from Instagram's Graph API for posts that are 2+ days old and haven't been synced yet.

## Design

### Database

New `daily_views` table:

```sql
CREATE TABLE IF NOT EXISTS daily_views (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    day DATE NOT NULL,
    views INTEGER NOT NULL,
    UNIQUE(account_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_views_day ON daily_views(day);
```

- One row per account per sync run
- `day` = the date the sync ran (CURRENT_DATE)
- `views` = sum of lifetime view counts from posts synced in that run. This is intentionally a snapshot of total views at sync time, not incremental daily views. The graph compares "which day's batch of synced posts performed better."
- The UNIQUE constraint prevents duplicates if the cron runs twice or is manually triggered on the same day
- Rows are immutable once written — past data never needs updating
- Data is naturally ~2 days behind today (posts must be 2+ days old before sync)
- On days with no posts to sync, no row is written. The frontend fills date gaps with zero values.

### Cron Integration

At the end of `ViewsSyncCronService.syncViews()`, after all posts have been processed:

1. Track which posts were successfully synced in this run, grouped by `account_id`
2. For each account that had posts synced, sum the views of those posts
3. Insert into `daily_views` using `ON CONFLICT (account_id, day) DO UPDATE SET views = daily_views.views + EXCLUDED.views` to handle re-triggers gracefully (adds to existing total for that day)

This requires:
- A new `insertDailyViews(accountId: number, day: Date, views: number)` method on `DatabaseService`
- The table creation added to `initializeSchema()`
- Accumulating per-account view totals in the sync loop, then writing after the loop completes

### API

New endpoint: `GET /api/stats/views-history?accountId=[optional]`

**Authentication:** Same admin auth as existing `/api/stats`

**Query:**
- Fetches from `daily_views` where `day >= NOW() - INTERVAL '56 days'` (covers current + previous 28-day periods)
- If `accountId` is provided: filter by it
- If no `accountId`: `SELECT day, SUM(views) as views FROM daily_views WHERE day >= NOW() - INTERVAL '56 days' GROUP BY day ORDER BY day ASC`
- Always returns a single aggregated series (one line on the chart)

**Response:**

```typescript
{
    success: true,
    dailyViews: Array<{ day: string; views: number }>,  // up to 56 entries
    last28DaysTotal: number,
    previous28DaysTotal: number,
    deltaPercent: number | null
}
```

The totals and delta are computed server-side from the same dataset so the frontend doesn't need to calculate them.

**Route registration:** Add to `src/index.ts` router alongside existing `/api/stats`.

**New file:** `src/routes/views-history.ts` — follows the same pattern as `src/routes/stats.ts` (auth check, query param parsing, direct neon query, response mapping). Uses Neon driver directly in the route handler, consistent with `stats.ts`.

### Frontend

**New dependency:** `recharts` — React charting library for the area chart.

**New hook:** `useViewsHistory(accountId)` — fetches from `/api/stats/views-history`, same pattern as existing `useStats`.

**New component:** `ViewsChart` — renders on the home page in the "Views Overview" section.

**Chart spec:**
- Recharts `AreaChart` with a single `Area` element
- X-axis: dates formatted like "Feb 13" (short month + day)
- Y-axis: views count, auto-scaled
- Area fill: blue with light blue fill (matching the reference screenshot style)
- Tooltip: shows exact date and view count on hover
- Only displays the last 28 days of `dailyViews` data on the chart

**Summary stats below the chart:**
- "Last period" (previous 28 days total) on the left
- "This period" (last 28 days total) on the right
- Delta percentage indicator — extract existing `DeltaIndicator` from `home.tsx` (currently a local function) into a shared component so `ViewsChart` can reuse it

**Layout change:**
- The existing 3 "Views Overview" cards are replaced by the new chart + summary stats
- "All Time Views" is kept as a single card above or adjacent to the chart (still sourced from `getStats`)

**Loading/empty states:**
- Skeleton loader while fetching (matching existing dashboard pattern)
- Empty state message ("Views data will appear after the first sync") when no `daily_views` data exists

### Types

**Backend** (`src/types/index.ts`):

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

**Frontend** — mirror types in the dashboard's types file.

## Files to Create/Modify

### Backend (post-for-me)

| File | Action | What |
|------|--------|------|
| `src/services/database.ts` | Modify | Add `daily_views` table to `initializeSchema()`, add `insertDailyViews()` method |
| `src/services/views-sync-cron.ts` | Modify | Accumulate per-account views during sync, write to `daily_views` after sync completes |
| `src/routes/views-history.ts` | Create | New endpoint handler for `/api/stats/views-history` |
| `src/index.ts` | Modify | Register the new route |
| `src/types/index.ts` | Modify | Add `DailyViewsEntry` and `ViewsHistoryResponse` types |

### Frontend (molars-admin-dashboard)

| File | Action | What |
|------|--------|------|
| `package.json` | Modify | Add `recharts` dependency |
| `src/hooks/useViewsHistory.ts` | Create | New hook to fetch views history data |
| `src/components/ViewsChart.tsx` | Create | New chart component |
| `src/components/DeltaIndicator.tsx` | Create | Extract `DeltaIndicator` from `home.tsx` into a shared component |
| `src/pages/home.tsx` | Modify | Replace Views Overview cards with ViewsChart, keep All Time Views card, import DeltaIndicator from shared component |
| `src/types/dashboard.ts` | Modify | Add frontend mirror types |

## Testing

- **Backend unit tests:** Test the `insertDailyViews` database method and the views-history endpoint query logic
- **Cron integration:** Verify that after `syncViews()` completes, `daily_views` rows are written with correct account/day/views
- **ON CONFLICT behavior:** Verify that re-triggering sync on the same day adds to the existing row rather than failing or overwriting
- **API filtering:** Verify that `accountId` param correctly filters results, and omitting it aggregates across all accounts
- **Frontend:** Verify the chart renders with mock data, handles empty state, and responds to account filter changes
