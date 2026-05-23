# Media Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only `/media` page to the dashboard that lists every video in an account's GCS bucket (live, not from the DB), shows a posted/unused badge per video, and previews videos in a modal.

**Architecture:** New backend route `GET /api/media?accountId=X` composes `VideoSelectorService.listVideos()` (bucket contents) with `DatabaseService.getPostedVideoTitles()` (success posts) into one sorted payload. New frontend page consumes it via a `useMedia` hook, renders a shadcn table with inline `<video preload="metadata">` posters, and opens a `MediaPreviewModal` (shadcn `Dialog`) on play.

**Tech Stack:** Backend — Bun, TypeScript, `bun:test`, Neon (already mocked in existing route tests). Frontend — React 19, React Router 7, shadcn/ui on top of the `radix-ui` umbrella, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-23-media-page-design.md` (same repo as this plan).

**Repos involved (cross-repo plan):**
- **Backend repo:** `post-for-me` (this repo, working tree at the current location). Tasks 1–2.
- **Frontend repo:** `/Users/dec/development/molars-admin-dashboard`. Tasks 3–8.

**Note on commits:** The user's global rule is "NEVER create git commits." So every "Commit" step in this plan reads: *Tell the user the checkpoint is ready and ask them to commit; do not run `git commit` yourself.* Show them the exact `git add` line and a suggested message — they run both.

---

## File structure

### Backend repo (`post-for-me`)

- **Create:** `src/routes/media.ts` — Route handler. Validates auth (admin), validates `accountId`, fetches account, composes `VideoSelectorService.listVideos()` + `DatabaseService.getPostedVideoTitles()`, returns sorted `MediaItem[]`.
- **Modify:** `src/index.ts` — Import `handleMedia` and add one new route guard at the same level as the existing `/api/videos` block (line ~272–274).
- **Create:** `tests/integration/media.test.ts` — Route tests: 401 (no auth), 400 (missing/invalid accountId), 404 (unknown account), 200 (happy path returns merged + sorted output).

### Frontend repo (`molars-admin-dashboard`)

- **Create:** `src/components/ui/dialog.tsx` — shadcn `Dialog` primitive, modeled on the existing `alert-dialog.tsx`. The repo uses the `radix-ui` umbrella package, not `@radix-ui/react-dialog`. This file is needed because no `Dialog` primitive exists yet.
- **Modify:** `src/types/dashboard.ts` — Add `MediaItem` interface.
- **Create:** `src/hooks/useMedia.ts` — Data hook: `useMedia(accountId: number | null)` → `{ media, isLoading, error, refetch }`.
- **Create:** `src/components/MediaPreviewModal.tsx` — Modal that wraps `<Dialog>` and a `<video controls>` element.
- **Create:** `src/pages/media.tsx` — Page composing `AccountFilter`, `useMedia`, the table, and the modal.
- **Modify:** `src/App.tsx` — Add `<Route path="/media" element={<Media />} />` inside the protected `<Layout />` block.
- **Modify:** `src/components/Layout.tsx` — Insert a "Media" entry in `MobileNav` between Content and Accounts, using `FilmIcon` from lucide.

---

## Task 1: Backend — write failing tests for `GET /api/media`

**Repo:** `post-for-me`

**Files:**
- Test: `tests/integration/media.test.ts` (new)

- [ ] **Step 1.1: Create the test file with all four cases**

Create `tests/integration/media.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock fetch (for GCS public JSON API used by VideoSelectorService)
const mockFetch = mock(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
}) as unknown as ReturnType<typeof fetch>);

// Mock the neon SQL module (for DatabaseService)
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleMedia } from '../../src/routes/media';

const authHeaders = {
    'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
};

const json = (res: Response) => res.json() as Promise<any>;

