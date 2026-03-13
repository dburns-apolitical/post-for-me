# Recent Posts List — Design Spec

## Overview

Replace the "Most Recent Post" section (single full `PostCard`) with a compact "Recent Posts" list showing the most recent post from each account. Stacked row layout, sorted newest first, limited to 5.

## Requirements

- Show one post per account, sorted by `created_at` descending, limit 5
- Each row displays: account name, video title (truncated with `truncate`), status badge (color-coded), time-ago badge (color-coded)
- Always shows all accounts regardless of account filter selection
- Reuse existing `getStatusStyle()` and `getRecencyInfo()` styling helpers
- Stacked rows with rounded backgrounds (option B from brainstorm)

## Backend

### New endpoint: `GET /api/stats/recent-posts`

Requires admin authentication (same pattern as other `/api/stats/*` endpoints — `validateAuth` + `isAdmin` check). Register the route handler in `src/index.ts`.

Returns the most recent post per account, sorted newest first, limit 5.

**SQL query:**
```sql
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
```

**Response shape:**
```typescript
interface RecentPost {
  account_name: string;
  video_title: string;
  status: PostStatus; // database stores: 'pending' | 'success' | 'failed'
  created_at: string; // ISO string (Date serialized to JSON)
}
```

**Response:** `{ success: true, recentPosts: RecentPost[] }`

### Changes to existing `/api/stats`

Remove `mostRecentPost` from the stats response and remove `getMostRecentPost()`. This is a coordinated deploy (frontend + backend updated together).

## Frontend

### New component: `RecentPostsList`

Located in dashboard home page (`home.tsx`) or extracted to its own file.

**Layout per row:**
- Rounded container (`bg-secondary/50 rounded-lg px-3 py-2.5`)
- Left side: account name (muted, small), video title (normal weight, `truncate` to prevent overflow)
- Right side: status badge, time-ago badge
- Flex layout with `justify-between`

**Data fetching:**
- New `useRecentPosts()` hook — separate from `useStats` since this endpoint ignores account filter and should not refetch when account selection changes
- Calls `GET /api/stats/recent-posts` with no parameters
- Returns `{ recentPosts, isLoading, error }`

**Loading state:** 3 skeleton rows matching the stacked row dimensions.

**Empty state:** Text message "No posts yet" when `recentPosts` is empty.

### Section changes

- Title changes from "Most Recent Post" to "Recent Posts"
- Remove `PostCard` usage for this section
- `PostCard` component stays — it is still used in the "Top Performing Posts" grid
- Remove `PostCardSkeleton` only if unused after this change
- Remove `mostRecentPost` from `DashboardStats` type and `useStats` hook

### Preserved behavior

- `getStatusStyle()` for status badge colors (success=emerald, pending=amber, failed=red)
- `getRecencyInfo()` for time-ago badge colors and label formatting
- Both functions remain unchanged

## Out of scope

- No changes to account filter behavior for other sections
- No changes to the posts table or data model
- No pagination or "view more" link
