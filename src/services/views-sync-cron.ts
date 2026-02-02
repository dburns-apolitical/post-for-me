import { DatabaseService } from './database.js';
import { InstagramClientService } from './instagram-client.js';
import { logger } from '../utils/logger.js';

export class ViewsSyncCronService {
    private timer: Timer | null = null;
    private db: DatabaseService;
    private instagram: InstagramClientService;
    private isRunning: boolean = false;

    // 24 hours in milliseconds
    private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
        this.instagram = new InstagramClientService();
    }

    /**
     * Start the daily views sync cron job
     * Runs once per day (every 24 hours)
     */
    start(): void {
        if (this.timer) {
            logger.warn('Views sync cron job already running');
            return;
        }

        // Calculate milliseconds until next midnight UTC
        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        // Schedule first run at midnight UTC, then repeat every 24 hours
        setTimeout(() => {
            this.runAndScheduleNext();
        }, msUntilMidnight);

        logger.info('Views sync cron job started', {
            nextRunAt: nextMidnight.toISOString(),
            msUntilFirstRun: msUntilMidnight,
        });
    }

    /**
     * Run sync and schedule the next one
     */
    private runAndScheduleNext(): void {
        this.syncViews().finally(() => {
            // Schedule next run in 24 hours
            this.timer = setTimeout(() => {
                this.runAndScheduleNext();
            }, ViewsSyncCronService.INTERVAL_MS);
        });
    }

    /**
     * Stop the cron job
     */
    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Views sync cron job stopped');
        }
    }

    /**
     * Sync views for all eligible posts
     * Can also be called manually for testing
     */
    async syncViews(): Promise<{ updated: number; failed: number }> {
        if (this.isRunning) {
            logger.warn('Views sync already in progress, skipping');
            return { updated: 0, failed: 0 };
        }

        this.isRunning = true;
        logger.info('Starting views sync...');

        let updated = 0;
        let failed = 0;

        try {
            const posts = await this.db.getPostsNeedingViewsUpdate();

            if (posts.length === 0) {
                logger.info('No posts need views update');
                return { updated: 0, failed: 0 };
            }

            logger.info('Found posts needing views update', { count: posts.length });

            for (const post of posts) {
                try {
                    if (!post.instagram_post_id) {
                        logger.warn('Post missing instagram_post_id, skipping', { postId: post.id });
                        failed++;
                        continue;
                    }

                    const views = await this.instagram.getMediaInsights(post.instagram_post_id);
                    await this.db.updatePostViews(post.id, views);

                    logger.info('Updated views for post', {
                        postId: post.id,
                        instagramPostId: post.instagram_post_id,
                        views,
                    });

                    updated++;
                } catch (error) {
                    logger.error('Failed to update views for post', {
                        postId: post.id,
                        instagramPostId: post.instagram_post_id,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                    failed++;
                }
            }

            logger.info('Views sync completed', { updated, failed, total: posts.length });
        } catch (error) {
            logger.error('Views sync failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return { updated, failed };
    }
}
