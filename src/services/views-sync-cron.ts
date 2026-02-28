import { DatabaseService } from './database.js';
import { InstagramClientService } from './instagram-client.js';
import { logger } from '../utils/logger.js';

export class ViewsSyncCronService {
    private timer: Timer | null = null;
    private db: DatabaseService;
    private isRunning: boolean = false;

    private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
    }

    start(): void {
        if (this.timer) {
            logger.warn('Views sync cron job already running');
            return;
        }

        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        setTimeout(() => {
            this.runAndScheduleNext();
        }, msUntilMidnight);

        logger.info('Views sync cron job started', {
            nextRunAt: nextMidnight.toISOString(),
            msUntilFirstRun: msUntilMidnight,
        });
    }

    private runAndScheduleNext(): void {
        this.syncViews().finally(() => {
            this.timer = setTimeout(() => {
                this.runAndScheduleNext();
            }, ViewsSyncCronService.INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Views sync cron job stopped');
        }
    }

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

            // Load all accounts for credential lookup
            const accounts = await this.db.getAccounts();
            const accountMap = new Map(accounts.map(a => [a.id, a]));

            for (const post of posts) {
                try {
                    if (!post.instagram_post_id) {
                        logger.warn('Post missing instagram_post_id, skipping', { postId: post.id });
                        failed++;
                        continue;
                    }

                    const account = accountMap.get(post.account_id);
                    if (!account) {
                        logger.warn('Account not found for post, skipping', { postId: post.id, accountId: post.account_id });
                        failed++;
                        continue;
                    }

                    const instagram = new InstagramClientService(account.ig_access_token, account.ig_user_id);
                    const views = await instagram.getMediaInsights(post.instagram_post_id);
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
