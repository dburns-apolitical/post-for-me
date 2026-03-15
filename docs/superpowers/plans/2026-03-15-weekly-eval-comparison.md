# Weekly Evaluation Comparison Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow the AI evaluation to focus on the last 7 days, compare against the previous evaluation, and lead with a week-over-week summary.

**Architecture:** All changes are in `src/services/agent.ts`. The `fetch_post_data` tool switches from 28-day windows to a 7-day window (keeping all-time), the `fetch_previous_evaluations` tool fetches 1 instead of 10, and the system prompt is rewritten to produce the new output format with a comparison summary.

**Tech Stack:** TypeScript, LangChain, Zod

---

## Chunk 1: Implementation

### Task 1: Update `fetch_post_data` tool — narrow to 7-day window

**Files:**
- Modify: `src/services/agent.ts` (the `fetchPostData` tool definition)

- [ ] **Step 1: Update date calculations and data fetching**

Replace the date variables, `accountScopes` array, `Promise.all` block, and `result` object. Change from 28/56-day windows to a single 7-day window. Remove the previous-28-day datasets and the unused `accountScopes` array.

In `src/services/agent.ts`, find the block from `const now = new Date();` through the `result` object closing `};` (lines 44-99 in the original file). Replace it with:

```typescript
            const now = new Date();
            const sevenDaysAgo = new Date(
                now.getTime() - 7 * 24 * 60 * 60 * 1000
            );

            const [
                allCombined,
                allMain,
                allBackup,
                last7Combined,
                last7Main,
                last7Backup,
            ] = await Promise.all([
                // All time: no date filters
                db.getPostsWithDetails(null, null, null),
                db.getPostsWithDetails(1, null, null),
                db.getPostsWithDetails(2, null, null),
                // Last 7 days
                db.getPostsWithDetails(null, sevenDaysAgo, null),
                db.getPostsWithDetails(1, sevenDaysAgo, null),
                db.getPostsWithDetails(2, sevenDaysAgo, null),
            ]);

            const result = {
                all_time: {
                    combined: allCombined,
                    main_account: allMain,
                    backup_account: allBackup,
                },
                last_7_days: {
                    combined: last7Combined,
                    main_account: last7Main,
                    backup_account: last7Backup,
                },
            };
```

- [ ] **Step 2: Update `fetch_post_data` tool description**

Find the `fetch_post_data` tool's `description` string (search for `'Fetch all post data across timeframes'`). Replace it with:

```typescript
            description:
                'Fetch all post data across timeframes (all time, last 7 days) and accounts (combined, main, backup). Returns detailed post information including video titles, hooks, captions, hashtags, views, and status.',
```

- [ ] **Step 3: Verify the file compiles**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/agent.ts
git commit -m "feat: narrow fetch_post_data to 7-day window"
```

---

### Task 2: Update `fetch_previous_evaluations` tool — limit to 1

**Files:**
- Modify: `src/services/agent.ts` (the `fetchPreviousEvaluations` tool definition)

- [ ] **Step 1: Change limit from 10 to 1 and update description**

In the `fetchPreviousEvaluations` tool handler, find `db.getRecentEvaluations(10)` and change to:
```typescript
            const evaluations = await db.getRecentEvaluations(1);
```

Find the `fetch_previous_evaluations` tool's `description` string (search for `'Fetch the 10 most recent'`). Replace it with:
```typescript
            description:
                'Fetch the most recent agent evaluation to use as a comparison baseline for week-over-week analysis.',
```

- [ ] **Step 2: Verify the file compiles**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/agent.ts
git commit -m "feat: limit fetch_previous_evaluations to 1"
```

---

### Task 3: Rewrite system prompt with new output format

**Files:**
- Modify: `src/services/agent.ts` (the `SYSTEM_PROMPT` constant)

- [ ] **Step 1: Replace the SYSTEM_PROMPT constant**

Replace the entire `SYSTEM_PROMPT` string (from `const SYSTEM_PROMPT =` through the closing backtick+semicolon) with:

```typescript
const SYSTEM_PROMPT = `You are a social media performance analyst for Instagram Reels accounts. Your job is to evaluate post performance week-over-week and recommend what to post next.

Video titles follow the format: [video-type]-[song-name]-[song-section]
- Video type: the filming style or concept (e.g. "fisheye", "handheld", "timelapse")
- Song name: the song the video is set to (e.g. "weather", "bloom", "midnight")
- Song section: the part of the song (e.g. "v1"/"v2" for verses, "ch1"/"ch2" for choruses, "intro", "bridge", "outro", "solo")

Example: "fisheye-weather-ch1" = fisheye-lens video, song "weather", first chorus clip.

Steps:
1. Fetch the post data — your primary analysis window is the last 7 days. All-time data is available for historical context.
2. Fetch the previous evaluation to use as your comparison baseline.
3. Compare this week's data against the previous evaluation and produce a report in exactly this format (be succinct — bullet points only, no prose):

## Week-over-Week Summary
Compare this week's results against the previous evaluation:
- Quick overview: is performance better, worse, or stable compared to last week?
- Call out any significant changes: timing shifts, new top performers, notable drops, view count changes
- If nothing notable changed, say so briefly
- Where relevant, note if a pattern is historically consistent using all-time data as a side point

If no previous evaluation exists, skip this section and note that this is the first evaluation.

## Top Performers
- **Videos:** list top 3–5 video titles by avg views, with view counts. Note if historically consistent (all-time data).
- **Hooks:** list top 3 hooks by avg views, with view counts
- **Captions:** list top 3 captions by avg views, with view counts

## Video Title Patterns
Decode each title into [type]-[song]-[section] and report:
- **By video type:** which types average the most views (e.g. "fisheye: 12k avg")
- **By song:** which songs average the most views
- **By section:** which song sections (chorus, verse, etc.) average the most views
- **Notable combos:** any standout type+song or type+section combinations

## Timing
Using post created_at timestamps:
- **Best days:** top 2–3 days of the week by avg views
- **Best times:** top 2–3 time windows (e.g. "6–8pm") by avg views
- **Worst days/times:** 1–2 to avoid`;
```

- [ ] **Step 2: Verify the file compiles**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/agent.ts
git commit -m "feat: add week-over-week summary to evaluation prompt"
```
