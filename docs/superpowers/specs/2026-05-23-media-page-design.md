# Media Page — Design

**Date:** 2026-05-23
**Status:** Approved (pending user review of this written form)
**Repos:** `post-for-me` (backend), `molars-admin-dashboard` (frontend)

## Goal

Let admins browse the videos sitting in each account's GCS bucket directly from the dashboard, see which ones have already been posted by that account, and preview them in a modal.

## Scope

A new `/media` page in the admin dashboard with:

- An account selector (reusing the existing `AccountFilter`).
- A table of every video in the selected account's bucket, fetched live from GCS (not from our DB), sorted newest first.
- A "posted" badge per row, populated from the `posts` table (successful posts only).
- A play button per row that opens a modal playing the video inline.
- A nav entry linking to the page.

Out of scope: pagination, server-generated thumbnails, search/filter inside the page, editing/deleting/re-uploading videos, surfacing failed or scheduled post attempts.

## Architecture overview

- **Backend (`post-for-me`)** gains one new admin-only HTTP route — `GET /api/media?accountId=X` — that composes existing services:
  - `VideoSelectorService.listVideos(bucket)` → bucket contents with `{ name, url, createdAt }`.
  - `DatabaseService.getPostedVideoTitles(accountId)` → titles successfully posted by the account.

  The route merges these into a single sorted payload. No DB schema change.

- **Frontend (`molars-admin-dashboard`)** gains one new page (`src/pages/media.tsx`), one data hook (`src/hooks/useMedia.ts`), one modal component (`src/components/MediaPreviewModal.tsx`), a `MediaItem` type addition, a `/media` route in `App.tsx`, and a nav entry in `Layout.tsx`'s `MobileNav`.

No new infrastructure. Reuses the existing GCS public-read assumption already exercised by the Instagram upload flow and the Post page's video selector.

## Backend: `GET /api/media`

**File:** `src/routes/media.ts` (new), wired into the existing router in `src/index.ts` next to `handleVideos`.

**Auth:** Same as `routes/videos.ts` — `validateAuth` then admin check, with the same `401`/`403` responses.

**Request:** `?accountId=<integer>`
- Missing → `400 { success: false, error: 'accountId query parameter is required' }`.
- Non-integer → `400 { success: false, error: 'accountId must be a number' }`.
- Account not found → `404 { success: false, error: 'Account <id> not found' }`.

**Response:**
```ts
{
  success: true,
  media: Array<{
    name: string;       // GCS object name, e.g. "clip-2024-03-22.mp4"
    url: string;        // https://storage.googleapis.com/<bucket>/<name>
    createdAt: string;  // ISO 8601, from GCS timeCreated
    posted: boolean;    // true iff this name matches a title in posts where status='success' for this accountId
  }>
}
```

**Logic:**

1. Resolve account → `db.getAccount(accountId)` → read `gcs_bucket_name`.
2. In parallel:
   - `new VideoSelectorService(account.gcs_bucket_name).listVideos()`
   - `db.getPostedVideoTitles(accountId)`
3. Build `const postedSet = new Set(postedTitles)`.
4. Map bucket videos to `{ name, url, createdAt: v.createdAt.toISOString(), posted: postedSet.has(v.name) }`.
5. Sort by `createdAt` descending.
6. Return `{ success: true, media }`.

Errors and structured logging follow the existing `videos.ts` patterns (`logger.warn`, `logger.error` with `error` and `bucket` fields).

### Why this shape

- Merging server-side keeps the client thin.
- Reuses two pre-existing helpers verbatim — no business logic moves around.
- Leaves `/api/videos` alone, so the Post page's existing usage is untouched.

## Frontend: `/media` page

### New files

- `src/pages/media.tsx`
- `src/components/MediaPreviewModal.tsx`
- `src/hooks/useMedia.ts`

### Type addition

In `src/types/dashboard.ts`:
```ts
export interface MediaItem {
  name: string;
  url: string;
  createdAt: string;
  posted: boolean;
}
```

### Routing

In `src/App.tsx`, inside the protected `<Layout />` block:
```tsx
<Route path="/media" element={<Media />} />
```

### Nav entry

`Layout.tsx` exposes a single `MobileNav` (Sheet-based slide-out, used on both mobile and desktop). Insert a new `<SheetClose><Link to="/media">…</Link></SheetClose>` block between Content and Accounts, using `FilmIcon` from lucide, copying the active-state styling pattern of adjacent entries.

### `useMedia(accountId)` hook

Returns `{ media, isLoading, error, refetch }`.

