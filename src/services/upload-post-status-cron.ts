import { DatabaseService } from './database.js';
import { UploadPostClientService } from './upload-post-client.js';
import { VideoSelectorService } from './video-selector.js';
import { logger } from '../utils/logger.js';
import type { UploadPostCredentials, PendingUploadPostPost, DbAccount } from '../types/index.js';

export interface TickResult {
    scanned: number;
    completed: number;
    failed: number;
    stillPending: number;
    errors: number;
}

export class UploadPostStatusCronService {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private db: DatabaseService;
    private isRunning: boolean = false;

    private static readonly TICK_INTERVAL_MS = 10_000;

    /** Delay between per-post Upload-Post status calls. Overridable for tests. */
    static THROTTLE_MS = 200;

    /** Age at which a stuck `pending` row is forcibly failed without calling Upload-Post. */
    static SAFETY_NET_MS = 60 * 60 * 1000;

    /** Grace period before `not_found` is treated as terminal failure. */
    static NOT_FOUND_GRACE_MS = 5 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
    }

    start(): void {
        if (this.timer) {
            logger.warn('Upload-Post status cron job already running');
            return;
        }
        this.timer = setTimeout(() => this.runAndScheduleNext(), UploadPostStatusCronService.TICK_INTERVAL_MS);
        logger.info('Upload-Post status cron job started', {
            intervalMs: UploadPostStatusCronService.TICK_INTERVAL_MS,
        });
    }

    private runAndScheduleNext(): void {
        this.tick().catch((err) => {
            logger.error('Upload-Post status cron tick threw unexpectedly', {
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }).finally(() => {
            this.timer = setTimeout(() => this.runAndScheduleNext(), UploadPostStatusCronService.TICK_INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Upload-Post status cron job stopped');
        }
    }

    /**
     * Single pass over all in-flight Upload-Post posts. Public for direct invocation
     * from tests; the cron loop calls this once every TICK_INTERVAL_MS.
     */
    async tick(): Promise<TickResult> {
        if (this.isRunning) {
            logger.debug('Upload-Post status cron tick already in progress, skipping');
            return { scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 };
        }
        this.isRunning = true;

        const result: TickResult = { scanned: 0, completed: 0, failed: 0, stillPending: 0, errors: 0 };

        try {
            const posts = await this.db.getPendingUploadPostPosts();
            result.scanned = posts.length;
            if (posts.length === 0) {
                return result;
            }

            const now = Date.now();
            for (let i = 0; i < posts.length; i++) {
                const post = posts[i];
                const ageMs = now - new Date(post.upload_post_submitted_at).getTime();

                // Every per-row path needs the account (for GCS bucket name) so look it up first.
                const acct = await this.db.getPostAccount(post.id);
                if (!acct) {
                    logger.warn('Upload-Post status cron: account not found for post', { postId: post.id });
                    result.errors += 1;
                    continue;
                }

                // 1h safety net: flip stuck rows to failed without calling Upload-Post.
                if (ageMs >= UploadPostStatusCronService.SAFETY_NET_MS) {
                    logger.error('Upload-Post status cron: row exceeded 1h, marking failed', {
                        postId: post.id,
                        requestId: post.upload_post_request_id,
                        submittedAt: post.upload_post_submitted_at,
                    });
                    await this.markFailedAndCleanup(post, acct);
                    result.failed += 1;
                    continue;
                }

                try {
                    const credential = await this.db.getCredentialsByPlatform(acct.id, 'upload_post');
                    if (!credential) {
                        logger.warn('Upload-Post status cron: missing upload_post credential for post', {
                            postId: post.id,
                            accountId: acct.id,
                        });
                        result.errors += 1;
                        continue;
                    }
                    const upCreds = credential.credentials as UploadPostCredentials;

                    const client = new UploadPostClientService(upCreds.api_key, upCreds.user);
                    const status = await client.getUploadStatus(post.upload_post_request_id);

                    if (status.status === 'completed') {
                        await this.db.markPostSuccess(post.id, status.instagramPostId);
                        if (post.edited_video_url) {
                            await this.safeDeleteEditedVideo(post.edited_video_url, acct);
                        }
                        if (post.pending_user_id && post.pending_user_name) {
                            try {
                                await this.db.createUserPost(post.id, post.pending_user_id, post.pending_user_name);
                            } catch (e) {
                                logger.warn('Upload-Post status cron: createUserPost failed (non-fatal)', {
                                    postId: post.id,
                                    error: e instanceof Error ? e.message : 'Unknown error',
                                });
                            }
                        }
                        result.completed += 1;
                        continue;
                    }

                    if (status.status === 'failed') {
                        logger.error('Upload-Post status cron: status=failed', {
                            postId: post.id,
                            requestId: post.upload_post_request_id,
                            results: (status.data as Record<string, unknown>)?.results,
                        });
                        await this.markFailedAndCleanup(post, acct);
                        result.failed += 1;
                        continue;
                    }

                    if (status.status === 'not_found') {
                        if (ageMs >= UploadPostStatusCronService.NOT_FOUND_GRACE_MS) {
                            logger.error('Upload-Post status cron: not_found beyond grace period, marking failed', {
                                postId: post.id,
                                requestId: post.upload_post_request_id,
                                ageMs,
                            });
                            await this.markFailedAndCleanup(post, acct);
                            result.failed += 1;
                        } else {
                            logger.debug('Upload-Post status cron: not_found within grace period, deferring', {
                                postId: post.id,
                            });
                            result.stillPending += 1;
                        }
                        continue;
                    }

                    // status === 'unknown' or in-progress → leave alone.
                    if (status.status === 'unknown') {
                        logger.error('Upload-Post status cron: unrecognized status, deferring to safety net', {
                            postId: post.id,
                            raw: status.raw,
                        });
                    }
                    result.stillPending += 1;
                } catch (err) {
                    logger.warn('Upload-Post status cron: per-post error, will retry next tick', {
                        postId: post.id,
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                    result.errors += 1;
                }

                if (i < posts.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, UploadPostStatusCronService.THROTTLE_MS));
                }
            }

            logger.info('Upload-Post status sync completed', result);
        } catch (error) {
            logger.error('Upload-Post status cron tick failed before loop completed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return result;
    }

    private async markFailedAndCleanup(post: PendingUploadPostPost, acct: DbAccount): Promise<void> {
        await this.db.updatePostStatus(post.id, 'failed');
        if (post.edited_video_url) {
            await this.safeDeleteEditedVideo(post.edited_video_url, acct);
        }
    }

    private async safeDeleteEditedVideo(url: string, acct: DbAccount): Promise<void> {
        try {
            // VideoSelectorService.deleteEditedVideo requires this.bucketName to match the
            // URL prefix (`https://storage.googleapis.com/${bucketName}/`), so we must
            // construct it with the account's actual bucket.
            const selector = new VideoSelectorService(acct.gcs_bucket_name);
            await selector.deleteEditedVideo(url);
        } catch (err) {
            logger.warn('Upload-Post status cron: deleteEditedVideo failed (non-fatal)', {
                url,
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }
}
