import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type {
    PostStatus,
    DbAccount,
    DbCaption,
    DbHashtag,
    DbHook,
    DbHashtagCombination,
    DbVideo,
    DbPost,
    PostWithDetails,
} from '../types/index.js';

export class DatabaseService {
    private sql: ReturnType<typeof neon>;

    constructor() {
        const config = getConfig();
        this.sql = neon(config.databaseUrl);
    }

    /**
     * Initialize database schema (create tables if not exist)
     */
    async initializeSchema(): Promise<void> {
        logger.info('Initializing database schema...');

        await this.sql`
            CREATE TABLE IF NOT EXISTS captions (
                id SERIAL PRIMARY KEY,
                text TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS hashtags (
                id SERIAL PRIMARY KEY,
                text TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS hooks (
                id SERIAL PRIMARY KEY,
                text TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS hashtag_combinations (
                id SERIAL PRIMARY KEY,
                hashtag1_id INTEGER NOT NULL REFERENCES hashtags(id),
                hashtag2_id INTEGER REFERENCES hashtags(id),
                hashtag3_id INTEGER REFERENCES hashtags(id),
                hashtag4_id INTEGER REFERENCES hashtags(id),
                hashtag5_id INTEGER REFERENCES hashtags(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS videos (
                id SERIAL PRIMARY KEY,
                title TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                video_id INTEGER NOT NULL REFERENCES videos(id),
                hook_id INTEGER NOT NULL REFERENCES hooks(id),
                caption_id INTEGER NOT NULL REFERENCES captions(id),
                hashtag_combination_id INTEGER NOT NULL REFERENCES hashtag_combinations(id),
                instagram_post_id TEXT,
                views INTEGER,
                shared_to_feed BOOLEAN DEFAULT FALSE,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        // Seed default accounts
        await this.sql`
            INSERT INTO accounts (id, name) VALUES (1, 'Molars UK (MAIN ACCOUNT)')
            ON CONFLICT (id) DO NOTHING
        `;
        await this.sql`
            INSERT INTO accounts (id, name) VALUES (2, 'MLRSUK (BACKUP ACCOUNT)')
            ON CONFLICT (id) DO NOTHING
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS user_posts (
                id SERIAL PRIMARY KEY,
                post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                user_id UUID NOT NULL,
                user_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(post_id)
            )
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_user_posts_user_id ON user_posts(user_id)
        `;

        // Add instagram_post_id column if it doesn't exist (migration for existing tables)
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'posts' AND column_name = 'instagram_post_id'
                ) THEN
                    ALTER TABLE posts ADD COLUMN instagram_post_id TEXT;
                END IF;
            END $$
        `;

        // Add account_id column if it doesn't exist (migration for multi-account support)
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'account_id'
                ) THEN
                    ALTER TABLE posts ADD COLUMN account_id INTEGER NOT NULL DEFAULT 2 REFERENCES accounts(id);
                END IF;
            END $$
        `;

        // Create index for faster lookups
        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_videos_title ON videos(title)
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id)
        `;