describe('GET /api/media', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        mockSql.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    test('returns 401 without authentication', async () => {
        const request = new Request('http://localhost/api/media?accountId=1', {
            method: 'GET',
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(401);
        const body = await json(response);
        expect(body.success).toBe(false);
    });

    test('returns 400 when accountId is missing', async () => {
        const request = new Request('http://localhost/api/media', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(400);
        const body = await json(response);
        expect(body.success).toBe(false);
        expect(body.error).toContain('accountId');
    });

    test('returns 400 when accountId is not a number', async () => {
        const request = new Request('http://localhost/api/media?accountId=abc', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(400);
        const body = await json(response);
        expect(body.success).toBe(false);
        expect(body.error).toContain('number');
    });

    test('returns 404 when account does not exist', async () => {
        // First DB call: getAccount returns empty
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/media?accountId=999', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(404);
        const body = await json(response);
        expect(body.success).toBe(false);
    });

    test('returns merged + sorted media (newest first) with posted flags', async () => {
        // 1st DB call: getAccount
        mockSql.mockResolvedValueOnce([{
            id: 1,
            name: 'Test Account',
            ig_access_token: 'tok',
            ig_user_id: 'uid',
            gcs_bucket_name: 'test-bucket',
            created_at: new Date(),
        }]);

        // GCS list response (intentionally out of order to verify sort)
        mockFetch.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                items: [
                    { name: 'old.mp4', timeCreated: '2025-01-01T00:00:00Z' },
                    { name: 'new.mp4', timeCreated: '2025-03-01T00:00:00Z' },
                    { name: 'mid.mp4', timeCreated: '2025-02-01T00:00:00Z' },
                    { name: 'edited/skip.mp4', timeCreated: '2025-04-01T00:00:00Z' }, // must be excluded
                    { name: 'not-a-video.txt', timeCreated: '2025-05-01T00:00:00Z' }, // must be excluded
                ],
            }),
        }) as unknown as ReturnType<typeof fetch>);

        // 2nd DB call: getPostedVideoTitles → 'mid.mp4' has been posted
        mockSql.mockResolvedValueOnce([{ title: 'mid.mp4' }]);

        const request = new Request('http://localhost/api/media?accountId=1', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(200);
        const body = await json(response);
        expect(body.success).toBe(true);

        // Sorted newest → oldest, filtered to mp4s outside edited/
        expect(body.media.map((m: { name: string }) => m.name)).toEqual([
            'new.mp4',
            'mid.mp4',
            'old.mp4',
        ]);

        // Posted flag matches the DB title
        const byName = Object.fromEntries(
            body.media.map((m: { name: string; posted: boolean }) => [m.name, m.posted])
        );
        expect(byName['mid.mp4']).toBe(true);
        expect(byName['new.mp4']).toBe(false);
        expect(byName['old.mp4']).toBe(false);

        // URLs use the account's bucket name
        for (const item of body.media) {
            expect(item.url).toBe(`https://storage.googleapis.com/test-bucket/${item.name}`);
        }
    });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail with the expected reason**

```bash
bun test tests/integration/media.test.ts
```

Expected: failure with `Cannot find module '../../src/routes/media'` (route file doesn't exist yet). This is the correct red state — proceed to Task 2.

---

## Task 2: Backend — implement `handleMedia` and wire route into the router

**Repo:** `post-for-me`

**Files:**
- Create: `src/routes/media.ts`
- Modify: `src/index.ts` (imports near top, new route block near line ~272 next to `/api/videos`)

- [ ] **Step 2.1: Create the route handler**

Create `src/routes/media.ts`:

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { DatabaseService } from '../services/database.js';

export async function handleMedia(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized media request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin media request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');

        if (!accountIdParam) {
            return Response.json(
                { success: false, error: 'accountId query parameter is required' },
                { status: 400 }
            );
        }

        const accountId = parseInt(accountIdParam, 10);
        if (isNaN(accountId)) {
            return Response.json(
                { success: false, error: 'accountId must be a number' },
                { status: 400 }
            );
        }

        const db = new DatabaseService();
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: `Account ${accountId} not found` },
                { status: 404 }
            );
        }

        const videoSelector = new VideoSelectorService(account.gcs_bucket_name);
        const [bucketVideos, postedTitles] = await Promise.all([
            videoSelector.listVideos(),
            db.getPostedVideoTitles(accountId),
        ]);

        const postedSet = new Set(postedTitles);

        const media = bucketVideos
            .map((v) => ({
                name: v.name,
                url: v.url,
                createdAt: v.createdAt.toISOString(),
                posted: postedSet.has(v.name),
            }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return Response.json({ success: true, media });
    } catch (error) {
        logger.error('Error fetching media', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to fetch media' },
            { status: 500 }
        );
    }
}
```

Note: ISO-8601 sorts correctly with a plain string compare, which avoids re-parsing dates and keeps the sort branch-free.

- [ ] **Step 2.2: Wire the route into `src/index.ts`**

In `src/index.ts`, near the top with the other `import { handle... }` lines (around line 14), add:

```typescript
import { handleMedia } from './routes/media.js';
```

Then in the route-dispatch section (around line 271–274, immediately after the `/api/videos` block), insert:

```typescript
      // List media (bucket + posted status) endpoint (requires admin authentication)
      if (url.pathname === '/api/media' && request.method === 'GET') {
        return withCors(await handleMedia(request), request);
      }
