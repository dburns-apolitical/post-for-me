# Agent Evaluation System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a LangChain-powered AI agent that evaluates Instagram Reels post performance weekly (or on-demand via POST) and stores evaluation history.

**Architecture:** LangChain `createAgent()` with two tools (fetch post data, fetch previous evaluations) backed by raw SQL on Neon Postgres. Cron service follows existing `ViewsSyncCronService` pattern. New route follows existing `sync-views` pattern.

**Tech Stack:** LangChain JS (`langchain`, `@langchain/core`, `@langchain/anthropic`), Bun, Neon Postgres, Zod

---

### Task 1: Install dependencies

**Step 1: Install LangChain packages**

Run: `bun add langchain @langchain/core @langchain/anthropic`

**Step 2: Verify installation**

Run: `bun run src/index.ts` (should start without import errors — Ctrl+C to stop)

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "feat: add langchain and anthropic dependencies"
```

---

### Task 2: Add ANTHROPIC_API_KEY to config

**Files:**
- Modify: `src/config/index.ts`
- Modify: `src/types/index.ts`

**Step 1: Add anthropic config to types**

In `src/types/index.ts`, add to the `Config` interface:

```ts
anthropic: {
    apiKey: string;
};
```

**Step 2: Add anthropic config loading**

In `src/config/index.ts`, add `'ANTHROPIC_API_KEY'` to `requiredEnvVars` array, and add to the return object:

```ts
anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
},
```

**Step 3: Add to .env (local only, do not commit)**

Add `ANTHROPIC_API_KEY=sk-ant-...` to your `.env` file.

**Step 4: Commit**

```bash
git add src/config/index.ts src/types/index.ts
git commit -m "feat: add anthropic API key to config"
```

---

### Task 3: Add database table and query methods

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/database.ts`

**Step 1: Add AgentEvaluation type**

In `src/types/index.ts`, add:

```ts
export interface AgentEvaluation {
    id: number;
    response: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    triggered_by: string;
    created_at: Date;
}
```

**Step 2: Add table creation to initializeSchema()**

In `src/services/database.ts`, add after the last `CREATE INDEX` block (around line 160), before the `logger.info('Database schema initialized')` line:

