import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type {
    DashboardStats,
    PostWithDetails,
    RankedItem,
    ViewsMetrics,
    PostCountMetrics,
    PostStatus,
    UserLeaderboardEntry,
    UserViewsEntry,
} from '../types/index.js';

export async function handleStats(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized stats request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin stats request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Stats request authenticated', { method: authResult.method });

    try {
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');
        let accountId: number | null = null;

        if (accountIdParam !== null) {
            accountId = parseInt(accountIdParam, 10);
            if (isNaN(accountId) || (accountId !== 1 && accountId !== 2)) {
                return Response.json(
                    { success: false, error: 'accountId must be 1 or 2' },
                    { status: 400 }
                );
            }
        }

        const config = getConfig();
        const sql = neon(config.databaseUrl);

        // Execute all queries in parallel for better performance
        const [
            topPostsResult,
            mostRecentPostResult,
            viewsMetricsResult,
            postCountMetricsResult,
            topCaptionsResult,
            topHooksResult,
            topHashtagCombinationsResult,
            topVideosResult,
            userLeaderboardResult,
            userViewsPerVideoResult,
        ] = await Promise.all([
            getTopPosts(sql, accountId),
            getMostRecentPost(sql, accountId),
            getViewsMetrics(sql, accountId),
            getPostCountMetrics(sql, accountId),
            getTopCaptions(sql, accountId),
            getTopHooks(sql, accountId),
            getTopHashtagCombinations(sql, accountId),
            getTopVideos(sql, accountId),
            getUserLeaderboard(sql, accountId),
            getUserViewsPerVideo(sql, accountId),
        ]);

        const stats: DashboardStats = {
            topPosts: topPostsResult,
            mostRecentPost: mostRecentPostResult,
            viewsMetrics: viewsMetricsResult,
            postCountMetrics: postCountMetricsResult,
            topCaptions: topCaptionsResult,
            topHooks: topHooksResult,
            topHashtagCombinations: topHashtagCombinationsResult,
            topVideos: topVideosResult,
            userLeaderboard: userLeaderboardResult,
            userViewsPerVideo: userViewsPerVideoResult,
        };

        return Response.json({
            success: true,
            ...stats,
        });
    } catch (error) {
        logger.error('Error fetching stats', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch stats',
            },
            { status: 500 }
        );
    }
}

type NeonSQL = ReturnType<typeof neon<false, false>>;

/**
 * Get top 10 most viewed posts with all joined fields
 */
async function getTopPosts(sql: NeonSQL, accountId: number | null): Promise<PostWithDetails[]> {
    const rows = accountId !== null
        ? await sql`
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
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.views DESC
            LIMIT 10
        ` as RawPostRow[]
        : await sql`
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
            WHERE p.views IS NOT NULL
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.views DESC
            LIMIT 10
        ` as RawPostRow[];

    return rows.map(mapPostRow);
}

/**
 * Get most recent post with all joined fields
 */
async function getMostRecentPost(sql: NeonSQL, accountId: number | null): Promise<PostWithDetails | null> {
    const rows = accountId !== null
        ? await sql`
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
            WHERE p.account_id = ${accountId}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
            LIMIT 1
        ` as RawPostRow[]
        : await sql`
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
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
            ORDER BY p.created_at DESC
            LIMIT 1
        ` as RawPostRow[];

    return rows.length > 0 ? mapPostRow(rows[0]) : null;
}

/**
 * Get views metrics (all time, last 28 days, previous 28 days, delta %)
 */