```

- [ ] **Step 2.3: Run the tests — they should pass**

```bash
bun test tests/integration/media.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 2.4: Run the full unit + integration suite to confirm nothing else broke**

```bash
bun test
```

Expected: green. If anything else turns red, stop and investigate before continuing.

- [ ] **Step 2.5: Smoke test the running server (optional but recommended)**

```bash
bun run dev
```

In another shell:

```bash
curl -s -H "X-Dashboard-Password: <your-password>" \
  "http://localhost:3000/api/media?accountId=<a-real-account-id>" | head -c 500
```

Expected: JSON response with `success: true` and a `media` array. Stop the dev server.

- [ ] **Step 2.6: Hand checkpoint to user for commit**

Tell the user:

> Backend route is done and tests pass. Suggested commit:
>
> ```bash
> git add src/routes/media.ts src/index.ts tests/integration/media.test.ts
> git commit -m "feat: add GET /api/media route"
> ```

Do not run `git commit` — the user runs it.

---

## Task 3: Frontend — add the shadcn `Dialog` primitive

**Repo:** `molars-admin-dashboard`

The repo uses the `radix-ui` umbrella import style (see `src/components/ui/alert-dialog.tsx`). The shadcn CLI may pull in `@radix-ui/react-dialog` instead, which mismatches the rest of the codebase. So write the file by hand, mirroring the existing `alert-dialog.tsx` style exactly.

**Files:**
- Create: `src/components/ui/dialog.tsx`

- [ ] **Step 3.1: Create `src/components/ui/dialog.tsx`**

```tsx
import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
```

- [ ] **Step 3.2: Type-check and lint**

```bash
pnpm run -s build 2>&1 | tail -20
```

(If `build` is too heavy, use `pnpm exec tsc --noEmit`.) Expected: no new errors.

- [ ] **Step 3.3: Hand checkpoint to user for commit**

Suggest:

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat: add shadcn Dialog primitive"
```

---

## Task 4: Frontend — add `MediaItem` type and `useMedia` hook

**Repo:** `molars-admin-dashboard`

**Files:**
- Modify: `src/types/dashboard.ts` (append `MediaItem`)
- Create: `src/hooks/useMedia.ts`

- [ ] **Step 4.1: Add the `MediaItem` interface**

Append to `src/types/dashboard.ts` (just below the existing exports — order inside the file isn't significant):

```typescript
export interface MediaItem {
  name: string;
  url: string;
  createdAt: string;
  posted: boolean;
}
```

- [ ] **Step 4.2: Create the `useMedia` hook**

Create `src/hooks/useMedia.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { authClient } from '@/lib/auth';
import type { MediaItem } from '@/types/dashboard';