        logger.info('Database schema initialized');
    }

    /**
     * Upsert a caption (insert if not exists, return existing if it does)
     */
    async upsertCaption(text: string): Promise<DbCaption> {
        const result = await this.sql`
            INSERT INTO captions (text)
            VALUES (${text})
            ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text
            RETURNING id, text, created_at
        ` as DbCaption[];
        return result[0];
    }

    /**
     * Upsert a hashtag (insert if not exists, return existing if it does)
     */
    async upsertHashtag(text: string): Promise<DbHashtag> {
        const result = await this.sql`
            INSERT INTO hashtags (text)
            VALUES (${text})
            ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text
            RETURNING id, text, created_at
        ` as DbHashtag[];
        return result[0];
    }

    /**
     * Upsert a hook (insert if not exists, return existing if it does)
     */
    async upsertHook(text: string): Promise<DbHook> {
        const result = await this.sql`
            INSERT INTO hooks (text)
            VALUES (${text})
            ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text
            RETURNING id, text, created_at
        ` as DbHook[];
        return result[0];
    }

    /**
     * Upsert a video (insert if not exists, return existing if it does)
     */
    async upsertVideo(title: string): Promise<DbVideo> {
        const result = await this.sql`
            INSERT INTO videos (title)
            VALUES (${title})
            ON CONFLICT (title) DO UPDATE SET title = EXCLUDED.title
            RETURNING id, title, created_at
        ` as DbVideo[];
        return result[0];
    }

    /**
     * Find or create a hashtag combination
     * Checks if the exact combination already exists (order matters)
     */
    async findOrCreateHashtagCombination(hashtagIds: number[]): Promise<DbHashtagCombination> {
        const [h1, h2, h3, h4, h5] = [
            hashtagIds[0] ?? null,
            hashtagIds[1] ?? null,
            hashtagIds[2] ?? null,
            hashtagIds[3] ?? null,
            hashtagIds[4] ?? null,
        ];

        // First, try to find existing combination
        const existing = await this.sql`
            SELECT id, hashtag1_id, hashtag2_id, hashtag3_id, hashtag4_id, hashtag5_id, created_at
            FROM hashtag_combinations
            WHERE hashtag1_id = ${h1}
              AND (hashtag2_id IS NOT DISTINCT FROM ${h2})
              AND (hashtag3_id IS NOT DISTINCT FROM ${h3})
              AND (hashtag4_id IS NOT DISTINCT FROM ${h4})
              AND (hashtag5_id IS NOT DISTINCT FROM ${h5})
        ` as DbHashtagCombination[];

        if (existing.length > 0) {
            return existing[0];
        }

        // Create new combination
        const result = await this.sql`
            INSERT INTO hashtag_combinations (hashtag1_id, hashtag2_id, hashtag3_id, hashtag4_id, hashtag5_id)
            VALUES (${h1}, ${h2}, ${h3}, ${h4}, ${h5})
            RETURNING id, hashtag1_id, hashtag2_id, hashtag3_id, hashtag4_id, hashtag5_id, created_at
        ` as DbHashtagCombination[];

        return result[0];
    }

    /**
     * Create a new post with pending status
     */
    async createPost(
        videoId: number,
        hookId: number,
        captionId: number,
        hashtagCombinationId: number,
        sharedToFeed: boolean = false,
        accountId: number = 2
    ): Promise<DbPost> {
        const result = await this.sql`
            INSERT INTO posts (video_id, hook_id, caption_id, hashtag_combination_id, shared_to_feed, account_id, status)
            VALUES (${videoId}, ${hookId}, ${captionId}, ${hashtagCombinationId}, ${sharedToFeed}, ${accountId}, 'pending')
            RETURNING id, video_id, hook_id, caption_id, hashtag_combination_id, instagram_post_id, views, status, account_id, created_at, updated_at
        ` as DbPost[];
        return result[0];
    }

    /**
     * Update post status
     */
    async updatePostStatus(postId: number, status: PostStatus): Promise<void> {
        await this.sql`
            UPDATE posts
            SET status = ${status}, updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post status updated', { postId, status });
    }

    /**
     * Update post with success status and Instagram post ID
     */
    async markPostSuccess(postId: number, instagramPostId: string): Promise<void> {
        await this.sql`
            UPDATE posts
            SET status = 'success', instagram_post_id = ${instagramPostId}, updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as success', { postId, instagramPostId });
    }

    /**
     * Mark all pending posts as failed (used on startup/shutdown for crash recovery)
     */
    async markPendingPostsAsFailed(): Promise<number> {
        const result = await this.sql`
            UPDATE posts
            SET status = 'failed', updated_at = NOW()
            WHERE status = 'pending'
            RETURNING id
        ` as { id: number }[];
        const count = result.length;
        if (count > 0) {
            logger.warn('Marked stale pending posts as failed', { count });
        }
        return count;
    }

    /**
     * Get all posted video titles (for video selection logic)
     */
    async getPostedVideoTitles(accountId: number): Promise<string[]> {
        const result = await this.sql`
            SELECT DISTINCT v.title FROM posts p
            JOIN videos v ON p.video_id = v.id
            WHERE p.account_id = ${accountId}
        ` as { title: string }[];
        return result.map((row) => row.title);
    }

    /**
     * Get a random caption from the database
     */
    async getRandomCaption(): Promise<DbCaption | null> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM captions
            ORDER BY RANDOM()
            LIMIT 1
        ` as DbCaption[];
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get a random hook from the database
     */
    async getRandomHook(): Promise<DbHook | null> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM hooks
            ORDER BY RANDOM()
            LIMIT 1
        ` as DbHook[];
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get random hashtags from the database
     */
    async getRandomHashtags(count: number = 5): Promise<DbHashtag[]> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM hashtags
            ORDER BY RANDOM()
            LIMIT ${count}
        ` as DbHashtag[];
        return result;
    }

    /**
     * Get count of captions in database
     */
    async getCaptionCount(): Promise<number> {
        const result = await this.sql`SELECT COUNT(*) as count FROM captions` as { count: string }[];
        return parseInt(result[0].count, 10);
    }

    /**
     * Get count of hooks in database
     */
    async getHookCount(): Promise<number> {
        const result = await this.sql`SELECT COUNT(*) as count FROM hooks` as { count: string }[];
        return parseInt(result[0].count, 10);
    }

    /**
     * Get count of hashtags in database
     */
    async getHashtagCount(): Promise<number> {
        const result = await this.sql`SELECT COUNT(*) as count FROM hashtags` as { count: string }[];
        return parseInt(result[0].count, 10);
    }

    /**
     * Get successful posts that are at least 5 days old and have no views recorded
     */
    async getPostsNeedingViewsUpdate(): Promise<DbPost[]> {
        const result = await this.sql`
            SELECT id, video_id, hook_id, caption_id, hashtag_combination_id,
                   instagram_post_id, views, status, account_id, created_at, updated_at
            FROM posts
            WHERE status = 'success'
              AND views IS NULL
              AND instagram_post_id IS NOT NULL
              AND created_at <= NOW() - INTERVAL '2 days'
        ` as DbPost[];
        return result;
    }

    /**
     * Update the views count for a specific post
     */
    async updatePostViews(postId: number, views: number): Promise<void> {
        await this.sql`
            UPDATE posts
            SET views = ${views}, updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post views updated', { postId, views });
    }

    /**
     * Get a post by ID with all joined details (video, hook, caption, hashtags)
     */
    async getPostById(postId: number): Promise<PostWithDetails | null> {
        const rows = await this.sql`
            SELECT 
                p.id,
                p.instagram_post_id,
                p.views,
                p.status,
                p.created_at,
                p.updated_at,
                v.id as video_id,
                v.title as video_title,
                h.id as hook_id,
                h.text as hook_text,
                c.id as caption_id,
                c.text as caption_text,
                COALESCE(
                    ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL),
                    ARRAY[]::text[]
                ) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.id = ${postId}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text
        ` as {
            id: number;
            instagram_post_id: string | null;
            views: number | null;
            status: PostStatus;
            created_at: Date;
            updated_at: Date;
            video_id: number;
            video_title: string;
            hook_id: number;
            hook_text: string;
            caption_id: number;
            caption_text: string;
            hashtags: string[];
        }[];

        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            id: row.id,
            instagram_post_id: row.instagram_post_id,
            views: row.views,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            video: {
                id: row.video_id,
                title: row.video_title,
            },
            hook: {
                id: row.hook_id,
                text: row.hook_text,
            },
            caption: {
                id: row.caption_id,
                text: row.caption_text,
            },
            hashtags: row.hashtags || [],
        };
    }

    async getAccounts(): Promise<DbAccount[]> {
        const result = await this.sql`
            SELECT id, name, created_at FROM accounts ORDER BY id
        ` as DbAccount[];
        return result;
    }

    /**
     * Get all captions from the database
     */
    async getAllCaptions(): Promise<DbCaption[]> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM captions
            ORDER BY created_at DESC
        ` as DbCaption[];
        return result;
    }

    /**
     * Get all hooks from the database
     */
    async getAllHooks(): Promise<DbHook[]> {
        const result = await this.sql`
            SELECT id, text, created_at
            FROM hooks
            ORDER BY created_at DESC
        ` as DbHook[];
        return result;
    }

    /**
     * Create a user_posts entry linking a post to the user who created it
     */
    async createUserPost(postId: number, userId: string, userName: string): Promise<void> {
        await this.sql`
            INSERT INTO user_posts (post_id, user_id, user_name)
            VALUES (${postId}, ${userId}, ${userName})
        `;
        logger.debug('User post record created', { postId, userId, userName });
    }
}
