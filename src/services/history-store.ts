import { logger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import * as fs from 'fs';
import * as path from 'path';

export interface HistoryData {
    postedVideos: string[];
    captions: string[];
    hookTexts: string[];
    hashtags: string[];
}

const DEFAULT_HISTORY: HistoryData = {
    postedVideos: [],
    captions: [],
    hookTexts: [],
    hashtags: [],
};

export class HistoryStoreService {
    private filePath: string;

    constructor() {
        const config = getConfig();
        this.filePath = config.historyFilePath;

        // Ensure data directory exists
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Load history from JSON file (returns empty defaults if not exists)
     */
    load(): HistoryData {
        try {
            if (!fs.existsSync(this.filePath)) {
                logger.debug('History file does not exist, returning defaults', { filePath: this.filePath });
                return { ...DEFAULT_HISTORY };
            }

            const content = fs.readFileSync(this.filePath, 'utf-8');
            const data = JSON.parse(content) as HistoryData;

            logger.debug('History loaded', {
                postedVideos: data.postedVideos.length,
                captions: data.captions.length,
                hookTexts: data.hookTexts.length,
                hashtags: data.hashtags.length,
            });

            return data;
        } catch (error) {
            logger.error('Error loading history file', {
                error: error instanceof Error ? error.message : 'Unknown error',
                filePath: this.filePath,
            });
            return { ...DEFAULT_HISTORY };
        }
    }

    /**
     * Save history to JSON file
     */
    save(data: HistoryData): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
            logger.debug('History saved', { filePath: this.filePath });
        } catch (error) {
            logger.error('Error saving history file', {
                error: error instanceof Error ? error.message : 'Unknown error',
                filePath: this.filePath,
            });
            throw new Error('Failed to save history');
        }
    }

    /**
     * Record a successful post (deduplicates hashtags before saving)
     */
    addPost(video: string, caption: string, hookText: string, hashtags: string[]): void {
        const data = this.load();

        // Add video to posted list (allow duplicates to track usage count if needed)
        if (!data.postedVideos.includes(video)) {
            data.postedVideos.push(video);
        }

        // Add caption if not already present
        if (!data.captions.includes(caption)) {
            data.captions.push(caption);
        }

        // Add hook text if not already present
        if (!data.hookTexts.includes(hookText)) {
            data.hookTexts.push(hookText);
        }

        // Add hashtags, keeping the list unique
        const existingHashtags = new Set(data.hashtags);
        for (const tag of hashtags) {
            existingHashtags.add(tag);
        }
        data.hashtags = Array.from(existingHashtags);

        this.save(data);

        logger.info('Post recorded in history', {
            video,
            totalPostedVideos: data.postedVideos.length,
            totalCaptions: data.captions.length,
            totalHookTexts: data.hookTexts.length,
            totalHashtags: data.hashtags.length,
        });
    }

    /**
     * Get list of previously posted video names
     */
    getPostedVideos(): string[] {
        return this.load().postedVideos;
    }

    /**
     * Select a random caption from history
     * Returns null if no captions in history
     */
    getRandomCaption(): string | null {
        const captions = this.load().captions;
        if (captions.length === 0) {
            return null;
        }
        const randomIndex = Math.floor(Math.random() * captions.length);
        return captions[randomIndex];
    }

    /**
     * Select a random hook text from history
     * Returns null if no hook texts in history
     */
    getRandomHookText(): string | null {
        const hookTexts = this.load().hookTexts;
        if (hookTexts.length === 0) {
            return null;
        }
        const randomIndex = Math.floor(Math.random() * hookTexts.length);
        return hookTexts[randomIndex];
    }

    /**
     * Select unique random hashtags from history
     * Returns up to `count` hashtags (default 5)
     * Returns null if no hashtags in history
     */
    getRandomHashtags(count: number = 5): string[] | null {
        const hashtags = this.load().hashtags;
        if (hashtags.length === 0) {
            return null;
        }

        // Shuffle and take up to `count` unique hashtags
        const shuffled = [...hashtags].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, shuffled.length));
    }
}
