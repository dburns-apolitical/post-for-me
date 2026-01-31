import { logger } from '../utils/logger.js';
import { validatePostReelRequest } from '../utils/validation.js';
import type { PostReelResponse } from '../types/index.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { VideoEditorService } from '../services/video-editor.js';
import { InstagramClientService } from '../services/instagram-client.js';
import { HistoryStoreService } from '../services/history-store.js';

export async function handlePostReel(request: Request): Promise<Response> {
    let inputVideoPath: string | null = null;
    let editedVideoPath: string | null = null;

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
        const historyStore = new HistoryStoreService();

        // Get values from request or auto-select from history
        let { caption, hookText, hashtags } = validation.data;

        // Auto-select caption from history if not provided
        if (!caption) {
            const historyCaption = historyStore.getRandomCaption();
            if (!historyCaption) {
                return Response.json(
                    {
                        success: false,
                        error: 'No caption provided and no captions in history',
                    },
                    { status: 400 }
                );
            }
            caption = historyCaption;
            logger.info('Auto-selected caption from history');
        }

        // Auto-select hookText from history if not provided
        if (!hookText) {
            const historyHookText = historyStore.getRandomHookText();
            if (!historyHookText) {
                return Response.json(
                    {
                        success: false,
                        error: 'No hookText provided and no hook texts in history',
                    },
                    { status: 400 }
                );
            }
            hookText = historyHookText;
            logger.info('Auto-selected hookText from history');
        }

        // Auto-select hashtags from history if not provided (default 5)
        if (!hashtags || hashtags.length === 0) {
            const historyHashtags = historyStore.getRandomHashtags(5);
            if (!historyHashtags) {
                return Response.json(
                    {
                        success: false,
                        error: 'No hashtags provided and no hashtags in history',
                    },
                    { status: 400 }
                );
            }
            hashtags = historyHashtags;
            logger.info('Auto-selected hashtags from history', { count: hashtags.length });
        }

        logger.info('Post reel request received', {
            captionLength: caption.length,
            hookText,
            hashtagCount: hashtags.length,
        });

        // Step 1: Select and download prioritized video from GCS (newest unused first)
        logger.info('Step 1: Selecting prioritized video from storage');
        const postedVideos = historyStore.getPostedVideos();
        const { videoFile, localPath } = await videoSelector.getPrioritizedVideo(postedVideos);
        inputVideoPath = localPath;

        logger.info('Video selected', {
            videoName: videoFile.name,
            localPath,
            createdAt: videoFile.createdAt.toISOString(),
        });

        // Step 2: Validate video format
        logger.info('Step 2: Validating video format');
        const validation_result = await videoEditor.validateVideoFormat(inputVideoPath);

        if (!validation_result.isValid) {
            logger.warn('Video format validation failed', validation_result);
            // Continue anyway, but log the warning
            // In production, you might want to retry with another video
        }

        // Step 3: Add text overlay to video
        logger.info('Step 3: Adding text overlay to video');
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

        // Step 4: Upload edited video to GCS
        logger.info('Step 4: Uploading edited video to GCS');
        const videoUrl = await videoSelector.uploadEditedVideo(editedVideoPath);

        logger.info('Edited video uploaded', {
            videoUrl,
        });

        // Step 5: Post to Instagram
        logger.info('Step 5: Posting Reel to Instagram');
        const instagramPost = await instagramClient.postReel(
            videoUrl,
            caption,
            hashtags
        );

        logger.info('Reel posted successfully', {
            postId: instagramPost.id,
            status: instagramPost.status,
        });

        // Step 6: Save post to history
        logger.info('Step 6: Saving post to history');
        historyStore.addPost(videoFile.name, caption, hookText, hashtags);

        // Step 7: Cleanup temporary files
        logger.info('Step 7: Cleaning up temporary files');
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
