import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { DatabaseService } from './database.js';
import { logger } from '../utils/logger.js';
import type { AgentEvaluation } from '../types/index.js';

const MODEL = 'claude-sonnet-4-5-20250929';

const SYSTEM_PROMPT = `You are a social media performance analyst for Instagram Reels accounts. Your job is to evaluate post performance and recommend what to post next.

Video titles follow the format: [video-type]-[song-name]-[song-section]
- Video type: the filming style or concept (e.g. "fisheye", "handheld", "timelapse")
- Song name: the song the video is set to (e.g. "weather", "bloom", "midnight")
- Song section: the part of the song (e.g. "v1"/"v2" for verses, "ch1"/"ch2" for choruses, "intro", "bridge", "outro", "solo")

Example: "fisheye-weather-ch1" = fisheye-lens video, song "weather", first chorus clip.

Steps:
1. Fetch the post data to see performance across all timeframes and accounts
2. Fetch previous evaluations to understand what you've recommended before and whether those recommendations were followed
3. Analyse the data and produce a report in exactly this format (be succinct — bullet points only, no prose):

## Top Performers
- **Videos:** list top 3–5 video titles by avg views, with view counts
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

function createTools(db: DatabaseService) {
    const fetchPostData = tool(
        async () => {
            const now = new Date();
            const twentyEightDaysAgo = new Date(
                now.getTime() - 28 * 24 * 60 * 60 * 1000
            );
            const fiftySixDaysAgo = new Date(
                now.getTime() - 56 * 24 * 60 * 60 * 1000
            );

            const accountScopes = [
                { key: 'combined', id: null },
                { key: 'main_account', id: 1 },
                { key: 'backup_account', id: 2 },
            ] as const;

            const [
                allCombined,
                allMain,
                allBackup,
                last28Combined,
                last28Main,
                last28Backup,
                prev28Combined,
                prev28Main,
                prev28Backup,
            ] = await Promise.all([
                // All time: no date filters
                db.getPostsWithDetails(null, null, null),
                db.getPostsWithDetails(1, null, null),
                db.getPostsWithDetails(2, null, null),
                // Last 28 days
                db.getPostsWithDetails(null, twentyEightDaysAgo, null),
                db.getPostsWithDetails(1, twentyEightDaysAgo, null),
                db.getPostsWithDetails(2, twentyEightDaysAgo, null),
                // Previous 28 days (28-56 days ago)
                db.getPostsWithDetails(null, fiftySixDaysAgo, twentyEightDaysAgo),
                db.getPostsWithDetails(1, fiftySixDaysAgo, twentyEightDaysAgo),
                db.getPostsWithDetails(2, fiftySixDaysAgo, twentyEightDaysAgo),
            ]);

            const result = {
                all_time: {
                    combined: allCombined,
                    main_account: allMain,
                    backup_account: allBackup,
                },
                last_28_days: {
                    combined: last28Combined,
                    main_account: last28Main,
                    backup_account: last28Backup,
                },
                prev_28_days: {
                    combined: prev28Combined,
                    main_account: prev28Main,
                    backup_account: prev28Backup,
                },
            };

            return JSON.stringify(result);
        },
        {
            name: 'fetch_post_data',
            description:
                'Fetch all post data across timeframes (all time, last 28 days, previous 28 days) and accounts (combined, main, backup). Returns detailed post information including video titles, hooks, captions, hashtags, views, and status.',
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
            description:
                'Fetch the 10 most recent agent evaluations to understand previous recommendations and whether they were followed.',
            schema: z.object({}),
        }
    );

    return [fetchPostData, fetchPreviousEvaluations];
}

export async function runEvaluation(
    triggeredBy: string
): Promise<AgentEvaluation> {
    const db = new DatabaseService();
    const tools = createTools(db);

    const agent = createAgent({
        model: MODEL,
        tools,
        systemPrompt: SYSTEM_PROMPT,
    });

    logger.info('Running agent evaluation', { triggeredBy });

    const result = await agent.invoke({
        messages: [
            {
                role: 'user',
                content: 'Run the weekly performance evaluation.',
            },
        ],
    });

    const lastMessage = result.messages[result.messages.length - 1];

    let responseText: string;
    if (typeof lastMessage.content === 'string') {
        responseText = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
        responseText = lastMessage.content
            .map((block: any) =>
                typeof block === 'string' ? block : block.text ?? ''
            )
            .join('');
    } else {
        responseText = String(lastMessage.content);
    }

    const usageMetadata = (lastMessage as any).usage_metadata;
    const inputTokens: number | null =
        usageMetadata?.input_tokens ?? null;
    const outputTokens: number | null =
        usageMetadata?.output_tokens ?? null;

    const evaluation = await db.insertEvaluation(
        responseText,
        MODEL,
        inputTokens,
        outputTokens,
        triggeredBy
    );

    logger.info('Agent evaluation completed', {
        evaluationId: evaluation.id,
        inputTokens,
        outputTokens,
        triggeredBy,
    });

    return evaluation;
}