async function getViewsMetrics(sql: NeonSQL, accountId: number | null): Promise<ViewsMetrics> {
    const result = accountId !== null
        ? await sql`
            SELECT
                COALESCE(SUM(views), 0) as all_time_total,
                COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '28 days' THEN views END), 0) as last_28_total,
                COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '56 days' AND created_at < NOW() - INTERVAL '28 days' THEN views END), 0) as prev_28_total
            FROM posts
            WHERE views IS NOT NULL AND account_id = ${accountId}
        ` as { all_time_total: string; last_28_total: string; prev_28_total: string }[]
        : await sql`
            SELECT
                COALESCE(SUM(views), 0) as all_time_total,
                COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '28 days' THEN views END), 0) as last_28_total,
                COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '56 days' AND created_at < NOW() - INTERVAL '28 days' THEN views END), 0) as prev_28_total
            FROM posts
            WHERE views IS NOT NULL
        ` as { all_time_total: string; last_28_total: string; prev_28_total: string }[];

    const allTime = parseFloat(result[0].all_time_total) || 0;
    const last28Days = parseFloat(result[0].last_28_total) || 0;
    const previous28Days = parseFloat(result[0].prev_28_total) || 0;

    // Calculate delta percentage
    let deltaPercent: number | null = null;
    if (previous28Days > 0) {
        deltaPercent = ((last28Days - previous28Days) / previous28Days) * 100;
    }

    return {
        allTime: Math.round(allTime),
        last28Days: Math.round(last28Days),
        previous28Days: Math.round(previous28Days),
        deltaPercent: deltaPercent !== null ? Math.round(deltaPercent * 100) / 100 : null,
    };
}

/**
 * Get post count metrics (all time, last 28 days, last 7 days)
 */
async function getPostCountMetrics(sql: NeonSQL, accountId: number | null): Promise<PostCountMetrics> {
    const result = accountId !== null
        ? await sql`
            SELECT
                COUNT(*) as all_time_total,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '28 days' THEN 1 END) as last_28_total,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7_total
            FROM posts
            WHERE account_id = ${accountId}
        ` as { all_time_total: string; last_28_total: string; last_7_total: string }[]
        : await sql`
            SELECT
                COUNT(*) as all_time_total,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '28 days' THEN 1 END) as last_28_total,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7_total
            FROM posts
        ` as { all_time_total: string; last_28_total: string; last_7_total: string }[];

    return {
        allTime: parseInt(result[0].all_time_total, 10) || 0,
        last28Days: parseInt(result[0].last_28_total, 10) || 0,
        last7Days: parseInt(result[0].last_7_total, 10) || 0,
    };
}

/**
 * Get top 5 most popular captions by average views per post
 */
async function getTopCaptions(sql: NeonSQL, accountId: number | null): Promise<RankedItem[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT
                c.id, c.text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM captions c
            JOIN posts p ON p.caption_id = c.id
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY c.id, c.text
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[]
        : await sql`
            SELECT
                c.id, c.text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM captions c
            JOIN posts p ON p.caption_id = c.id
            WHERE p.views IS NOT NULL
            GROUP BY c.id, c.text
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[];

    return rows.map(mapRankedRow);
}

/**
 * Get top 5 most popular hooks by average views per post
 */
async function getTopHooks(sql: NeonSQL, accountId: number | null): Promise<RankedItem[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT
                h.id, h.text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM hooks h
            JOIN posts p ON p.hook_id = h.id
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY h.id, h.text
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[]
        : await sql`
            SELECT
                h.id, h.text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM hooks h
            JOIN posts p ON p.hook_id = h.id
            WHERE p.views IS NOT NULL
            GROUP BY h.id, h.text
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[];

    return rows.map(mapRankedRow);
}

/**
 * Get top 5 most popular hashtag combinations by average views per post
 */