```ts
await this.sql`
    CREATE TABLE IF NOT EXISTS agent_evaluations (
        id SERIAL PRIMARY KEY,
        response TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        triggered_by TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
`;
```

**Step 3: Add import for new type**

In `src/services/database.ts`, add `AgentEvaluation` to the import from `'../types/index.js'`.

**Step 4: Add insertEvaluation method**

In `src/services/database.ts`, add at the end of the class (before the closing `}`):

```ts
async insertEvaluation(
    response: string,
    model: string,
    inputTokens: number | null,
    outputTokens: number | null,
    triggeredBy: string
): Promise<AgentEvaluation> {
    const result = await this.sql`
        INSERT INTO agent_evaluations (response, model, input_tokens, output_tokens, triggered_by)
        VALUES (${response}, ${model}, ${inputTokens}, ${outputTokens}, ${triggeredBy})
        RETURNING id, response, model, input_tokens, output_tokens, triggered_by, created_at
    ` as AgentEvaluation[];
    return result[0];
}
```

**Step 5: Add getRecentEvaluations method**

```ts
async getRecentEvaluations(limit: number = 10): Promise<AgentEvaluation[]> {
    const result = await this.sql`
        SELECT id, response, model, input_tokens, output_tokens, triggered_by, created_at
        FROM agent_evaluations
        ORDER BY created_at DESC
        LIMIT ${limit}
    ` as AgentEvaluation[];
    return result;
}
```

**Step 6: Add getPostsWithDetails method for agent tool**

This is a new method that returns posts with joined details, filtered by timeframe and optionally by account. Add to the class:

```ts
async getPostsWithDetails(
    accountId: number | null,
    afterDate: Date | null,
    beforeDate: Date | null
): Promise<PostWithDetails[]> {
    let rows;
    if (accountId !== null && afterDate !== null && beforeDate !== null) {
        rows = await this.sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                a.name as account_name,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.status = 'success' AND p.account_id = ${accountId}
              AND p.created_at >= ${afterDate.toISOString()} AND p.created_at < ${beforeDate.toISOString()}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
        `;
    } else if (accountId !== null && afterDate !== null) {
        rows = await this.sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                a.name as account_name,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.status = 'success' AND p.account_id = ${accountId}
              AND p.created_at >= ${afterDate.toISOString()}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
        `;
    } else if (afterDate !== null && beforeDate !== null) {
        rows = await this.sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                a.name as account_name,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.status = 'success'
              AND p.created_at >= ${afterDate.toISOString()} AND p.created_at < ${beforeDate.toISOString()}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
        `;
    } else if (afterDate !== null) {
        rows = await this.sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                a.name as account_name,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.status = 'success'
              AND p.created_at >= ${afterDate.toISOString()}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
        `;
    } else if (accountId !== null) {
        rows = await this.sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                a.name as account_name,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.status = 'success' AND p.account_id = ${accountId}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
        `;
    } else {
        rows = await this.sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                a.name as account_name,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.status = 'success'
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
        `;
    }

    return (rows as any[]).map((row: any) => ({
        id: row.id,
        instagram_post_id: row.instagram_post_id,
        views: row.views,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        video: { id: row.video_id, title: row.video_title },
        hook: { id: row.hook_id, text: row.hook_text },
        caption: { id: row.caption_id, text: row.caption_text },
        hashtags: row.hashtags || [],
        account_name: row.account_name,
    }));
}
```

**Step 7: Commit**

```bash
git add src/types/index.ts src/services/database.ts
git commit -m "feat: add agent_evaluations table and query methods"
```

---

### Task 4: Create the agent service

**Files:**
- Create: `src/services/agent.ts`

**Step 1: Create agent.ts with tools, prompt, and runEvaluation()**

Create `src/services/agent.ts`:

```ts
import { createAgent, tool } from 'langchain';
import * as z from 'zod';
import { DatabaseService } from './database.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { AgentEvaluation } from '../types/index.js';

const MODEL = 'claude-sonnet-4-5-20250929';

const SYSTEM_PROMPT = `You are a social media performance analyst for Instagram Reels accounts. Your job is to evaluate post performance and recommend what to post next.

Steps:
1. Fetch the post data to see performance across all timeframes and accounts
2. Fetch previous evaluations to understand what you've recommended before and whether those recommendations were followed
3. Analyze trends — which videos, hooks, captions, and hashtags perform best
4. Provide specific recommendations for upcoming posts, including which videos to post, with which captions, hooks, and hashtags, for both the main and backup accounts

Be specific and actionable. Reference actual data points (view counts, specific video titles, etc.) in your analysis.`;

function createTools(db: DatabaseService) {
    const fetchPostData = tool(
        async () => {
            const now = new Date();
            const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
            const fiftyySixDaysAgo = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);

            const [
                allTimeCombined, allTimeMain, allTimeBackup,
                last28Combined, last28Main, last28Backup,
                prev28Combined, prev28Main, prev28Backup,
            ] = await Promise.all([
                db.getPostsWithDetails(null, null, null),
                db.getPostsWithDetails(1, null, null),
                db.getPostsWithDetails(2, null, null),
                db.getPostsWithDetails(null, twentyEightDaysAgo, null),
                db.getPostsWithDetails(1, twentyEightDaysAgo, null),
                db.getPostsWithDetails(2, twentyEightDaysAgo, null),
                db.getPostsWithDetails(null, fiftyySixDaysAgo, twentyEightDaysAgo),
                db.getPostsWithDetails(1, fiftyySixDaysAgo, twentyEightDaysAgo),
                db.getPostsWithDetails(2, fiftyySixDaysAgo, twentyEightDaysAgo),
            ]);

            return JSON.stringify({
                all_time: { combined: allTimeCombined, main_account: allTimeMain, backup_account: allTimeBackup },
                last_28_days: { combined: last28Combined, main_account: last28Main, backup_account: last28Backup },
                prev_28_days: { combined: prev28Combined, main_account: prev28Main, backup_account: prev28Backup },
            });
        },
        {
            name: 'fetch_post_data',
            description: 'Fetch all post performance data segmented by timeframe (all time, last 28 days, previous 28 days) and account (combined, main account, backup account). Each post includes video title, hook text, caption text, hashtags, views, account name, posted date, and status.',
            schema: z.object({}),
        }
    );

    const fetchPreviousEvaluations = tool(
        async () => {
            const evaluations = await db.getRecentEvaluations(10);
            return JSON.stringify(evaluations);
        },
        {
            name: 'fetch_previous_evaluations',
            description: 'Fetch the last 10 agent evaluations (most recent first). Each includes the full response text, model used, how it was triggered, and when it was created.',
            schema: z.object({}),
        }
    );

    return [fetchPostData, fetchPreviousEvaluations];
}

export async function runEvaluation(triggeredBy: string): Promise<AgentEvaluation> {
    const config = getConfig();
    const db = new DatabaseService();

    logger.info('Starting agent evaluation', { triggeredBy });

    const tools = createTools(db);

    const agent = createAgent({
        model: MODEL,
        tools,
        systemPrompt: SYSTEM_PROMPT,
    });

    const result = await agent.invoke({
        messages: [{ role: 'user', content: 'Run the weekly performance evaluation.' }],
    });

    // Extract the final AI message text from the result
    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];
    const responseText = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    // Extract token usage if available
    const usageMetadata = lastMessage.usage_metadata;
    const inputTokens = usageMetadata?.input_tokens ?? null;
    const outputTokens = usageMetadata?.output_tokens ?? null;

    // Store the evaluation
    const evaluation = await db.insertEvaluation(
        responseText,
        MODEL,
        inputTokens,
        outputTokens,
        triggeredBy
    );

    logger.info('Agent evaluation completed', {
        evaluationId: evaluation.id,
        triggeredBy,
        inputTokens,
        outputTokens,
    });

    return evaluation;
}
```

**Important notes for implementer:**
- The `ANTHROPIC_API_KEY` env var is picked up automatically by `@langchain/anthropic` — no need to pass it to `createAgent()` when using a model string.
- `result.messages` is the full conversation including tool calls and responses. The last message is the agent's final answer.
- Token usage on `usage_metadata` may not be available on all messages — handle nulls.

**Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/services/agent.ts
git commit -m "feat: add LangChain agent service with evaluation tools"
```

---

### Task 5: Create the cron service

**Files:**
- Create: `src/services/agent-eval-cron.ts`

**Step 1: Create agent-eval-cron.ts**

Model this exactly after `src/services/views-sync-cron.ts` (see that file for the pattern). Create `src/services/agent-eval-cron.ts`:

```ts
import { runEvaluation } from './agent.js';
import { logger } from '../utils/logger.js';

export class AgentEvalCronService {
    private timer: Timer | null = null;
    private isRunning: boolean = false;

    // 7 days in milliseconds
    private static readonly INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

    start(): void {
        if (this.timer) {
            logger.warn('Agent eval cron job already running');
            return;
        }

        // Calculate milliseconds until next Sunday midnight UTC
        const now = new Date();
        const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
        const nextSunday = new Date(now);
        nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
        nextSunday.setUTCHours(0, 0, 0, 0);
        const msUntilSunday = nextSunday.getTime() - now.getTime();

        setTimeout(() => {
            this.runAndScheduleNext();
        }, msUntilSunday);

        logger.info('Agent eval cron job started', {
            nextRunAt: nextSunday.toISOString(),
            msUntilFirstRun: msUntilSunday,
        });
    }

    private runAndScheduleNext(): void {
        this.evaluate().finally(() => {
            this.timer = setTimeout(() => {
                this.runAndScheduleNext();
            }, AgentEvalCronService.INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Agent eval cron job stopped');
        }
    }

    async evaluate(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Agent eval already in progress, skipping');
            return;
        }

        this.isRunning = true;

        try {
            const evaluation = await runEvaluation('cron');
            logger.info('Cron agent evaluation completed', { evaluationId: evaluation.id });
        } catch (error) {
            logger.error('Cron agent evaluation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }
    }
}
```

**Step 2: Commit**

```bash
git add src/services/agent-eval-cron.ts
git commit -m "feat: add weekly agent evaluation cron service"
```

---

### Task 6: Create the API route

**Files:**
- Create: `src/routes/run-evaluation.ts`

**Step 1: Create run-evaluation.ts**

Model after `src/routes/sync-views.ts`. Create `src/routes/run-evaluation.ts`:

```ts
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { runEvaluation } from '../services/agent.js';

export async function handleRunEvaluation(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized run-evaluation request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin run-evaluation request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Manual agent evaluation triggered', { method: authResult.method });

    try {
        const evaluation = await runEvaluation('manual');

        return Response.json({
            success: true,
            evaluation: {
                id: evaluation.id,
                response: evaluation.response,
                model: evaluation.model,
                input_tokens: evaluation.input_tokens,
                output_tokens: evaluation.output_tokens,
                triggered_by: evaluation.triggered_by,
                created_at: evaluation.created_at,
            },
        });
    } catch (error) {
        logger.error('Manual agent evaluation failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run evaluation',
            },
            { status: 500 }
        );
    }
}
```

**Step 2: Commit**

```bash
git add src/routes/run-evaluation.ts
git commit -m "feat: add POST /api/run-evaluation route"
```

---

### Task 7: Wire everything into index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Add imports**

At the top of `src/index.ts`, add after the existing imports:

```ts
import { handleRunEvaluation } from './routes/run-evaluation.js';
import { AgentEvalCronService } from './services/agent-eval-cron.js';
```

**Step 2: Instantiate cron service**

After `const viewsSyncCron = new ViewsSyncCronService();` (line 18), add:

```ts
const agentEvalCron = new AgentEvalCronService();
```

**Step 3: Start cron in startup()**

After `viewsSyncCron.start();` (line 96), add:

```ts
agentEvalCron.start();
```

**Step 4: Stop cron in shutdown()**

After `viewsSyncCron.stop();` (line 108), add:

```ts
agentEvalCron.stop();
```

**Step 5: Add route**

In the `fetch()` handler, add before the 404 catch-all (before line 229):

```ts
// Agent evaluation endpoint (requires admin authentication)
if (url.pathname === '/api/run-evaluation' && request.method === 'POST') {
    return withCors(await handleRunEvaluation(request), request);
}
```

**Step 6: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`

**Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire agent evaluation route and cron into server"
```

---

### Task 8: Manual smoke test

**Step 1: Start the server**

Run: `bun run dev`

Verify in logs:
- "Agent eval cron job started" with a future Sunday date
- No startup errors

**Step 2: Test the endpoint**

In a separate terminal, run:

```bash
curl -X POST http://localhost:3000/api/run-evaluation \
  -H "X-Dashboard-Password: YOUR_PASSWORD_HERE"
```

Expected: JSON response with `success: true` and the agent's evaluation text in `evaluation.response`.

**Step 3: Verify DB storage**

Check that the evaluation was stored (the response should include an `id`).

**Step 4: Stop the server (Ctrl+C)**

Verify "Agent eval cron job stopped" in logs.
