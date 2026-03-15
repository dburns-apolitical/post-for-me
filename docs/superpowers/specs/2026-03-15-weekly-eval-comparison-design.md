# Weekly Evaluation Comparison Design

## Problem

The current AI evaluation fetches post data across 28-day windows (last 28 days, previous 28 days, and all-time) and produces a standalone report. There's no week-over-week comparison, and the 28-day window is too broad to surface recent trends.

## Goal

Narrow the evaluation to focus on the last 7 days, compare against the previous evaluation's output, and lead with a summary that highlights what changed.

## Changes

### 1. `fetch_post_data` tool — narrow date windows

**Current:** Fetches 9 datasets (3 timeframes x 3 account scopes)
- All-time x (combined, main, backup)
- Last 28 days x (combined, main, backup)
- Previous 28 days x (combined, main, backup)

**New:** Fetches 6 datasets (2 timeframes x 3 account scopes)
- All-time x (combined, main, backup)
- Last 7 days x (combined, main, backup)

The 28-day and previous-28-day windows are removed. The last 7 days becomes the primary analysis window. All-time data is retained for historical context.

### 2. `fetch_previous_evaluations` tool — limit to 1

**Current:** Fetches last 10 evaluations.

**New:** Fetches last 1 evaluation. This single previous eval serves as the comparison baseline for the week-over-week summary.

### 3. System prompt — new output format

The prompt is updated to:
- Instruct the agent to compare this week's findings against the previous evaluation
- Lead with a **Week-over-Week Summary** section
- Use all-time data as supporting context rather than primary analysis
- Keep the existing bullet-points-only style

**New output structure:**

```
## Week-over-Week Summary
- Quick overview: better/worse/stable compared to last evaluation
- Call out significant changes (timing shifts, new top performers, drops)
- If nothing notable, say so briefly

## Top Performers
- **Videos:** top 3-5 by avg views (this week), note if historically consistent
- **Hooks:** top 3 by avg views
- **Captions:** top 3 by avg views

## Video Title Patterns
- **By video type:** which types avg most views
- **By song:** which songs avg most views
- **By section:** which sections avg most views
- **Notable combos:** standout type+song or type+section combinations

## Timing
- **Best days:** top 2-3 days by avg views
- **Best times:** top 2-3 time windows
- **Worst days/times:** 1-2 to avoid
```

## Files to modify

- `src/services/agent.ts` — all changes are here:
  - Update `SYSTEM_PROMPT` constant
  - Update date calculations in `fetch_post_data` tool (7 days instead of 28/56)
  - Remove prev-28-day datasets from the tool
  - Change `fetch_previous_evaluations` to fetch 1 instead of 10

## What stays the same

- Database schema (no changes)
- Cron schedule (still runs weekly on Sundays)
- `runEvaluation()` function signature and return type
- API endpoints (`/api/run-evaluation`, `/api/evaluations`)
- Token tracking, error handling, logging
