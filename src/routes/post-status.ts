import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { PostStatusResponse } from '../types/index.js';
import { DatabaseService } from '../services/database.js';

export async function handlePostStatus(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized post-status request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin post-status request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        // Parse postId from query params
        const url = new URL(request.url);
        const postIdParam = url.searchParams.get('postId');

        if (!postIdParam) {
            return Response.json(
                {
                    success: false,
                    error: 'Missing required query parameter: postId',
                } as PostStatusResponse,
                { status: 400 }
            );
        }

        const postId = parseInt(postIdParam, 10);
        if (isNaN(postId) || postId <= 0) {
            return Response.json(
                {
                    success: false,
                    error: 'Invalid postId: must be a positive integer',
                } as PostStatusResponse,
                { status: 400 }
            );
        }

        logger.info('Post status request received', { postId });

        // Get post from database
        const db = new DatabaseService();
        const post = await db.getPostById(postId);

        if (!post) {
            return Response.json(
                {
                    success: false,
                    error: `Post not found with id: ${postId}`,
                } as PostStatusResponse,
                { status: 404 }
            );
        }

        const response: PostStatusResponse = {
            success: true,
            post: {
                id: post.id,
                status: post.status,
                created_at: post.created_at,
                updated_at: post.updated_at,
                instagram_post_id: post.instagram_post_id,
                views: post.views,
                video: post.video,
                hook: post.hook,
                caption: post.caption,
                hashtags: post.hashtags,
            },
        };

        return Response.json(response, { status: 200 });
    } catch (error) {
        logger.error('Error handling post status request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            } as PostStatusResponse,
            { status: 500 }
        );
    }
}
