import { logger } from '../utils/logger.js';
import { validatePostReelRequest } from '../utils/validation.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { PostReelResponse } from '../types/index.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { VideoEditorService } from '../services/video-editor.js';
import { InstagramClientService } from '../services/instagram-client.js';
import { DatabaseService } from '../services/database.js';

/**
 * Background processing function that handles video editing and Instagram posting.
 * This runs asynchronously after the HTTP response has been sent.
 */
async function processPostInBackground(
    postId: number,
    inputVideoPath: string,
    hookText: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean,
    db: DatabaseService
): Promise<void> {
    let editedVideoPath: string | null = null;
    const videoSelector = new VideoSelectorService();
    const videoEditor = new VideoEditorService();
    const instagramClient = new InstagramClientService();

    try {
        // Step 3: Validate video format
        logger.info('Step 3: Validating video format', { postId });
        const validation_result = await videoEditor.validateVideoFormat(inputVideoPath);

        if (!validation_result.isValid) {
            logger.warn('Video format validation failed', { postId, ...validation_result });
            // Continue anyway, but log the warning
        }

        // Step 4: Add text overlay to video
        logger.info('Step 4: Adding text overlay to video', { postId });
        editedVideoPath = await videoEditor.addTextOverlay(inputVideoPath, hookText, {
            position: 'top',
            fontSize: 60,
            fontColor: 'white',
            strokeColor: 'black',
            strokeWidth: 3,
        });

        logger.info('Video edited successfully', { postId, editedPath: editedVideoPath });

        // Step 5: Upload edited video to GCS
        logger.info('Step 5: Uploading edited video to GCS', { postId });
        const videoUrl = await videoSelector.uploadEditedVideo(editedVideoPath);

        logger.info('Edited video uploaded', { postId, videoUrl });

        // Step 6: Post to Instagram
        logger.info('Step 6: Posting Reel to Instagram', { postId });
        const instagramPost = await instagramClient.postReel(
            videoUrl,
            caption,
            hashtags,
            shareToFeed
        );

        logger.info('Reel posted successfully', {
            postId,
            instagramPostId: instagramPost.id,
            status: instagramPost.status,
        });

        // Step 7: Update post status to success with Instagram post ID
        logger.info('Step 7: Updating post status to success', { postId });
        await db.markPostSuccess(postId, instagramPost.id);

        // Step 8: Cleanup temporary files
        logger.info('Step 8: Cleaning up temporary files', { postId });
        videoSelector.cleanupTempFile(inputVideoPath);
        videoEditor.cleanupTempFile(editedVideoPath);

        logger.info('Post processing completed successfully', { postId });
    } catch (error) {
        logger.error('Error in background post processing', {
            postId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        // Update post status to failed
        try {
            await db.updatePostStatus(postId, 'failed');
            logger.info('Post status updated to failed', { postId });
        } catch (dbError) {
            logger.warn('Failed to update post status to failed', {
                postId,
                error: dbError instanceof Error ? dbError.message : 'Unknown error',
            });
        }

        // Cleanup temporary files on error
        try {
            videoSelector.cleanupTempFile(inputVideoPath);
        } catch (cleanupError) {
            logger.warn('Failed to cleanup input video on error', { postId, inputVideoPath });
        }

        if (editedVideoPath) {
            try {
                videoEditor.cleanupTempFile(editedVideoPath);
            } catch (cleanupError) {
                logger.warn('Failed to cleanup edited video on error', { postId, editedVideoPath });
            }
        }
    }
}

export async function handlePostReel(request: Request): Promise<Response> {
    // Validate authentication
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized post-reel request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin post-reel request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        // Parse request body
        const body = await request.json();

        // Validate input
        const validation = validatePostReelRequest(body);

        if (!validation.success) {
            logger.warn('Validation failed', { errors: validation.error.errors });
            return Response.json(
                {
                    success: false,
                    error: 'Validation failed',
                    details: validation.error.errors,
                },
                { status: 400 }
            );
        }

        // Initialize video selector service
        const videoSelector = new VideoSelectorService();

        // Get values from request or auto-select from database
        let { caption, hookText, hashtags, shareToFeed } = validation.data;

        // Auto-select caption from database if not provided
        if (!caption) {
            const dbCaption = await db.getRandomCaption();
            if (!dbCaption) {
                return Response.json(
                    {
                        success: false,
                        error: 'No caption provided and no captions in database',
                    },
                    { status: 400 }
                );
            }
            caption = dbCaption.text;
            logger.info('Auto-selected caption from database');
        }

        // Auto-select hookText from database if not provided
        if (!hookText) {
            const dbHook = await db.getRandomHook();
            if (!dbHook) {
                return Response.json(
                    {
                        success: false,
                        error: 'No hookText provided and no hooks in database',
                    },
                    { status: 400 }
                );
            }
            hookText = dbHook.text;
            logger.info('Auto-selected hookText from database');
        }

        // Auto-select hashtags from database if not provided (default 5)
        if (!hashtags || hashtags.length === 0) {
            const dbHashtags = await db.getRandomHashtags(5);
            if (dbHashtags.length === 0) {
                return Response.json(
                    {
                        success: false,
                        error: 'No hashtags provided and no hashtags in database',
                    },
                    { status: 400 }
                );
            }
            hashtags = dbHashtags.map(h => h.text);
            logger.info('Auto-selected hashtags from database', { count: hashtags.length });
        }

        logger.info('Post reel request received', {
            captionLength: caption.length,
            hookText,
            hashtagCount: hashtags.length,
            shareToFeed,
        });

        // Step 1: Select and download prioritized video from GCS (newest unused first)
        logger.info('Step 1: Selecting prioritized video from storage');
        const postedVideos = await db.getPostedVideoTitles();
        const { videoFile, localPath } = await videoSelector.getPrioritizedVideo(postedVideos);

        logger.info('Video selected', {
            videoName: videoFile.name,
            localPath,
            createdAt: videoFile.createdAt.toISOString(),
        });

        // Step 2: Create database records and pending post
        logger.info('Step 2: Creating database records');

        // Upsert caption, hook, and hashtags
        const dbCaption = await db.upsertCaption(caption);
        const dbHook = await db.upsertHook(hookText);
        const dbVideo = await db.upsertVideo(videoFile.name);

        // Upsert all hashtags and get their IDs
        const hashtagIds: number[] = [];
        for (const tag of hashtags) {
            const dbHashtag = await db.upsertHashtag(tag);
            hashtagIds.push(dbHashtag.id);
        }

        // Find or create hashtag combination
        const hashtagCombination = await db.findOrCreateHashtagCombination(hashtagIds);

        // Create post with pending status
        const post = await db.createPost(
            dbVideo.id,
            dbHook.id,
            dbCaption.id,
            hashtagCombination.id,
            shareToFeed || false
        );

        logger.info('Database records created', {
            postId: post.id,
            videoId: dbVideo.id,
            captionId: dbCaption.id,
            hookId: dbHook.id,
            hashtagCombinationId: hashtagCombination.id,
        });

        // Start background processing (fire-and-forget)
        // Using setImmediate to ensure the response is sent first
        setImmediate(() => {
            processPostInBackground(
                post.id,
                localPath,
                hookText,
                caption,
                hashtags,
                shareToFeed || false,
                db
            ).catch((err) => {
                // This catch is a safety net - errors should be handled inside processPostInBackground
                logger.error('Unhandled error in background processing', {
                    postId: post.id,
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
            });
        });

        // Return accepted response immediately
        const response: PostReelResponse = {
            success: true,
            postId: post.id,
            message: 'Post request accepted. Use /api/post-status?postId=' + post.id + ' to check status.',
        };

        return Response.json(response, { status: 202 });
    } catch (error) {
        logger.error('Error handling post reel request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            },
            { status: 500 }
        );
    }
}
