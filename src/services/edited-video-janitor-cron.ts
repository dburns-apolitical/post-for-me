import { DatabaseService } from './database.js';
import { VideoSelectorService } from './video-selector.js';
import { logger } from '../utils/logger.js';

export interface JanitorTickResult {
    scannedBuckets: number;
    scannedObjects: number;
    deleted: number;
    errors: number;
}

/**
 * Background janitor that deletes orphaned edited videos from GCS.
 *
 * Why this exists: there is a narrow window in two places where the process
 * can die between `db.updatePostStatus(postId, 'failed')` and the follow-up
 * `videoSelector.deleteEditedVideo(...)` call — see
 * `src/routes/post-reel.ts` (background catch block) and
 * `src/services/upload-post-status-cron.ts:markFailedAndCleanup`. When that
 * happens, the edited video stays in GCS with no DB pointer.
 *
 * Any `edited/*` object older than 24h is guaranteed orphaned because the
 * upload-post status cron's 1h safety net flips all stale pending rows to
 * terminal status (and either deletes the GCS object on success or attempts to
 * on failure). So a >24h threshold is safely outside the in-flight TTL.
 */
export class EditedVideoJanitorCronService {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private db: DatabaseService;
    private isRunning: boolean = false;

    /** Hourly tick is plenty — the leak is rare and the threshold is 24h. */
    private static readonly TICK_INTERVAL_MS = 60 * 60 * 1000;

    /** Objects younger than this are still in-flight or recently cleaned up. */
    static AGE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.db = new DatabaseService();
    }

    start(): void {
        if (this.timer) {
            logger.warn('Edited video janitor cron already running');
            return;
        }
        this.timer = setTimeout(() => this.runAndScheduleNext(), EditedVideoJanitorCronService.TICK_INTERVAL_MS);
        logger.info('Edited video janitor cron started', {
            intervalMs: EditedVideoJanitorCronService.TICK_INTERVAL_MS,
            ageThresholdMs: EditedVideoJanitorCronService.AGE_THRESHOLD_MS,
        });
    }

    private runAndScheduleNext(): void {
        this.tick().catch((err) => {
            logger.error('Edited video janitor tick threw unexpectedly', {
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }).finally(() => {
            this.timer = setTimeout(() => this.runAndScheduleNext(), EditedVideoJanitorCronService.TICK_INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Edited video janitor cron stopped');
        }
    }

    /**
     * Single pass: for each distinct account bucket, list every `edited/*`
     * object and delete the ones older than AGE_THRESHOLD_MS. Public for
     * direct invocation from tests.
     */
    async tick(): Promise<JanitorTickResult> {
        if (this.isRunning) {
            logger.debug('Edited video janitor tick already in progress, skipping');
            return { scannedBuckets: 0, scannedObjects: 0, deleted: 0, errors: 0 };
        }
        this.isRunning = true;

        const result: JanitorTickResult = { scannedBuckets: 0, scannedObjects: 0, deleted: 0, errors: 0 };

        try {
            const accounts = await this.db.getAccounts();
            const buckets = Array.from(
                new Set(accounts.map((a) => a.gcs_bucket_name).filter((name) => name && name.length > 0)),
            );

            const cutoff = Date.now() - EditedVideoJanitorCronService.AGE_THRESHOLD_MS;

            for (const bucket of buckets) {
                result.scannedBuckets += 1;
                try {
                    const selector = new VideoSelectorService(bucket);
                    const objects = await selector.listEditedVideos();
                    result.scannedObjects += objects.length;

                    for (const obj of objects) {
                        if (obj.timeCreated.getTime() < cutoff) {
                            const publicUrl = `https://storage.googleapis.com/${bucket}/${obj.name}`;
                            await selector.deleteEditedVideo(publicUrl);
                            result.deleted += 1;
                        }
                    }
                } catch (err) {
                    result.errors += 1;
                    logger.warn('Edited video janitor: bucket-level error, continuing', {
                        bucket,
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }

            logger.info('Edited video janitor tick completed', result);
        } catch (error) {
            logger.error('Edited video janitor tick failed before loop completed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }

        return result;
    }
}
