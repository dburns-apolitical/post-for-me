import { logger } from '../utils/logger.js';
import { validatePostReelRequest } from '../utils/validation.js';
import type { PostReelResponse } from '../types/index.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { VideoEditorService } from '../services/video-editor.js';
import { InstagramClientService } from '../services/instagram-client.js';
import { DatabaseService } from '../services/database.js';

export async function handlePostReel(request: Request): Promise<Response> {
    let inputVideoPath: string | null = null;
    let editedVideoPath: string | null = null;
    let postId: number | null = null;
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

        // Initialize services
        const videoSelector = new VideoSelectorService();
        const videoEditor = new VideoEditorService();
        const instagramClient = new InstagramClientService();

        // Get values from request or auto-select from database
        let { caption, hookText, hashtags } = validation.data;

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
        });

        // Step 1: Select and download prioritized video from GCS (newest unused first)
        logger.info('Step 1: Selecting prioritized video from storage');
        const postedVideos = await db.getPostedVideoTitles();
        const { videoFile, localPath } = await videoSelector.getPrioritizedVideo(postedVideos);
        inputVideoPath = localPath;

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
            hashtagCombination.id
        );
        postId = post.id;

        logger.info('Database records created', {
            postId: post.id,
            videoId: dbVideo.id,
            captionId: dbCaption.id,
            hookId: dbHook.id,
            hashtagCombinationId: hashtagCombination.id,
        });

        // Step 3: Validate video format
        logger.info('Step 3: Validating video format');
        const validation_result = await videoEditor.validateVideoFormat(inputVideoPath);

        if (!validation_result.isValid) {
            logger.warn('Video format validation failed', validation_result);
            // Continue anyway, but log the warning
            // In production, you might want to retry with another video
        }

        // Step 4: Add text overlay to video
        logger.info('Step 4: Adding text overlay to video');
        editedVideoPath = await videoEditor.addTextOverlay(inputVideoPath, hookText, {
            position: 'top',
            fontSize: 60,
            fontColor: 'white',
            strokeColor: 'black',
            strokeWidth: 3,
        });

        logger.info('Video edited successfully', {
            editedPath: editedVideoPath,
        });

        // Step 5: Upload edited video to GCS
        logger.info('Step 5: Uploading edited video to GCS');
        const videoUrl = await videoSelector.uploadEditedVideo(editedVideoPath);

        logger.info('Edited video uploaded', {
            videoUrl,
        });

        // Step 6: Post to Instagram
        logger.info('Step 6: Posting Reel to Instagram');
        const instagramPost = await instagramClient.postReel(
            videoUrl,
            caption,
            hashtags
        );

        logger.info('Reel posted successfully', {
            postId: instagramPost.id,
            status: instagramPost.status,
        });

        // Step 7: Update post status to success with Instagram post ID
        logger.info('Step 7: Updating post status to success');
        await db.markPostSuccess(postId, instagramPost.id);

        // Step 8: Cleanup temporary files
        logger.info('Step 8: Cleaning up temporary files');
        videoSelector.cleanupTempFile(inputVideoPath);
        videoEditor.cleanupTempFile(editedVideoPath);

        // Return success response
        const response: PostReelResponse = {
            success: true,
            postId: instagramPost.id,
            videoUsed: videoFile.path,
        };

        return Response.json(response, { status: 200 });
    } catch (error) {
        logger.error('Error handling post reel request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        // Update post status to failed if we have a post ID
        if (postId) {
            try {
                await db.updatePostStatus(postId, 'failed');
                logger.info('Post status updated to failed', { postId });
            } catch (dbError) {
                logger.warn('Failed to update post status to failed', {
                    postId,
                    error: dbError instanceof Error ? dbError.message : 'Unknown error',
                });
            }
        }

        // Cleanup temporary files on error
        if (inputVideoPath) {
            try {
                const videoSelector = new VideoSelectorService();
                videoSelector.cleanupTempFile(inputVideoPath);
            } catch (cleanupError) {
                logger.warn('Failed to cleanup input video on error', { inputVideoPath });
            }
        }

        if (editedVideoPath) {
            try {
                const videoEditor = new VideoEditorService();
                videoEditor.cleanupTempFile(editedVideoPath);
            } catch (cleanupError) {
                logger.warn('Failed to cleanup edited video on error', { editedVideoPath });
            }
        }

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            },
            { status: 500 }
        );
    }
}
