import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { PostStatus } from '../types/index.js';

interface RecentPostRow {
    account_name: string;
    video_title: string;
    status: string;
    created_at: string;
}

export async function handleRecentPosts(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized recent posts request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin recent posts request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const config = getConfig();
        const sql = neon(config.databaseUrl);

        const rows = await sql`
            SELECT * FROM (
                SELECT DISTINCT ON (p.account_id)
                    a.name AS account_name,
                    v.title AS video_title,
                    p.status,
                    p.created_at
                FROM posts p
                JOIN accounts a ON p.account_id = a.id
                JOIN videos v ON p.video_id = v.id
                ORDER BY p.account_id, p.created_at DESC
            ) sub
            ORDER BY created_at DESC
            LIMIT 5
        ` as RecentPostRow[];

        const recentPosts = rows.map(row => ({
            account_name: row.account_name,
            video_title: row.video_title,
            status: row.status as PostStatus,
            created_at: row.created_at,
        }));

        return Response.json({
            success: true,
            recentPosts,
        });
    } catch (error) {
        logger.error('Error fetching recent posts', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch recent posts',
            },
            { status: 500 }
        );
    }
}
