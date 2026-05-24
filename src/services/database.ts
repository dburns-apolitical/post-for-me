import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type {
    PostStatus,
    DbAccount,
    DbCaption,
    DbCaptionWithAccounts,
    DbHashtag,
    DbHook,
    DbHookWithAccounts,
    DbHashtagCombination,
    DbVideo,
    DbPost,
    PendingUploadPostPost,
    PostWithDetails,
    AgentEvaluation,
    ContentAccount,
    DbCredential,
    Platform,
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
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
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
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
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

        // Add ig_access_token column to accounts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'accounts' AND column_name = 'ig_access_token'
                ) THEN
                    ALTER TABLE accounts ADD COLUMN ig_access_token TEXT NOT NULL DEFAULT '';
                END IF;
            END $$
        `;

        // Add ig_user_id column to accounts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'accounts' AND column_name = 'ig_user_id'
                ) THEN
                    ALTER TABLE accounts ADD COLUMN ig_user_id TEXT NOT NULL DEFAULT '';
                END IF;
            END $$
        `;

        // Add gcs_bucket_name column to accounts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'accounts' AND column_name = 'gcs_bucket_name'
                ) THEN
                    ALTER TABLE accounts ADD COLUMN gcs_bucket_name TEXT NOT NULL DEFAULT '';
                END IF;
            END $$
        `;

        // Create junction tables
        await this.sql`
            CREATE TABLE IF NOT EXISTS account_captions (
                account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                caption_id INTEGER REFERENCES captions(id) ON DELETE CASCADE,
                PRIMARY KEY (account_id, caption_id)
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS account_hooks (
                account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                hook_id INTEGER REFERENCES hooks(id) ON DELETE CASCADE,
                PRIMARY KEY (account_id, hook_id)
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS account_hashtag_combinations (
                account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                hashtag_combination_id INTEGER REFERENCES hashtag_combinations(id) ON DELETE CASCADE,
                PRIMARY KEY (account_id, hashtag_combination_id)
            )
        `;

        // Seed default accounts with credentials from env
        await this.sql`
            INSERT INTO accounts (id, name, ig_access_token, ig_user_id, gcs_bucket_name)
            VALUES (1, 'Molars UK (MAIN ACCOUNT)',
                    ${process.env.INSTAGRAM_ACCESS_TOKEN_1 || ''},
                    ${process.env.INSTAGRAM_USER_ID_1 || ''},
                    ${process.env.GCS_BUCKET_NAME || ''})
            ON CONFLICT (id) DO UPDATE SET
                ig_access_token = CASE WHEN accounts.ig_access_token = '' THEN EXCLUDED.ig_access_token ELSE accounts.ig_access_token END,
                ig_user_id = CASE WHEN accounts.ig_user_id = '' THEN EXCLUDED.ig_user_id ELSE accounts.ig_user_id END,
                gcs_bucket_name = CASE WHEN accounts.gcs_bucket_name = '' THEN EXCLUDED.gcs_bucket_name ELSE accounts.gcs_bucket_name END
        `;
        await this.sql`
            INSERT INTO accounts (id, name, ig_access_token, ig_user_id, gcs_bucket_name)
            VALUES (2, 'MLRSUK (BACKUP ACCOUNT)',
                    ${process.env.INSTAGRAM_ACCESS_TOKEN_2 || ''},
                    ${process.env.INSTAGRAM_USER_ID_2 || ''},
                    ${process.env.GCS_BUCKET_NAME || ''})
            ON CONFLICT (id) DO UPDATE SET
                ig_access_token = CASE WHEN accounts.ig_access_token = '' THEN EXCLUDED.ig_access_token ELSE accounts.ig_access_token END,
                ig_user_id = CASE WHEN accounts.ig_user_id = '' THEN EXCLUDED.ig_user_id ELSE accounts.ig_user_id END,
                gcs_bucket_name = CASE WHEN accounts.gcs_bucket_name = '' THEN EXCLUDED.gcs_bucket_name ELSE accounts.gcs_bucket_name END
        `;

        // Populate junction tables for existing accounts (seed all content to both accounts)
        await this.sql`
            INSERT INTO account_captions (account_id, caption_id)
            SELECT a.id, c.id FROM accounts a CROSS JOIN captions c
            WHERE a.id IN (1, 2)
            ON CONFLICT DO NOTHING
        `;
        await this.sql`
            INSERT INTO account_hooks (account_id, hook_id)
            SELECT a.id, h.id FROM accounts a CROSS JOIN hooks h
            WHERE a.id IN (1, 2)
            ON CONFLICT DO NOTHING
        `;
        await this.sql`
            INSERT INTO account_hashtag_combinations (account_id, hashtag_combination_id)
            SELECT a.id, hc.id FROM accounts a CROSS JOIN hashtag_combinations hc
            WHERE a.id IN (1, 2)
            ON CONFLICT DO NOTHING
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

        // Add upload_post_request_id column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'upload_post_request_id'
                ) THEN
                    ALTER TABLE posts ADD COLUMN upload_post_request_id TEXT;
                END IF;
            END $$
        `;

        // Add upload_post_submitted_at column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'upload_post_submitted_at'
                ) THEN
                    ALTER TABLE posts ADD COLUMN upload_post_submitted_at TIMESTAMP;
                END IF;
            END $$
        `;

        // Add edited_video_url column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'edited_video_url'
                ) THEN
                    ALTER TABLE posts ADD COLUMN edited_video_url TEXT;
                END IF;
            END $$
        `;

        // Add pending_user_id column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'pending_user_id'
                ) THEN
                    ALTER TABLE posts ADD COLUMN pending_user_id UUID;
                END IF;
            END $$
        `;

        // Add pending_user_name column to posts if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'posts' AND column_name = 'pending_user_name'
                ) THEN
                    ALTER TABLE posts ADD COLUMN pending_user_name TEXT;
                END IF;
            END $$
        `;

        // Add enabled column to hooks if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'hooks' AND column_name = 'enabled'
                ) THEN
                    ALTER TABLE hooks ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;
                END IF;
            END $$
        `;

        // Add enabled column to captions if it doesn't exist
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'captions' AND column_name = 'enabled'
                ) THEN
                    ALTER TABLE captions ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;
                END IF;
            END $$
        `;

        // Create index for faster lookups
        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)
        `;

        // Partial index — only covers in-flight rows the status cron scans every 10s.
        // Rows transitioning to 'success'/'failed' drop out of the index automatically.
        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_posts_pending_upload_post
            ON posts(upload_post_submitted_at)
            WHERE status = 'pending' AND upload_post_request_id IS NOT NULL
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_videos_title ON videos(title)
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id)
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS agent_evaluations (
                id SERIAL PRIMARY KEY,
                response TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER,
                output_tokens INTEGER,
                triggered_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS daily_views (
                id SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                day DATE NOT NULL,
                views INTEGER NOT NULL,
                post_count INTEGER NOT NULL,
                UNIQUE(account_id, day)
            )
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_daily_views_day ON daily_views(day)
        `;

        await this.sql`
            CREATE TABLE IF NOT EXISTS daily_impressions (
                id         SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                day        DATE NOT NULL,
                instagram  INTEGER NOT NULL DEFAULT 0,
                youtube    INTEGER NOT NULL DEFAULT 0,
                tiktok     INTEGER NOT NULL DEFAULT 0,
                twitter    INTEGER NOT NULL DEFAULT 0,
                UNIQUE(account_id, day)
            )
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_daily_impressions_day ON daily_impressions(day)
        `;

        // Create platform enum type
        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform') THEN
                    CREATE TYPE platform AS ENUM ('instagram_direct', 'upload_post');
                END IF;
            END $$
        `;

        // Create credentials table
        await this.sql`
            CREATE TABLE IF NOT EXISTS credentials (
                id SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                platform platform NOT NULL,
                credentials JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `;

        await this.sql`
            CREATE INDEX IF NOT EXISTS idx_credentials_account_id ON credentials(account_id)
        `;

        await this.sql`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'credentials' AND column_name = 'active'
                ) THEN
                    ALTER TABLE credentials ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
                END IF;
            END $$
        `;

        // Migrate existing Instagram credentials from accounts table
        await this.sql`
            INSERT INTO credentials (account_id, platform, credentials)
            SELECT id, 'instagram_direct', jsonb_build_object(
                'ig_access_token', ig_access_token,
                'ig_user_id', ig_user_id
            )
            FROM accounts
            WHERE ig_access_token IS NOT NULL AND ig_access_token != ''
              AND ig_user_id IS NOT NULL AND ig_user_id != ''
              AND id NOT IN (
                  SELECT account_id FROM credentials WHERE platform = 'instagram_direct'
              )
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
            RETURNING id, text, enabled, created_at
        ` as DbCaption[];
        return result[0];
    }

    /**
     * Create a new caption, returning null if it already exists (unique violation)
     */
    async createCaption(text: string): Promise<DbCaption | null> {
        try {
            const result = await this.sql`
                INSERT INTO captions (text)
                VALUES (${text})
                RETURNING id, text, enabled, created_at
            ` as DbCaption[];
            return result[0];
        } catch (error: any) {
            if (error?.code === '23505' || error?.message?.includes('unique')) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Update the enabled status of a caption
     */
    async updateCaptionEnabled(id: number, enabled: boolean): Promise<DbCaption | null> {
        const result = await this.sql`
            UPDATE captions
            SET enabled = ${enabled}
            WHERE id = ${id}
            RETURNING id, text, enabled, created_at
        ` as DbCaption[];
        return result.length > 0 ? result[0] : null;
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
            RETURNING id, text, enabled, created_at
        ` as DbHook[];
        return result[0];
    }

    /**
     * Create a new hook, returning null if it already exists (unique violation)
     */
    async createHook(text: string): Promise<DbHook | null> {
        try {
            const result = await this.sql`
                INSERT INTO hooks (text)
                VALUES (${text})
                RETURNING id, text, enabled, created_at
            ` as DbHook[];
            return result[0];
        } catch (error: any) {
            if (error?.code === '23505' || error?.message?.includes('unique')) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Update the enabled status of a hook
     */
    async updateHookEnabled(id: number, enabled: boolean): Promise<DbHook | null> {
        const result = await this.sql`
            UPDATE hooks
            SET enabled = ${enabled}
            WHERE id = ${id}
            RETURNING id, text, enabled, created_at
        ` as DbHook[];
        return result.length > 0 ? result[0] : null;
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
     * Update post status. When transitioning to 'failed', also clears the in-flight
     * tracking columns so a stuck row's GCS resource pointer and pending user info
     * get cleaned up. For other statuses the columns are left alone.
     */
    async updatePostStatus(postId: number, status: PostStatus): Promise<void> {
        if (status === 'failed') {
            await this.sql`
                UPDATE posts
                SET status = ${status},
                    edited_video_url = NULL,
                    pending_user_id = NULL,
                    pending_user_name = NULL,
                    updated_at = NOW()
                WHERE id = ${postId}
            `;
        } else {
            await this.sql`
                UPDATE posts
                SET status = ${status}, updated_at = NOW()
                WHERE id = ${postId}
            `;
        }
        logger.debug('Post status updated', { postId, status });
    }

    /**
     * Update post with success status and Instagram post ID. Also clears the in-flight
     * tracking columns (edited_video_url, pending_user_*) since they're no longer needed
     * after the terminal transition. request_id and submitted_at are kept for audit trail.
     */
    async markPostSuccess(postId: number, instagramPostId: string | null): Promise<void> {
        await this.sql`
            UPDATE posts
            SET status = 'success',
                instagram_post_id = ${instagramPostId},
                edited_video_url = NULL,
                pending_user_id = NULL,
                pending_user_name = NULL,
                updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as success', { postId, instagramPostId });
    }

    /**
     * Persist the Upload-Post request_id and submission timestamp on a post, along with
     * the GCS edited video URL (so the status cron can clean it up on terminal transition)
     * and the optional pending user info (so the status cron can create the user_posts
     * row on success). All five fields are written in one UPDATE.
     */
    async markUploadPostSubmitting(
        postId: number,
        requestId: string,
        editedVideoUrl: string,
        pendingUserId?: string,
        pendingUserName?: string,
    ): Promise<void> {
        await this.sql`
            UPDATE posts
            SET upload_post_request_id = ${requestId},
                upload_post_submitted_at = NOW(),
                edited_video_url = ${editedVideoUrl},
                pending_user_id = ${pendingUserId ?? null},
                pending_user_name = ${pendingUserName ?? null},
                updated_at = NOW()
            WHERE id = ${postId}
        `;
        logger.debug('Post marked as upload-post-submitting', { postId, requestId });
    }

    /**
     * Returns all posts currently being tracked by the Upload-Post status cron:
     * status='pending' AND a request_id has been persisted. The cron iterates these
     * each tick and polls Upload-Post's /uploadposts/status endpoint.
     */
    async getPendingUploadPostPosts(): Promise<PendingUploadPostPost[]> {
        return await this.sql`
            SELECT id,
                   upload_post_request_id,
                   upload_post_submitted_at,
                   edited_video_url,
                   pending_user_id,
                   pending_user_name
            FROM posts
            WHERE status = 'pending'
              AND upload_post_request_id IS NOT NULL
            ORDER BY upload_post_submitted_at ASC
        ` as PendingUploadPostPost[];
    }

    /**
     * Returns the full account row for a given post. Used by UploadPostStatusCronService
     * to find both the gcs_bucket_name (for GCS cleanup) and the account_id (for credential lookup).
     */
    async getPostAccount(postId: number): Promise<DbAccount | null> {
        const rows = await this.sql`
            SELECT a.id, a.name, a.ig_access_token, a.ig_user_id, a.gcs_bucket_name, a.created_at
            FROM accounts a
            JOIN posts p ON p.account_id = a.id
            WHERE p.id = ${postId}
        ` as DbAccount[];
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Crash-recovery: mark posts as failed if they're stuck in pending and either
     *   (a) never got submitted to Upload-Post (no request_id), or
     *   (b) have been awaiting Upload-Post for more than 1 hour (matches Upload-Post's own
     *       "no activity for >1h → failed" rule).
     * In-flight rows submitted less than 1h ago are left alone — the status cron will
     * resume polling them.
     */
    async markPendingPostsAsFailed(): Promise<number> {
        const result = await this.sql`
            UPDATE posts
            SET status = 'failed', updated_at = NOW()
            WHERE status = 'pending'
              AND (upload_post_request_id IS NULL
                   OR upload_post_submitted_at < NOW() - INTERVAL '1 hour')
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
            AND p.status = 'success'
        ` as { title: string }[];
        return result.map((row) => row.title);
    }

    /**
     * Get a random caption from the database
     */
    async getRandomCaption(accountId: number): Promise<DbCaption | null> {
        const result = await this.sql`
            SELECT c.id, c.text, c.enabled, c.created_at
            FROM captions c
            JOIN account_captions ac ON ac.caption_id = c.id AND ac.account_id = ${accountId}
            WHERE c.enabled = TRUE
            ORDER BY RANDOM()
            LIMIT 1
        ` as DbCaption[];
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get a random hook from the database
     */
    async getRandomHook(accountId: number): Promise<DbHook | null> {
        const result = await this.sql`
            SELECT h.id, h.text, h.enabled, h.created_at
            FROM hooks h
            JOIN account_hooks ah ON ah.hook_id = h.id AND ah.account_id = ${accountId}
            WHERE h.enabled = TRUE
            ORDER BY RANDOM()
            LIMIT 1
        ` as DbHook[];
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get random hashtags from the database
     */
    async getRandomHashtags(accountId: number, count: number = 5): Promise<DbHashtag[]> {
        const result = await this.sql`
            SELECT id, text, created_at FROM (
                SELECT DISTINCT h.id, h.text, h.created_at
                FROM hashtags h
                JOIN hashtag_combinations hc ON h.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                JOIN account_hashtag_combinations ahc ON ahc.hashtag_combination_id = hc.id AND ahc.account_id = ${accountId}
            ) sub
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
                a.name as account_name,
                COALESCE(
                    ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL),
                    ARRAY[]::text[]
                ) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN accounts a ON p.account_id = a.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.id = ${postId}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
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
            account_name: string;
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
            account_name: row.account_name,
        };
    }

    async getAccounts(): Promise<DbAccount[]> {
        const result = await this.sql`
            SELECT id, name, ig_access_token, ig_user_id, gcs_bucket_name, created_at
            FROM accounts ORDER BY id
        ` as DbAccount[];
        return result;
    }

    async getAccount(id: number): Promise<DbAccount | null> {
        const result = await this.sql`
            SELECT id, name, ig_access_token, ig_user_id, gcs_bucket_name, created_at
            FROM accounts WHERE id = ${id}
        ` as DbAccount[];
        return result.length > 0 ? result[0] : null;
    }

    async createAccount(
        name: string,
        igAccessToken: string,
        igUserId: string,
        gcsBucketName: string
    ): Promise<DbAccount> {
        const result = await this.sql`
            INSERT INTO accounts (name, ig_access_token, ig_user_id, gcs_bucket_name)
            VALUES (${name}, ${igAccessToken}, ${igUserId}, ${gcsBucketName})
            RETURNING id, name, ig_access_token, ig_user_id, gcs_bucket_name, created_at
        ` as DbAccount[];
        return result[0];
    }

    async updateAccount(
        id: number,
        fields: { name?: string; ig_access_token?: string; ig_user_id?: string; gcs_bucket_name?: string }
    ): Promise<DbAccount | null> {
        const result = await this.sql`
            UPDATE accounts SET
                name = COALESCE(${fields.name ?? null}, name),
                ig_access_token = COALESCE(${fields.ig_access_token ?? null}, ig_access_token),
                ig_user_id = COALESCE(${fields.ig_user_id ?? null}, ig_user_id),
                gcs_bucket_name = COALESCE(${fields.gcs_bucket_name ?? null}, gcs_bucket_name)
            WHERE id = ${id}
            RETURNING id, name, ig_access_token, ig_user_id, gcs_bucket_name, created_at
        ` as DbAccount[];
        return result.length > 0 ? result[0] : null;
    }

    async deleteAccount(id: number): Promise<{ deleted: boolean; error?: string }> {
        const postCheck = await this.sql`
            SELECT COUNT(*) as count FROM posts WHERE account_id = ${id}
        ` as { count: string }[];

        if (parseInt(postCheck[0].count, 10) > 0) {
            return { deleted: false, error: 'Cannot delete account with existing posts' };
        }

        const result = await this.sql`
            DELETE FROM accounts WHERE id = ${id} RETURNING id
        ` as { id: number }[];

        return { deleted: result.length > 0 };
    }

    // Credential methods

    async getCredentialsByAccountId(accountId: number): Promise<DbCredential[]> {
        return await this.sql`
            SELECT id, account_id, platform, credentials, active, created_at
            FROM credentials
            WHERE account_id = ${accountId}
            ORDER BY created_at DESC
        ` as DbCredential[];
    }

    async getCredentialsByPlatform(accountId: number, platform: Platform): Promise<DbCredential | null> {
        const result = await this.sql`
            SELECT id, account_id, platform, credentials, active, created_at
            FROM credentials
            WHERE account_id = ${accountId} AND platform = ${platform} AND active = TRUE
            ORDER BY created_at DESC
            LIMIT 1
        ` as DbCredential[];
        return result.length > 0 ? result[0] : null;
    }

    async createCredential(accountId: number, platform: Platform, credentials: DbCredential['credentials']): Promise<DbCredential> {
        const result = await this.sql`
            INSERT INTO credentials (account_id, platform, credentials)
            VALUES (${accountId}, ${platform}, ${JSON.stringify(credentials)})
            RETURNING id, account_id, platform, credentials, active, created_at
        ` as DbCredential[];
        return result[0];
    }

    async updateCredential(id: number, credentials: DbCredential['credentials']): Promise<DbCredential | null> {
        const result = await this.sql`
            UPDATE credentials
            SET credentials = ${JSON.stringify(credentials)}
            WHERE id = ${id}
            RETURNING id, account_id, platform, credentials, active, created_at
        ` as DbCredential[];
        return result.length > 0 ? result[0] : null;
    }

    async updateCredentialActive(id: number, active: boolean): Promise<DbCredential | null> {
        const result = await this.sql`
            UPDATE credentials
            SET active = ${active}
            WHERE id = ${id}
            RETURNING id, account_id, platform, credentials, active, created_at
        ` as DbCredential[];
        return result.length > 0 ? result[0] : null;
    }

    async deleteCredential(id: number): Promise<boolean> {
        const result = await this.sql`
            DELETE FROM credentials WHERE id = ${id} RETURNING id
        ` as { id: number }[];
        return result.length > 0;
    }

    async getCredential(id: number): Promise<DbCredential | null> {
        const result = await this.sql`
            SELECT id, account_id, platform, credentials, active, created_at
            FROM credentials
            WHERE id = ${id}
        ` as DbCredential[];
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get all captions from the database
     */
    async getAllCaptions(enabledOnly: boolean = false, accountId?: number): Promise<DbCaption[]> {
        if (accountId !== undefined) {
            if (enabledOnly) {
                return await this.sql`
                    SELECT c.id, c.text, c.enabled, c.created_at
                    FROM captions c
                    JOIN account_captions ac ON ac.caption_id = c.id AND ac.account_id = ${accountId}
                    WHERE c.enabled = TRUE
                    ORDER BY c.created_at DESC
                ` as DbCaption[];
            }
            return await this.sql`
                SELECT c.id, c.text, c.enabled, c.created_at
                FROM captions c
                JOIN account_captions ac ON ac.caption_id = c.id AND ac.account_id = ${accountId}
                ORDER BY c.created_at DESC
            ` as DbCaption[];
        }
        if (enabledOnly) {
            return await this.sql`
                SELECT id, text, enabled, created_at FROM captions WHERE enabled = TRUE ORDER BY created_at DESC
            ` as DbCaption[];
        }
        return await this.sql`
            SELECT id, text, enabled, created_at FROM captions ORDER BY created_at DESC
        ` as DbCaption[];
    }

    /**
     * Get all hooks from the database
     */
    async getAllHooks(enabledOnly: boolean = false, accountId?: number): Promise<DbHook[]> {
        if (accountId !== undefined) {
            if (enabledOnly) {
                return await this.sql`
                    SELECT h.id, h.text, h.enabled, h.created_at
                    FROM hooks h
                    JOIN account_hooks ah ON ah.hook_id = h.id AND ah.account_id = ${accountId}
                    WHERE h.enabled = TRUE
                    ORDER BY h.created_at DESC
                ` as DbHook[];
            }
            return await this.sql`
                SELECT h.id, h.text, h.enabled, h.created_at
                FROM hooks h
                JOIN account_hooks ah ON ah.hook_id = h.id AND ah.account_id = ${accountId}
                ORDER BY h.created_at DESC
            ` as DbHook[];
        }
        if (enabledOnly) {
            return await this.sql`
                SELECT id, text, enabled, created_at FROM hooks WHERE enabled = TRUE ORDER BY created_at DESC
            ` as DbHook[];
        }
        return await this.sql`
            SELECT id, text, enabled, created_at FROM hooks ORDER BY created_at DESC
        ` as DbHook[];
    }

    /**
     * Get all captions with their account assignments
     */
    async getAllCaptionsWithAccounts(enabledOnly: boolean = false, accountId?: number): Promise<DbCaptionWithAccounts[]> {
        let rows;
        if (accountId !== undefined) {
            if (enabledOnly) {
                rows = await this.sql`
                    SELECT c.id, c.text, c.enabled, c.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM captions c
                    JOIN account_captions ac2 ON ac2.caption_id = c.id AND ac2.account_id = ${accountId}
                    LEFT JOIN account_captions ac ON ac.caption_id = c.id
                    LEFT JOIN accounts a ON a.id = ac.account_id
                    WHERE c.enabled = TRUE
                    GROUP BY c.id, c.text, c.enabled, c.created_at
                    ORDER BY c.created_at DESC
                `;
            } else {
                rows = await this.sql`
                    SELECT c.id, c.text, c.enabled, c.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM captions c
                    JOIN account_captions ac2 ON ac2.caption_id = c.id AND ac2.account_id = ${accountId}
                    LEFT JOIN account_captions ac ON ac.caption_id = c.id
                    LEFT JOIN accounts a ON a.id = ac.account_id
                    GROUP BY c.id, c.text, c.enabled, c.created_at
                    ORDER BY c.created_at DESC
                `;
            }
        } else {
            if (enabledOnly) {
                rows = await this.sql`
                    SELECT c.id, c.text, c.enabled, c.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM captions c
                    LEFT JOIN account_captions ac ON ac.caption_id = c.id
                    LEFT JOIN accounts a ON a.id = ac.account_id
                    WHERE c.enabled = TRUE
                    GROUP BY c.id, c.text, c.enabled, c.created_at
                    ORDER BY c.created_at DESC
                `;
            } else {
                rows = await this.sql`
                    SELECT c.id, c.text, c.enabled, c.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM captions c
                    LEFT JOIN account_captions ac ON ac.caption_id = c.id
                    LEFT JOIN accounts a ON a.id = ac.account_id
                    GROUP BY c.id, c.text, c.enabled, c.created_at
                    ORDER BY c.created_at DESC
                `;
            }
        }
        return (rows as any[]).map(row => ({
            id: row.id,
            text: row.text,
            enabled: row.enabled,
            created_at: row.created_at,
            accounts: typeof row.accounts === 'string' ? JSON.parse(row.accounts) : row.accounts,
        }));
    }

    /**
     * Get all hooks with their account assignments
     */
    async getAllHooksWithAccounts(enabledOnly: boolean = false, accountId?: number): Promise<DbHookWithAccounts[]> {
        let rows;
        if (accountId !== undefined) {
            if (enabledOnly) {
                rows = await this.sql`
                    SELECT h.id, h.text, h.enabled, h.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM hooks h
                    JOIN account_hooks ah2 ON ah2.hook_id = h.id AND ah2.account_id = ${accountId}
                    LEFT JOIN account_hooks ah ON ah.hook_id = h.id
                    LEFT JOIN accounts a ON a.id = ah.account_id
                    WHERE h.enabled = TRUE
                    GROUP BY h.id, h.text, h.enabled, h.created_at
                    ORDER BY h.created_at DESC
                `;
            } else {
                rows = await this.sql`
                    SELECT h.id, h.text, h.enabled, h.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM hooks h
                    JOIN account_hooks ah2 ON ah2.hook_id = h.id AND ah2.account_id = ${accountId}
                    LEFT JOIN account_hooks ah ON ah.hook_id = h.id
                    LEFT JOIN accounts a ON a.id = ah.account_id
                    GROUP BY h.id, h.text, h.enabled, h.created_at
                    ORDER BY h.created_at DESC
                `;
            }
        } else {
            if (enabledOnly) {
                rows = await this.sql`
                    SELECT h.id, h.text, h.enabled, h.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM hooks h
                    LEFT JOIN account_hooks ah ON ah.hook_id = h.id
                    LEFT JOIN accounts a ON a.id = ah.account_id
                    WHERE h.enabled = TRUE
                    GROUP BY h.id, h.text, h.enabled, h.created_at
                    ORDER BY h.created_at DESC
                `;
            } else {
                rows = await this.sql`
                    SELECT h.id, h.text, h.enabled, h.created_at,
                        COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::json) as accounts
                    FROM hooks h
                    LEFT JOIN account_hooks ah ON ah.hook_id = h.id
                    LEFT JOIN accounts a ON a.id = ah.account_id
                    GROUP BY h.id, h.text, h.enabled, h.created_at
                    ORDER BY h.created_at DESC
                `;
            }
        }
        return (rows as any[]).map(row => ({
            id: row.id,
            text: row.text,
            enabled: row.enabled,
            created_at: row.created_at,
            accounts: typeof row.accounts === 'string' ? JSON.parse(row.accounts) : row.accounts,
        }));
    }

    async assignCaptionsToAccount(accountId: number, captionIds: number[]): Promise<void> {
        for (const captionId of captionIds) {
            await this.sql`
                INSERT INTO account_captions (account_id, caption_id)
                VALUES (${accountId}, ${captionId})
                ON CONFLICT DO NOTHING
            `;
        }
    }

    async removeCaptionFromAccount(accountId: number, captionId: number): Promise<boolean> {
        const result = await this.sql`
            DELETE FROM account_captions
            WHERE account_id = ${accountId} AND caption_id = ${captionId}
            RETURNING account_id
        ` as { account_id: number }[];
        return result.length > 0;
    }

    async assignHooksToAccount(accountId: number, hookIds: number[]): Promise<void> {
        for (const hookId of hookIds) {
            await this.sql`
                INSERT INTO account_hooks (account_id, hook_id)
                VALUES (${accountId}, ${hookId})
                ON CONFLICT DO NOTHING
            `;
        }
    }

    async removeHookFromAccount(accountId: number, hookId: number): Promise<boolean> {
        const result = await this.sql`
            DELETE FROM account_hooks
            WHERE account_id = ${accountId} AND hook_id = ${hookId}
            RETURNING account_id
        ` as { account_id: number }[];
        return result.length > 0;
    }

    async assignHashtagCombinationsToAccount(accountId: number, combinationIds: number[]): Promise<void> {
        for (const combinationId of combinationIds) {
            await this.sql`
                INSERT INTO account_hashtag_combinations (account_id, hashtag_combination_id)
                VALUES (${accountId}, ${combinationId})
                ON CONFLICT DO NOTHING
            `;
        }
    }

    async removeHashtagCombinationFromAccount(accountId: number, combinationId: number): Promise<boolean> {
        const result = await this.sql`
            DELETE FROM account_hashtag_combinations
            WHERE account_id = ${accountId} AND hashtag_combination_id = ${combinationId}
            RETURNING account_id
        ` as { account_id: number }[];
        return result.length > 0;
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

    async insertEvaluation(
        response: string,
        model: string,
        inputTokens: number | null,
        outputTokens: number | null,
        triggeredBy: string
    ): Promise<AgentEvaluation> {
        const result = await this.sql`
            INSERT INTO agent_evaluations (response, model, input_tokens, output_tokens, triggered_by)
            VALUES (${response}, ${model}, ${inputTokens}, ${outputTokens}, ${triggeredBy})
            RETURNING id, response, model, input_tokens, output_tokens, triggered_by, created_at
        ` as AgentEvaluation[];
        return result[0];
    }

    async getRecentEvaluations(limit: number = 10): Promise<AgentEvaluation[]> {
        const result = await this.sql`
            SELECT id, response, model, input_tokens, output_tokens, triggered_by, created_at
            FROM agent_evaluations
            ORDER BY created_at DESC
            LIMIT ${limit}
        ` as AgentEvaluation[];
        return result;
    }

    async getPostsWithDetails(
        accountId: number | null,
        afterDate: Date | null,
        beforeDate: Date | null
    ): Promise<(PostWithDetails & { account_name: string })[]> {
        let rows;
        if (accountId !== null && afterDate !== null && beforeDate !== null) {
            rows = await this.sql`
                SELECT p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                    v.id as video_id, v.title as video_title,
                    h.id as hook_id, h.text as hook_text,
                    c.id as caption_id, c.text as caption_text,
                    a.name as account_name,
                    COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
                FROM posts p
                JOIN videos v ON p.video_id = v.id
                JOIN hooks h ON p.hook_id = h.id
                JOIN captions c ON p.caption_id = c.id
                JOIN accounts a ON p.account_id = a.id
                JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
                LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                WHERE p.status = 'success' AND p.account_id = ${accountId}
                  AND p.created_at >= ${afterDate.toISOString()} AND p.created_at < ${beforeDate.toISOString()}
                GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
                ORDER BY p.created_at DESC
            `;
        } else if (accountId !== null && afterDate !== null) {
            rows = await this.sql`
                SELECT p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                    v.id as video_id, v.title as video_title,
                    h.id as hook_id, h.text as hook_text,
                    c.id as caption_id, c.text as caption_text,
                    a.name as account_name,
                    COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
                FROM posts p
                JOIN videos v ON p.video_id = v.id
                JOIN hooks h ON p.hook_id = h.id
                JOIN captions c ON p.caption_id = c.id
                JOIN accounts a ON p.account_id = a.id
                JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
                LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                WHERE p.status = 'success' AND p.account_id = ${accountId}
                  AND p.created_at >= ${afterDate.toISOString()}
                GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
                ORDER BY p.created_at DESC
            `;
        } else if (afterDate !== null && beforeDate !== null) {
            rows = await this.sql`
                SELECT p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                    v.id as video_id, v.title as video_title,
                    h.id as hook_id, h.text as hook_text,
                    c.id as caption_id, c.text as caption_text,
                    a.name as account_name,
                    COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
                FROM posts p
                JOIN videos v ON p.video_id = v.id
                JOIN hooks h ON p.hook_id = h.id
                JOIN captions c ON p.caption_id = c.id
                JOIN accounts a ON p.account_id = a.id
                JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
                LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                WHERE p.status = 'success'
                  AND p.created_at >= ${afterDate.toISOString()} AND p.created_at < ${beforeDate.toISOString()}
                GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
                ORDER BY p.created_at DESC
            `;
        } else if (afterDate !== null) {
            rows = await this.sql`
                SELECT p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                    v.id as video_id, v.title as video_title,
                    h.id as hook_id, h.text as hook_text,
                    c.id as caption_id, c.text as caption_text,
                    a.name as account_name,
                    COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
                FROM posts p
                JOIN videos v ON p.video_id = v.id
                JOIN hooks h ON p.hook_id = h.id
                JOIN captions c ON p.caption_id = c.id
                JOIN accounts a ON p.account_id = a.id
                JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
                LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                WHERE p.status = 'success'
                  AND p.created_at >= ${afterDate.toISOString()}
                GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
                ORDER BY p.created_at DESC
            `;
        } else if (accountId !== null) {
            rows = await this.sql`
                SELECT p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                    v.id as video_id, v.title as video_title,
                    h.id as hook_id, h.text as hook_text,
                    c.id as caption_id, c.text as caption_text,
                    a.name as account_name,
                    COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
                FROM posts p
                JOIN videos v ON p.video_id = v.id
                JOIN hooks h ON p.hook_id = h.id
                JOIN captions c ON p.caption_id = c.id
                JOIN accounts a ON p.account_id = a.id
                JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
                LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                WHERE p.status = 'success' AND p.account_id = ${accountId}
                GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
                ORDER BY p.created_at DESC
            `;
        } else {
            rows = await this.sql`
                SELECT p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                    v.id as video_id, v.title as video_title,
                    h.id as hook_id, h.text as hook_text,
                    c.id as caption_id, c.text as caption_text,
                    a.name as account_name,
                    COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
                FROM posts p
                JOIN videos v ON p.video_id = v.id
                JOIN hooks h ON p.hook_id = h.id
                JOIN captions c ON p.caption_id = c.id
                JOIN accounts a ON p.account_id = a.id
                JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
                LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
                WHERE p.status = 'success'
                GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text, a.name
                ORDER BY p.created_at DESC
            `;
        }

        return (rows as any[]).map((row: any) => ({
            id: row.id,
            instagram_post_id: row.instagram_post_id,
            views: row.views,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            video: { id: row.video_id, title: row.video_title },
            hook: { id: row.hook_id, text: row.hook_text },
            caption: { id: row.caption_id, text: row.caption_text },
            hashtags: row.hashtags || [],
            account_name: row.account_name,
        }));
    }

    /**
     * Insert or update daily views aggregate for an account
     * Uses ON CONFLICT to handle re-triggers on the same day (additive)
     */
    async insertDailyViews(accountId: number, day: Date, views: number, postCount: number): Promise<void> {
        await this.sql`
            INSERT INTO daily_views (account_id, day, views, post_count)
            VALUES (${accountId}, ${day.toISOString().split('T')[0]}, ${views}, ${postCount})
            ON CONFLICT (account_id, day)
            DO UPDATE SET
                views = daily_views.views + EXCLUDED.views,
                post_count = daily_views.post_count + EXCLUDED.post_count
        `;
    }

    /**
     * Insert or update daily impressions aggregate for an account
     */
    async insertDailyImpressions(
        accountId: number,
        day: Date,
        counts: { instagram: number; youtube: number; tiktok: number; twitter: number }
    ): Promise<void> {
        await this.sql`
            INSERT INTO daily_impressions (account_id, day, instagram, youtube, tiktok, twitter)
            VALUES (
                ${accountId},
                ${day.toISOString().split('T')[0]},
                ${counts.instagram},
                ${counts.youtube},
                ${counts.tiktok},
                ${counts.twitter}
            )
            ON CONFLICT (account_id, day)
            DO UPDATE SET
                instagram = EXCLUDED.instagram,
                youtube   = EXCLUDED.youtube,
                tiktok    = EXCLUDED.tiktok,
                twitter   = EXCLUDED.twitter
        `;
    }
}
