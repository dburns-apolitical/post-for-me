import { DatabaseService } from './database.js';
import { UploadPostClientService } from './upload-post-client.js';
import { logger } from '../utils/logger.js';
import type { UploadPostCredentials } from '../types/index.js';

export class ImpressionsSyncCronService {
    private timer: Timer | null = null;
    private db: DatabaseService;
    private isRunning: boolean = false;

    private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
    }

    start(): void {
        if (this.timer) {
            logger.warn('Impressions sync cron job already running');
            return;
        }

        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        setTimeout(() => {
            this.runAndScheduleNext();
        }, msUntilMidnight);

        logger.info('Impressions sync cron job started', {
            nextRunAt: nextMidnight.toISOString(),
            msUntilFirstRun: msUntilMidnight,
        });
    }

    private runAndScheduleNext(): void {
        this.syncImpressions().finally(() => {
            this.timer = setTimeout(() => {
                this.runAndScheduleNext();
            }, ImpressionsSyncCronService.INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Impressions sync cron job stopped');
        }
    }

    async syncImpressions(): Promise<{ updated: number; failed: number }> {
        if (this.isRunning) {
            logger.warn('Impressions sync already in progress, skipping');
            return { updated: 0, failed: 0 };
        }

        this.isRunning = true;
        logger.info('Starting impressions sync...');

        let updated = 0;
        let failed = 0;

        try {
            const accounts = await this.db.getAccounts();

            if (accounts.length === 0) {
                logger.info('No accounts to sync impressions for');
                return { updated: 0, failed: 0 };
            }

            logger.info('Syncing impressions for accounts', { count: accounts.length });

            const today = new Date();

            for (const account of accounts) {
                try {
                    const credential = await this.db.getCredentialsByPlatform(account.id, 'upload_post');
                    if (!credential) {
                        logger.warn('No upload_post credentials for account, skipping', { accountId: account.id });
                        failed++;
                        continue;
                    }

                    const creds = credential.credentials as UploadPostCredentials;
                    const uploadPost = new UploadPostClientService(creds.api_key, creds.user);
                    const counts = await uploadPost.getTotalImpressions(creds.user);
                    await this.db.insertDailyImpressions(account.id, today, counts);

                    logger.info('Recorded daily impressions', { accountId: account.id, ...counts });
                    updated++;
                } catch (error) {
                    logger.error('Failed to sync impressions for account', {
                        accountId: account.id,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                    failed++;
                }
            }

            logger.info('Impressions sync completed', { updated, failed, total: accounts.length });
        } catch (error) {
            logger.error('Impressions sync failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return { updated, failed };
    }
}