async function getTopHashtagCombinations(sql: NeonSQL, accountId: number | null): Promise<RankedItem[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT
                hc.id,
                STRING_AGG(ht.text, ', ' ORDER BY ht.id) as text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM hashtag_combinations hc
            JOIN posts p ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY hc.id
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[]
        : await sql`
            SELECT
                hc.id,
                STRING_AGG(ht.text, ', ' ORDER BY ht.id) as text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM hashtag_combinations hc
            JOIN posts p ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.views IS NOT NULL
            GROUP BY hc.id
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[];

    return rows.map(mapRankedRow);
}

/**
 * Get top 5 most popular videos by average views per post
 */
async function getTopVideos(sql: NeonSQL, accountId: number | null): Promise<RankedItem[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT
                v.id, v.title as text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM videos v
            JOIN posts p ON p.video_id = v.id
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY v.id, v.title
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[]
        : await sql`
            SELECT
                v.id, v.title as text,
                COUNT(p.id) as post_count,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(AVG(p.views), 0) as avg_views
            FROM videos v
            JOIN posts p ON p.video_id = v.id
            WHERE p.views IS NOT NULL
            GROUP BY v.id, v.title
            HAVING COUNT(p.id) > 0
            ORDER BY avg_views DESC
            LIMIT 5
        ` as RawRankedRow[];

    return rows.map(mapRankedRow);
}

/**
 * Get user leaderboard - posts per user
 */
async function getUserLeaderboard(sql: NeonSQL, accountId: number | null): Promise<UserLeaderboardEntry[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT up.user_name as name, COUNT(*) as posts
            FROM user_posts up
            JOIN posts p ON up.post_id = p.id
            WHERE p.account_id = ${accountId}
            GROUP BY up.user_name
            ORDER BY posts DESC
        ` as { name: string; posts: string }[]
        : await sql`
            SELECT up.user_name as name, COUNT(*) as posts
            FROM user_posts up
            GROUP BY up.user_name
            ORDER BY posts DESC
        ` as { name: string; posts: string }[];

    return rows.map(row => ({
        name: row.name,
        posts: parseInt(row.posts, 10),
    }));
}

/**
 * Get user views per video - average views per user's posts
 */
async function getUserViewsPerVideo(sql: NeonSQL, accountId: number | null): Promise<UserViewsEntry[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT up.user_name as name, ROUND(AVG(p.views)) as views_per_video
            FROM user_posts up
            JOIN posts p ON up.post_id = p.id
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY up.user_name
            ORDER BY views_per_video DESC
        ` as { name: string; views_per_video: string }[]
        : await sql`
            SELECT up.user_name as name, ROUND(AVG(p.views)) as views_per_video
            FROM user_posts up
            JOIN posts p ON up.post_id = p.id
            WHERE p.views IS NOT NULL
            GROUP BY up.user_name
            ORDER BY views_per_video DESC
        ` as { name: string; views_per_video: string }[];

    return rows.map(row => ({
        name: row.name,
        viewsPerVideo: parseInt(row.views_per_video, 10) || 0,
    }));
}

// Raw row types from database queries
interface RawPostRow {
    id: number;
    instagram_post_id: string | null;
    views: number | null;
    status: PostStatus;
    created_at: Date;
    updated_at: Date;
    video_id: number;
    video_title: string;
    hook_id: number;
    hook_text: string;
    caption_id: number;
    caption_text: string;
    hashtags: string[];
    account_name: string;
}

interface RawRankedRow {
    id: number;
    text: string;
    post_count: string;
    total_views: string;
    avg_views: string;
}

// Mapper functions
function mapPostRow(row: RawPostRow): PostWithDetails {
    return {
        id: row.id,
        instagram_post_id: row.instagram_post_id,
        views: row.views,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        video: {
            id: row.video_id,
            title: row.video_title,
        },
        hook: {
            id: row.hook_id,
            text: row.hook_text,
        },
        caption: {
            id: row.caption_id,
            text: row.caption_text,
        },
        hashtags: row.hashtags || [],
        account_name: row.account_name,
    };
}

function mapRankedRow(row: RawRankedRow): RankedItem {
    return {
        id: row.id,
        text: row.text || '',
        postCount: parseInt(row.post_count, 10) || 0,
        totalViews: parseInt(row.total_views, 10) || 0,
        avgViews: Math.round(parseFloat(row.avg_views) || 0),
    };
}