- If `accountId === null` → returns `{ media: [], isLoading: false, error: null }` without fetching.
- Otherwise fetches `GET ${API_BASE_URL}/api/media?accountId=<id>` with the bearer token from `authClient.getSession()`, mirroring the pattern in `AccountsContext.tsx`.
- Refetches when `accountId` changes.

### Page layout

Header (matches `content.tsx`):
- Title: "Media"
- Subtitle: "Preview videos available to each account."
- `<AccountFilter />` aligned right.

Selected account comes from `useAccountFilter()` (URL search param).

Three render states:

1. **No account selected** → empty-state card: "Select an account to view its media."
2. **Loading** → skeleton rows (`Skeleton` component, mirroring `ContentSkeleton` in `content.tsx`).
3. **Loaded** → table.

### Table

Uses shadcn `Table`. Columns:

| Column | Width | Content |
|---|---|---|
| Thumbnail | `w-20` | `<video src={url} preload="metadata" muted className="aspect-[9/16] w-20 rounded bg-muted object-cover" />` — vertical aspect to match reel orientation; browser fetches just enough to render the first frame as the poster. |
| Filename | flex-1 | `name`, monospace, truncates with full name on hover via `title`. |
| Uploaded | `w-40 hidden sm:table-cell` | Formatted `createdAt` (e.g. "22 Mar 2024"). |
| Posted | `w-24 text-center` | `posted ? <Badge variant="default">Posted</Badge> : <Badge variant="secondary">Unused</Badge>`. |
| Preview | `w-16 text-center` | Icon `Button` with `PlayIcon` (lucide), opens the modal. |

Edge cases:
- Empty bucket → "No videos in this account's bucket yet." inside the table card.
- Error → destructive card with a Retry button calling `refetch()`, matching the error UI in `content.tsx`.

### Modal — `MediaPreviewModal`

**Props:**
```ts
{
  media: MediaItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Implementation:
- Wraps shadcn `<Dialog>` from `components/ui/dialog`.
- `DialogContent` with `max-w-md` (vertical reels look right at this width on desktop and remain mobile-friendly).
- `DialogTitle` = `media.name`.
- `DialogDescription` = formatted createdAt plus the posted/unused badge.
- Body: `<video src={media.url} controls playsInline className="w-full rounded aspect-[9/16] bg-black object-contain" />`. No `autoPlay` — user clicks play in the controls, sidestepping browser autoplay-policy edge cases with audio.
- On `onOpenChange(false)`, the parent clears `previewMedia` so the `<video>` unmounts and playback stops cleanly.
- No download / edit / re-upload.

### Page wiring

`media.tsx` keeps:
```ts
const [previewMedia, setPreviewMedia] = useState<MediaItem | null>(null);
```

Play button per row → `setPreviewMedia(item)`. Modal at the bottom:
```tsx
<MediaPreviewModal
  media={previewMedia}
  open={!!previewMedia}
  onOpenChange={(o) => !o && setPreviewMedia(null)}
/>
```

## Boundary check (per "design for isolation")

- `VideoSelectorService` already encapsulates bucket access.
- `DatabaseService.getPostedVideoTitles` already encapsulates the posted lookup.
- New backend route is a thin composition; no business logic leaks into routing.
- `useMedia` owns fetching. Page owns the render-state machine. Modal owns playback UI only. Each can change independently.

## Testing strategy

- **Backend route:** unit test mocking `VideoSelectorService.listVideos` and `db.getPostedVideoTitles`, asserting:
  - Merged + sorted output.
  - `400` on missing/invalid `accountId`.
  - `404` on unknown account.
  - `401`/`403` auth paths.

  Follow whatever layout exists in `tests/`.

- **Frontend:** the dashboard has no test framework set up at the moment. Verification is manual:
  - Load `/media` with no account selected → empty state visible.
  - Pick each account → posters render, "Posted"/"Unused" badges match expectations against a known recent post.
  - Open modal on a few rows; confirm playback, then close and confirm the video unmounts.
  - Switch accounts while modal is closed — list updates and posted badges reflect the new account.

  No test framework will be introduced as part of this work.

## PR sizing

This fits in one PR comfortably under the 400–600 LOC target:
- New backend route + small router wire-up: ~80 LOC.
- New page + hook + modal + type + nav entry: ~300 LOC.
- Backend route test: ~80 LOC.

If the frontend grows beyond expectation, the natural split is backend route (with test) as one PR and the dashboard page as a follow-up — they're independently shippable since the existing dashboard would simply not link to the route yet.