interface UseMediaResult {
  media: MediaItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMedia(accountId: number | null): UseMediaResult {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchMedia = useCallback(async () => {
    if (accountId === null) {
      setMedia([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const session = await authClient.getSession();
      if (!session?.data?.session?.token) {
        throw new Error('Not authenticated');
      }
      const res = await fetch(
        `${API_BASE_URL}/api/media?accountId=${accountId}`,
        {
          headers: {
            Authorization: `Bearer ${session.data.session.token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch media: ${res.status} ${res.statusText}`);
      }
      const data = await res.json() as { media: MediaItem[] };
      setMedia(data.media);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setMedia([]);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  return { media, isLoading, error, refetch: fetchMedia };
}
```

- [ ] **Step 4.3: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.4: Hand checkpoint to user for commit**

```bash
git add src/types/dashboard.ts src/hooks/useMedia.ts
git commit -m "feat: add MediaItem type and useMedia hook"
```

---

## Task 5: Frontend — `MediaPreviewModal` component

**Repo:** `molars-admin-dashboard`

**Files:**
- Create: `src/components/MediaPreviewModal.tsx`

- [ ] **Step 5.1: Create the modal**

Create `src/components/MediaPreviewModal.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MediaItem } from '@/types/dashboard';

interface MediaPreviewModalProps {
  media: MediaItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function MediaPreviewModal({ media, open, onOpenChange }: MediaPreviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {media && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all font-mono text-sm">{media.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <span>{formatDate(media.createdAt)}</span>
                <Badge variant={media.posted ? 'default' : 'secondary'}>
                  {media.posted ? 'Posted' : 'Unused'}
                </Badge>
              </DialogDescription>
            </DialogHeader>
            <video
              key={media.url}
              src={media.url}
              controls
              playsInline
              className="w-full rounded aspect-[9/16] bg-black object-contain"
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

Notes:
- `key={media.url}` forces a fresh `<video>` element when the selected item changes, so playback state can't leak between videos.
- No `autoPlay` — user clicks the controls play button.

- [ ] **Step 5.2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.3: Hand checkpoint to user for commit**

```bash
git add src/components/MediaPreviewModal.tsx
git commit -m "feat: add MediaPreviewModal component"
```

---

## Task 6: Frontend — `Media` page

**Repo:** `molars-admin-dashboard`

**Files:**
- Create: `src/pages/media.tsx`

- [ ] **Step 6.1: Create the page**

Create `src/pages/media.tsx`:

```tsx
import { useState } from 'react';
import { PlayIcon } from 'lucide-react';

import { AccountFilter } from '@/components/AccountFilter';
import { MediaPreviewModal } from '@/components/MediaPreviewModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAccountFilter } from '@/hooks/useAccountFilter';
import { useMedia } from '@/hooks/useMedia';
import type { MediaItem } from '@/types/dashboard';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function MediaSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function Media() {
  const { accountId } = useAccountFilter();
  const { media, isLoading, error, refetch } = useMedia(accountId);
  const [previewMedia, setPreviewMedia] = useState<MediaItem | null>(null);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Media</h1>
          <p className="text-muted-foreground">Preview videos available to each account.</p>
        </div>
        <AccountFilter />
      </div>

      {accountId === null ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Select an account to view its media.
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-destructive font-medium">{error.message}</p>
            <Button variant="outline" onClick={refetch}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <MediaSkeleton />
            ) : media.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">
                No videos in this account's bucket yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Thumbnail</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead className="w-40 hidden sm:table-cell">Uploaded</TableHead>
                    <TableHead className="w-24 text-center">Posted</TableHead>
                    <TableHead className="w-16 text-center">Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {media.map((item) => (
                    <TableRow key={item.name}>
                      <TableCell>
                        <video
                          src={item.url}
                          preload="metadata"
                          muted
                          className="aspect-[9/16] w-20 rounded bg-muted object-cover"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <span className="block max-w-md truncate" title={item.name}>
                          {item.name}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={item.posted ? 'default' : 'secondary'}>
                          {item.posted ? 'Posted' : 'Unused'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Preview ${item.name}`}
                          onClick={() => setPreviewMedia(item)}
                        >
                          <PlayIcon className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <MediaPreviewModal
        media={previewMedia}
        open={previewMedia !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewMedia(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6.2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.3: Hand checkpoint to user for commit**

```bash
git add src/pages/media.tsx
git commit -m "feat: add Media page"
```

---

## Task 7: Frontend — wire route into `App.tsx` and add nav entry

**Repo:** `molars-admin-dashboard`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 7.1: Import and register the route in `src/App.tsx`**

Add to the existing `import` block at the top:

```typescript
import { Media } from './pages/media';
```

Inside the protected `<Layout />` block, add the new route after `<Route path="/content" element={<Content />} />`:

```tsx
<Route path="/media" element={<Media />} />
```

- [ ] **Step 7.2: Add the "Media" nav entry in `src/components/Layout.tsx`**

In the `lucide-react` import line, add `FilmIcon`:

```typescript
import { MenuIcon, HomeIcon, PenSquareIcon, ListIcon, FilmIcon, UsersIcon, SparklesIcon } from 'lucide-react';
```

Inside `MobileNav`, insert this `<SheetClose>` block between the existing "Content" link and the "Accounts" link (copy the exact styling pattern used by adjacent links):

```tsx
<SheetClose asChild>
  <Link
    to="/media"
    className={`flex items-center gap-4 rounded-xl px-4 py-5 text-base font-medium transition-colors ${isActive('/media')
      ? 'bg-accent text-accent-foreground'
      : 'hover:bg-accent/50'
      }`}
  >
    <FilmIcon className="size-5" />
    Media
  </Link>
</SheetClose>
```

- [ ] **Step 7.3: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.4: Run the dev server and verify routing manually**

```bash
pnpm run dev
```

Verify in the browser:
1. Open the dashboard. Open the menu — "Media" entry is visible between Content and Accounts.
2. Click it — URL becomes `/media`, page renders with the title "Media" and the account selector.
3. Active-state styling matches the other nav entries when on `/media`.

Stop the dev server when done.

- [ ] **Step 7.5: Hand checkpoint to user for commit**

```bash
git add src/App.tsx src/components/Layout.tsx
git commit -m "feat: wire /media route and add nav entry"
```

---

## Task 8: End-to-end manual verification

**Repos:** both. Backend must be running, frontend must be running.

There is no test framework configured for the dashboard, so this is the verification gate. Do not skip.

- [ ] **Step 8.1: Start the backend**

In the `post-for-me` repo:

```bash
bun run dev
```

- [ ] **Step 8.2: Start the frontend**

In a separate terminal, in `molars-admin-dashboard`:

```bash
pnpm run dev
```

- [ ] **Step 8.3: Verify each render state**

1. **No-account state:** Navigate to `/media` (account selector defaulting to "All Accounts"). Confirm: "Select an account to view its media." card appears.
2. **Loading state:** Open devtools Network panel, set throttling to "Slow 3G", select an account. Confirm: skeleton rows render while the request is in flight.
3. **Loaded state (non-empty):** Pick an account with known bucket contents. Confirm:
   - Videos appear in a table.
   - First column shows a poster (first frame) for each video — these may take a moment as the browser fetches metadata.
   - Filenames are monospaced and truncate cleanly with a tooltip on hover.
   - "Uploaded" column shows formatted dates, newest first.
   - "Posted" badge says "Posted" (default variant) for videos this account has successfully posted, "Unused" (secondary variant) otherwise. Cross-check against a known successful post in the DB.
4. **Loaded state (empty bucket):** If you have an account whose bucket is empty, switch to it. Confirm: "No videos in this account's bucket yet." text appears.
5. **Account switching:** Switch to a different account. Confirm: list reloads, posted badges reflect the new account's posts.

- [ ] **Step 8.4: Verify the modal**

1. Click the play icon on any row. Modal opens.
2. Title shows the filename, description shows the formatted date and the matching posted/unused badge.
3. Video element renders with controls. Click play — video plays.
4. Close the modal (Esc, click outside, or the X button). Confirm playback stops (no background audio).
5. Reopen the modal on a different row. Confirm the new video loads (previous playback state did not leak in).

- [ ] **Step 8.5: Verify error path**

1. Stop the backend.
2. In the dashboard, switch to a different account to trigger a fresh fetch.
3. Confirm: destructive card with the error message and a "Retry" button.
4. Restart the backend, click Retry, confirm data loads.

- [ ] **Step 8.6: Final commit-checkpoint to user**

If anything was tweaked during verification, suggest:

```bash
git add -A
git commit -m "fix: <whatever was fixed>"
```

Otherwise, tell the user the feature is verified end-to-end and ready for PR.

---

## Self-review (against the spec)

**1. Spec coverage:**
- New `/media` page → Task 6 (page) + Task 7 (route + nav).
- Account selector reuses `AccountFilter` → Task 6.
- List videos live from bucket → Tasks 1–2 (backend uses `VideoSelectorService.listVideos()`).
- Sort newest first → Task 2 (`localeCompare` on ISO strings; test in Task 1 asserts order).
- Posted badge from DB → Tasks 1–2 (composes `getPostedVideoTitles`); rendered in Task 6.
- Modal with `<video>` preview → Task 5.
- Nav entry → Task 7.
- New backend route `/api/media` → Tasks 1–2.
- Type addition → Task 4.
- `useMedia` hook → Task 4.
- Inline poster preview via `preload="metadata"` → Task 6 (9:16 aspect for reels).
- Empty-state when no account selected → Task 6.
- Error state with retry → Task 6.
- Boundary check: services reused, route is thin composition, hook owns fetching, modal owns playback → satisfied across tasks.
- Tests: backend route covered; frontend manual verification covered in Task 8 (no test framework, per spec).

No gaps.

**2. Placeholder scan:** Reviewed — every code step has complete code. No "TBD", no "similar to Task N", no vague "add error handling". All commit messages are concrete.

**3. Type/name consistency:**
- `MediaItem` (Task 4) — used by `useMedia` (Task 4), `MediaPreviewModal` (Task 5), `Media` page (Task 6). Same shape `{ name, url, createdAt, posted }`.
- Backend `media` array key — matches frontend `data.media` destructure in Task 4.
- Component name `Media` exported from `src/pages/media.tsx` (Task 6) — matches the import in Task 7 (`import { Media } from './pages/media'`).
- Hook signature `useMedia(accountId: number | null)` — matches the `useAccountFilter` return type which is `number | null`.
- `formatDate` helper defined identically in both the page and the modal (intentional duplication: small enough that extracting to a shared util would be premature, and the design doc never mandated sharing).

No mismatches.
