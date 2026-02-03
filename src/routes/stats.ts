import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse } from '../utils/auth.js';
import type {
    DashboardStats,
    PostWithDetails,
    RankedItem,
    ViewsMetrics,
    PostStatus,
} from '../types/index.js';

export async function handleStats(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized stats request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }

    logger.info('Stats request authenticated', { method: authResult.method });

    try {
        const config = getConfig();
        const sql = neon(config.databaseUrl);

        // Execute all queries in parallel for better performance
        const [
            topPostsResult,
            mostRecentPostResult,
            viewsMetricsResult,
            topCaptionsResult,
            topHooksResult,
            topHashtagCombinationsResult,
            topVideosResult,
        ] = await Promise.all([
            getTopPosts(sql),
            getMostRecentPost(sql),
            getViewsMetrics(sql),
            getTopCaptions(sql),
            getTopHooks(sql),
            getTopHashtagCombinations(sql),
            getTopVideos(sql),
        ]);

        const stats: DashboardStats = {
            topPosts: topPostsResult,
            mostRecentPost: mostRecentPostResult,
            viewsMetrics: viewsMetricsResult,
            topCaptions: topCaptionsResult,
            topHooks: topHooksResult,
            topHashtagCombinations: topHashtagCombinationsResult,
            topVideos: topVideosResult,
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
async function getTopPosts(sql: NeonSQL): Promise<PostWithDetails[]> {
    const rows = await sql`
        SELECT 
            p.id,
            p.instagram_post_id,
            p.views,
            p.status,
            p.created_at,
            p.updated_at,
            v.id as video_id,
            v.title as video_title,
            h.id as hook_id,
            h.text as hook_text,
            c.id as caption_id,
            c.text as caption_text,
            COALESCE(
                ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL),
                ARRAY[]::text[]
            ) as hashtags
        FROM posts p
        JOIN videos v ON p.video_id = v.id
        JOIN hooks h ON p.hook_id = h.id
        JOIN captions c ON p.caption_id = c.id
        JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
        LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
        WHERE p.views IS NOT NULL
        GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text
        ORDER BY p.views DESC
        LIMIT 10
    ` as RawPostRow[];

    return rows.map(mapPostRow);
}

/**
 * Get most recent post with all joined fields
 */
async function getMostRecentPost(sql: NeonSQL): Promise<PostWithDetails | null> {
    const rows = await sql`
        SELECT 
            p.id,
            p.instagram_post_id,
            p.views,
            p.status,
            p.created_at,
            p.updated_at,
            v.id as video_id,
            v.title as video_title,
            h.id as hook_id,
            h.text as hook_text,
            c.id as caption_id,
            c.text as caption_text,
            COALESCE(
                ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL),
                ARRAY[]::text[]
            ) as hashtags
        FROM posts p
        JOIN videos v ON p.video_id = v.id
        JOIN hooks h ON p.hook_id = h.id
        JOIN captions c ON p.caption_id = c.id
        JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
        LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
        GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text
        ORDER BY p.created_at DESC
        LIMIT 1
    ` as RawPostRow[];

    return rows.length > 0 ? mapPostRow(rows[0]) : null;
}

/**
 * Get views metrics (all time, last 28 days, previous 28 days, delta %)
 */
async function getViewsMetrics(sql: NeonSQL): Promise<ViewsMetrics> {
    const result = await sql`
        SELECT
            COALESCE(AVG(views), 0) as all_time_avg,
            COALESCE(AVG(CASE WHEN created_at >= NOW() - INTERVAL '28 days' THEN views END), 0) as last_28_avg,
            COALESCE(AVG(CASE WHEN created_at >= NOW() - INTERVAL '56 days' AND created_at < NOW() - INTERVAL '28 days' THEN views END), 0) as prev_28_avg
        FROM posts
        WHERE views IS NOT NULL
    ` as { all_time_avg: string; last_28_avg: string; prev_28_avg: string }[];

    const allTime = parseFloat(result[0].all_time_avg) || 0;
    const last28Days = parseFloat(result[0].last_28_avg) || 0;
    const previous28Days = parseFloat(result[0].prev_28_avg) || 0;

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
 * Get top 5 most popular captions by average views per post
 */
async function getTopCaptions(sql: NeonSQL): Promise<RankedItem[]> {
    const rows = await sql`
        SELECT 
            c.id,
            c.text,
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
async function getTopHooks(sql: NeonSQL): Promise<RankedItem[]> {
    const rows = await sql`
        SELECT 
            h.id,
            h.text,
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
async function getTopHashtagCombinations(sql: NeonSQL): Promise<RankedItem[]> {
    const rows = await sql`
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
async function getTopVideos(sql: NeonSQL): Promise<RankedItem[]> {
    const rows = await sql`
        SELECT 
            v.id,
            v.title as text,
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
