# Agent Evaluation System Design

## Overview

A LangChain-powered AI agent that evaluates Instagram Reels post performance weekly (or on-demand) and recommends what to post next. Uses Claude via `@langchain/anthropic`.

## Database

New table `agent_evaluations`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `response` | TEXT NOT NULL | Full agent text response |
| `model` | TEXT NOT NULL | e.g. `claude-sonnet-4-5-20250929` |
| `input_tokens` | INTEGER | Token usage tracking |
| `output_tokens` | INTEGER | Token usage tracking |
| `triggered_by` | TEXT NOT NULL | `'cron'` or `'manual'` |
| `created_at` | TIMESTAMP DEFAULT NOW() | |

Added to `initializeSchema()` with `CREATE TABLE IF NOT EXISTS`.

## Agent Tools

### `fetch_post_data`

No parameters. Returns post data segmented by timeframe and account:

```
{
  all_time: { combined: [...], main_account: [...], backup_account: [...] },
  last_28_days: { combined: [...], main_account: [...], backup_account: [...] },
  prev_28_days: { combined: [...], main_account: [...], backup_account: [...] }
}
```

Each post: video title, hook text, caption text, hashtags (joined), views, account name, posted date, status.

### `fetch_previous_evaluations`

No parameters. Returns last 10 evaluations (most recent first): id, response, model, triggered_by, created_at.

## Agent Setup

- LangChain `createAgent()` with `@langchain/anthropic`
- System prompt instructs the agent to fetch data, review past evaluations, analyze trends, and provide specific recommendations for both accounts
- Single invocation with user message: "Run the weekly performance evaluation."

## Cron & API

### `AgentEvalCronService`

Same pattern as `ViewsSyncCronService`: `setTimeout` chain, first run next Sunday midnight UTC, repeats every 7 days, `isRunning` mutex, `start()`/`stop()` lifecycle.

### `POST /api/run-evaluation`

Admin-only. Triggers evaluation manually. Stores with `triggered_by: 'manual'`. Returns agent response in JSON body.

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/services/agent.ts` | Agent setup, tools, prompt, `runEvaluation()` |
| `src/services/agent-eval-cron.ts` | Weekly cron service |
| `src/routes/run-evaluation.ts` | POST route handler |

### Modified Files

| File | Change |
|------|--------|
| `src/services/database.ts` | Add table + query methods |
| `src/index.ts` | Wire route + cron lifecycle |
| `src/types/index.ts` | Add `AgentEvaluation` interface |

## Dependencies

- `langchain`
- `@langchain/anthropic`
