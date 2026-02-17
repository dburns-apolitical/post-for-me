import { runEvaluation } from './agent.js';
import { logger } from '../utils/logger.js';

export class AgentEvalCronService {
    private timer: Timer | null = null;
    private isRunning: boolean = false;

    // 7 days in milliseconds
    private static readonly INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

    start(): void {
        if (this.timer) {
            logger.warn('Agent eval cron job already running');
            return;
        }

        // Calculate milliseconds until next Sunday midnight UTC
        const now = new Date();
        const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
        const nextSunday = new Date(now);
        nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
        nextSunday.setUTCHours(0, 0, 0, 0);
        const msUntilSunday = nextSunday.getTime() - now.getTime();

        setTimeout(() => {
            this.runAndScheduleNext();
        }, msUntilSunday);

        logger.info('Agent eval cron job started', {
            nextRunAt: nextSunday.toISOString(),
            msUntilFirstRun: msUntilSunday,
        });
    }

    private runAndScheduleNext(): void {
        this.evaluate().finally(() => {
            this.timer = setTimeout(() => {
                this.runAndScheduleNext();
            }, AgentEvalCronService.INTERVAL_MS);
        });
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Agent eval cron job stopped');
        }
    }

    async evaluate(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Agent eval already in progress, skipping');
            return;
        }

        this.isRunning = true;

        try {
            const evaluation = await runEvaluation('cron');
            logger.info('Cron agent evaluation completed', { evaluationId: evaluation.id });
        } catch (error) {
            logger.error('Cron agent evaluation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            this.isRunning = false;
        }
    }
}
