import { logger } from '../utils/logger.js';
import { validatePostReelRequest } from '../utils/validation.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { PostReelResponse, DbAccount, UploadPostCredentials } from '../types/index.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { VideoEditorService } from '../services/video-editor.js';
import { UploadPostClientService } from '../services/upload-post-client.js';
import { DatabaseService } from '../services/database.js';

/**
 * Background processing function that handles video editing and Upload-Post submission.
 * This runs asynchronously after the HTTP response has been sent. The actual status of the
 * Upload-Post job is tracked by UploadPostStatusCronService — this function exits as soon
 * as the submission is accepted (or fails immediately).
 */
async function processPostInBackground(
    postId: number,
    account: DbAccount,
    inputVideoPath: string,
    hookText: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean,
    db: DatabaseService,
    userId?: string,
    userName?: string
): Promise<void> {
    let editedVideoPath: string | null = null;
    let editedVideoUrl: string | null = null;
    const videoSelector = new VideoSelectorService(account.gcs_bucket_name);
    const videoEditor = new VideoEditorService();

    try {
        // Step 3: Validate video format
        logger.info('Step 3: Validating video format', { postId });
        const validation_result = await videoEditor.validateVideoFormat(inputVideoPath);
        if (!validation_result.isValid) {
            logger.warn('Video format validation failed', { postId, ...validation_result });
        }

        // Step 4: Add text overlay
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
        editedVideoUrl = await videoSelector.uploadEditedVideo(editedVideoPath);
        logger.info('Edited video uploaded', { postId, videoUrl: editedVideoUrl });

        // Step 6: Submit to Upload-Post (async). Persist the request_id BEFORE the network call
        // so a crash mid-submission still leaves a row the cron can pick up. The X-Request-Id
        // header makes the submission idempotent if the request is retried.
        logger.info('Step 6: Submitting Reel to Upload-Post', { postId });

        const upCredential = await db.getCredentialsByPlatform(account.id, 'upload_post');
        if (!upCredential) {
            throw new Error(`No upload_post credentials for account ${account.id}`);
        }
        const upCreds = upCredential.credentials as UploadPostCredentials;
        const platforms: string[] = [];
        if (upCreds.youtube) platforms.push('youtube');
        if (upCreds.tiktok) platforms.push('tiktok');
        if (upCreds.twitter) platforms.push('x');
        if (upCreds.instagram) platforms.push('instagram');
        if (platforms.length === 0) {
            throw new Error(`Account ${account.id} has upload_post credentials but no platforms enabled`);
        }

        const requestId = crypto.randomUUID();
        await db.markUploadPostSubmitting(postId, requestId, editedVideoUrl, userId, userName);

        const uploadPostClient = new UploadPostClientService(upCreds.api_key, upCreds.user);
        await uploadPostClient.postVideoAsync({
            requestId,
            videoUrl: editedVideoUrl,
            caption,
            hashtags,
            platforms,
            shareToFeed,
        });

        logger.info('Upload-Post submission accepted; cron will track to completion', {
            postId,
            requestId,
            platforms,
        });

        // Cleanup local files. The GCS edited video stays until the cron sees a terminal status.
        videoSelector.cleanupTempFile(inputVideoPath);
        videoEditor.cleanupTempFile(editedVideoPath);
    } catch (error) {
        logger.error('Error in background post submission', {
            postId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });

        try {
            await db.updatePostStatus(postId, 'failed');
            logger.info('Post status updated to failed', { postId });
        } catch (dbError) {
            logger.warn('Failed to update post status to failed', {
                postId,
                error: dbError instanceof Error ? dbError.message : 'Unknown error',
            });
        }

        try { videoSelector.cleanupTempFile(inputVideoPath); } catch { /* ignore */ }
        if (editedVideoPath) {
            try { videoEditor.cleanupTempFile(editedVideoPath); } catch { /* ignore */ }
        }
        if (editedVideoUrl) {
            await videoSelector.deleteEditedVideo(editedVideoUrl);
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

        // Get values from request or auto-select from database
        let { caption, hookText, hashtags, shareToFeed } = validation.data;
        const accountId = validation.data.accountId;

        // Fetch account from DB
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: `Account ${accountId} not found` },
                { status: 404 }
            );
        }

        // Initialize video selector service
        const videoSelector = new VideoSelectorService(account.gcs_bucket_name);

        // Auto-select caption from database if not provided
        if (!caption) {
            const dbCaption = await db.getRandomCaption(accountId);
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
            const dbHook = await db.getRandomHook(accountId);
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
            const dbHashtags = await db.getRandomHashtags(accountId, 5);
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
            accountId,
            videoTitle: validation.data.videoTitle || null,
        });

        // Step 1: Select video - use videoTitle if provided, otherwise prioritized selection
        logger.info('Step 1: Selecting video from storage');
        const postedVideos = await db.getPostedVideoTitles(accountId);

        let videoFile;
        let localPath;
        const requestedTitle = validation.data.videoTitle;

        if (requestedTitle) {
            logger.info('Attempting to find requested video', { videoTitle: requestedTitle });
            const foundVideo = await videoSelector.findVideoByTitle(requestedTitle);

            if (foundVideo) {
                videoFile = foundVideo;
                localPath = await videoSelector.downloadVideo(foundVideo);
                logger.info('Using requested video', { videoName: videoFile.name });
            } else {
                logger.info('Requested video not found, falling back to prioritized selection', {
                    videoTitle: requestedTitle
                });
                const result = await videoSelector.getPrioritizedVideo(postedVideos);
                videoFile = result.videoFile;
                localPath = result.localPath;
            }
        } else {
            const result = await videoSelector.getPrioritizedVideo(postedVideos);
            videoFile = result.videoFile;
            localPath = result.localPath;
        }

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
            shareToFeed || false,
            accountId
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
                account,
                localPath,
                hookText,
                caption,
                hashtags,
                shareToFeed || false,
                db,
                authResult.userId,
                authResult.userName
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
