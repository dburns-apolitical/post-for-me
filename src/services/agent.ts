import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { DatabaseService } from './database.js';
import { logger } from '../utils/logger.js';
import type { AgentEvaluation } from '../types/index.js';

const MODEL = 'claude-sonnet-4-5-20250929';

const SYSTEM_PROMPT = `You are a social media performance analyst for Instagram Reels accounts. Your job is to evaluate post performance week-over-week and recommend what to post next.

Video titles follow the format: [video-type]-[song-name]-[song-section]
- Video type: the filming style or concept (e.g. "fisheye", "handheld", "timelapse")
- Song name: the song the video is set to (e.g. "weather", "bloom", "midnight")
- Song section: the part of the song (e.g. "v1"/"v2" for verses, "ch1"/"ch2" for choruses, "intro", "bridge", "outro", "solo")

Example: "fisheye-weather-ch1" = fisheye-lens video, song "weather", first chorus clip.

Steps:
1. Fetch the post data — your primary analysis window is the last 7 days (2–9 days ago, to ensure views are synced). Only posts with synced view counts are included. All-time data is available for historical context.
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

function createTools(db: DatabaseService) {
    const fetchPostData = tool(
        async () => {
            const now = new Date();
            const twoDaysAgo = new Date(
                now.getTime() - 2 * 24 * 60 * 60 * 1000
            );
            const nineDaysAgo = new Date(
                now.getTime() - 9 * 24 * 60 * 60 * 1000
            );

            const hasSyncedViews = (post: any) => post.views != null;

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
                // 2-9 days ago (7 days of synced data)
                db.getPostsWithDetails(null, nineDaysAgo, twoDaysAgo),
                db.getPostsWithDetails(1, nineDaysAgo, twoDaysAgo),
                db.getPostsWithDetails(2, nineDaysAgo, twoDaysAgo),
            ]).then(results => results.map(posts => posts.filter(hasSyncedViews)));

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

            return JSON.stringify(result);
        },
        {
            name: 'fetch_post_data',
            description:
                'Fetch all post data across timeframes (all time, 2-9 days ago) and accounts (combined, main, backup). Only includes posts with synced view counts. Returns detailed post information including video titles, hooks, captions, hashtags, views, and status.',
            schema: z.object({}),
        }
    );

    const fetchPreviousEvaluations = tool(
        async () => {
            const evaluations = await db.getRecentEvaluations(1);
            return JSON.stringify(evaluations);
        },
        {
            name: 'fetch_previous_evaluations',
            description:
                'Fetch the most recent agent evaluation to use as a comparison baseline for week-over-week analysis.',
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
