# Multi-Account Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move account configuration from hardcoded env vars to DB-managed, FE-configurable accounts with per-account content assignment via junction tables.

**Architecture:** Add `ig_access_token`, `ig_user_id`, `gcs_bucket_name` columns to `accounts` table. Create junction tables (`account_captions`, `account_hooks`, `account_hashtag_combinations`) for many-to-many content-account relationships. All services load credentials from DB instead of env vars. New CRUD endpoints for accounts and content assignment.

**Tech Stack:** Bun, TypeScript, PostgreSQL (Neon), Zod validation

---

### Task 1: Schema Migration — Extend accounts table and create junction tables

**Files:**
- Modify: `src/services/database.ts:28-203` (initializeSchema method)
- Modify: `src/types/index.ts:116-120` (DbAccount type)

**Step 1: Add columns to accounts table in initializeSchema**

In `src/services/database.ts`, after the existing `accounts` CREATE TABLE (line 93-99), add migration blocks to add the new columns:

```typescript
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
```

**Step 2: Create junction tables in initializeSchema**

Add after the accounts column migrations:

```typescript
// Junction tables for many-to-many account-content relationships
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
```

**Step 3: Update DbAccount type**

In `src/types/index.ts`, update the `DbAccount` interface:

```typescript
export interface DbAccount {
    id: number;
    name: string;
    ig_access_token: string;
    ig_user_id: string;
    gcs_bucket_name: string;
    created_at: Date;
}
```

**Step 4: Seed existing accounts with credentials from env vars**

In `src/services/database.ts`, update the seed statements (lines 102-109) to include credentials:

```typescript
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
```

**Step 5: Seed junction tables with existing content for both accounts**

Add after the account seed:

```typescript
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
```

**Step 6: Run the app to verify schema migration**

Run: `bun run src/index.ts`
Expected: Server starts, logs "Database schema initialized" without errors. Ctrl+C to stop.

---

### Task 2: Account CRUD — Database methods

**Files:**
- Modify: `src/services/database.ts` (add methods after getAccounts on line 604)

**Step 1: Update getAccounts to include new fields**

Replace the existing `getAccounts` method (line 604-609):

```typescript
async getAccounts(): Promise<DbAccount[]> {
    const result = await this.sql`
        SELECT id, name, ig_access_token, ig_user_id, gcs_bucket_name, created_at
        FROM accounts ORDER BY id
    ` as DbAccount[];
    return result;
}
```

**Step 2: Add getAccount (single account by ID)**

```typescript
async getAccount(id: number): Promise<DbAccount | null> {
    const result = await this.sql`
        SELECT id, name, ig_access_token, ig_user_id, gcs_bucket_name, created_at
        FROM accounts WHERE id = ${id}
    ` as DbAccount[];
    return result.length > 0 ? result[0] : null;
}
```

**Step 3: Add createAccount**

```typescript
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
```

**Step 4: Add updateAccount**

```typescript
async updateAccount(
    id: number,
    fields: { name?: string; ig_access_token?: string; ig_user_id?: string; gcs_bucket_name?: string }
): Promise<DbAccount | null> {
    // Build SET clause dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];

    if (fields.name !== undefined) { updates.push('name'); values.push(fields.name); }
    if (fields.ig_access_token !== undefined) { updates.push('ig_access_token'); values.push(fields.ig_access_token); }
    if (fields.ig_user_id !== undefined) { updates.push('ig_user_id'); values.push(fields.ig_user_id); }
    if (fields.gcs_bucket_name !== undefined) { updates.push('gcs_bucket_name'); values.push(fields.gcs_bucket_name); }

    if (updates.length === 0) return this.getAccount(id);

    // Use individual update queries since neon doesn't support dynamic column names easily
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
```

**Step 5: Add deleteAccount (with post-check guard)**

```typescript
async deleteAccount(id: number): Promise<{ deleted: boolean; error?: string }> {
    // Check if account has any posts
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
```

---

### Task 3: Junction table management — Database methods

**Files:**
- Modify: `src/services/database.ts` (add methods)

**Step 1: Add content-account assignment methods**

```typescript
// --- Junction table methods ---

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
```

---

### Task 4: Account-scoped content queries — Update getRandomCaption, getRandomHook, getRandomHashtags, getAllCaptions, getAllHooks

**Files:**
- Modify: `src/services/database.ts` (update existing methods)

**Step 1: Update getRandomCaption to accept accountId**

Replace `getRandomCaption()` (line 436-445):

```typescript
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
```

**Step 2: Update getRandomHook to accept accountId**

Replace `getRandomHook()` (line 450-459):

```typescript
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
```

**Step 3: Update getRandomHashtags to accept accountId**

Replace `getRandomHashtags()` (line 464-472). Hashtags are accessed via hashtag_combinations, so we need to get random hashtags from combinations assigned to this account:

```typescript
async getRandomHashtags(accountId: number, count: number = 5): Promise<DbHashtag[]> {
    const result = await this.sql`
        SELECT DISTINCT h.id, h.text, h.created_at
        FROM hashtags h
        JOIN hashtag_combinations hc ON h.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
        JOIN account_hashtag_combinations ahc ON ahc.hashtag_combination_id = hc.id AND ahc.account_id = ${accountId}
        ORDER BY RANDOM()
        LIMIT ${count}
    ` as DbHashtag[];
    return result;
}
```

**Step 4: Update getAllCaptions to accept optional accountId**

Replace `getAllCaptions` (line 614-630):

```typescript
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
```

**Step 5: Update getAllHooks to accept optional accountId**

Replace `getAllHooks` (line 635-651):

```typescript
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
```

---

### Task 5: Update Config — Remove per-account env vars from config

**Files:**
- Modify: `src/config/index.ts`
- Modify: `src/types/index.ts:54-75` (Config type)

**Step 1: Remove instagram accounts and GCS bucket from config**

Replace `src/config/index.ts` entirely:

```typescript
import type { Config } from '../types/index.js';

export function getConfig(): Config {
    const requiredEnvVars = [
        'GCS_PROJECT_ID',
        'DATABASE_URL',
        'ANTHROPIC_API_KEY',
    ];

    const missing = requiredEnvVars.filter((varName) => !process.env[varName]);

    if (missing.length > 0 && process.env.NODE_ENV === 'production') {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return {
        port: parseInt(process.env.PORT || '3000', 10),
        nodeEnv: process.env.NODE_ENV || 'development',
        gcs: {
            projectId: process.env.GCS_PROJECT_ID || '',
        },
        tempDir: process.env.TEMP_DIR || './tmp',
        databaseUrl: process.env.DATABASE_URL || '',
        dashboard: {
            password: process.env.DASHBOARD_PASSWORD || '',
            neonAuthUrl: process.env.NEON_AUTH_URL,
            neonJwksUrl: process.env.NEON_JWKS_URL,
        },
        anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY || '',
        },
    };
}
```

**Step 2: Update Config type**

In `src/types/index.ts`, replace the Config interface (lines 54-75):

```typescript
export interface Config {
    port: number;
    nodeEnv: string;
    gcs: {
        projectId: string;
    };
    tempDir: string;
    databaseUrl: string;
    dashboard: {
        password: string;
        neonAuthUrl?: string;
        neonJwksUrl?: string;
    };
    anthropic: {
        apiKey: string;
    };
}
```

---

### Task 6: Update InstagramClientService — Load credentials from DB

**Files:**
- Modify: `src/services/instagram-client.ts`

**Step 1: Refactor to accept credentials per-call instead of from config**

Replace the constructor and getCredentials (lines 1-20):

```typescript
import { logger } from '../utils/logger.js';
import type { InstagramPost } from '../types/index.js';

export class InstagramClientService {
    private baseUrl = 'https://graph.instagram.com/v18.0';

    /**
     * Create an Instagram client with specific credentials.
     * Credentials are passed per-instance (loaded from DB by the caller).
     */
    constructor(
        private accessToken: string,
        private userId: string
    ) {}
```

**Step 2: Update all methods to use instance credentials instead of accountId lookup**

Replace every method that calls `this.getCredentials(accountId)` — remove `accountId` parameter from methods and use `this.accessToken`/`this.userId` directly:

- `createMediaContainer`: Remove `accountId` param, use `this.accessToken`, `this.userId`
- `checkContainerStatus`: Remove `accountId` param, use `this.accessToken`
- `waitForContainerReady`: Remove `accountId` param
- `publishMedia`: Remove `accountId` param, use `this.accessToken`, `this.userId`
- `getAccountInfo`: Remove `accountId` param, use `this.accessToken`, `this.userId`
- `postReel`: Remove `accountId` param
- `getMediaInsights`: Remove `accountId` param, use `this.accessToken`

For example, `createMediaContainer` becomes:

```typescript
async createMediaContainer(
    videoUrl: string,
    caption: string,
    shareToFeed: boolean = false
): Promise<string> {
    try {
        const params = new URLSearchParams({
            media_type: 'REELS',
            video_url: videoUrl,
            caption: caption,
            access_token: this.accessToken,
            share_to_feed: shareToFeed ? 'true' : 'false',
        });

        const response = await fetch(
            `${this.baseUrl}/${this.userId}/media?${params}`,
            { method: 'POST' }
        );
        // ... rest unchanged
```

And `postReel` becomes:

```typescript
async postReel(
    videoUrl: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean = false
): Promise<InstagramPost> {
    const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
    const fullCaption = `${caption}\n\n${hashtagString}`;

    logger.info('Creating media container for Reel');
    const containerId = await this.createMediaContainer(videoUrl, fullCaption, shareToFeed);

    logger.info('Waiting for container to be ready');
    await this.waitForContainerReady(containerId);

    logger.info('Publishing Reel');
    const mediaId = await this.publishMedia(containerId);

    return { id: mediaId, status: 'published', containerId };
}
```

And `getMediaInsights` becomes:

```typescript
async getMediaInsights(mediaId: string): Promise<number> {
    try {
        const params = new URLSearchParams({
            metric: 'views',
            access_token: this.accessToken,
        });
        // ... rest unchanged, just remove accountId from parameter list
```

---

### Task 7: Update VideoSelectorService — Parameterized bucket name

**Files:**
- Modify: `src/services/video-selector.ts`

**Step 1: Refactor constructor to accept bucketName parameter**

Replace the constructor (lines 7-23):

```typescript
export class VideoSelectorService {
    private bucketName: string;
    private tempDir: string;

    constructor(bucketName: string) {
        const config = getConfig();

        this.bucketName = bucketName;
        this.tempDir = config.tempDir;

        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }
```

Remove `this.projectId` since it's no longer used anywhere in the service (the GCS public API doesn't need project ID).

Also remove the `import { getConfig } from '../config/index.js';` if config is only used for tempDir. Actually, keep it for `tempDir`.

---

### Task 8: Update post-reel route — Fetch account from DB, pass to services

**Files:**
- Modify: `src/routes/post-reel.ts`
- Modify: `src/utils/validation.ts` (make accountId required, remove max:2 constraint)

**Step 1: Update validation schema**

In `src/utils/validation.ts`, change `accountId` to required and remove the `.max(2)` constraint:

```typescript
export const postReelSchema = z.object({
    caption: z.string().min(1, 'Caption cannot be empty').max(2200, 'Caption too long').optional(),
    hookText: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long').optional(),
    hashtags: z.array(z.string().regex(/^[a-zA-Z0-9_]+$/, 'Invalid hashtag format'))
        .min(1, 'At least one hashtag required if provided')
        .max(30, 'Maximum 30 hashtags allowed')
        .optional(),
    shareToFeed: z.boolean().optional(),
    accountId: z.number().int().min(1, 'accountId is required'),
    videoTitle: z.string().min(1, 'Video title cannot be empty').max(500, 'Video title too long').optional(),
});
```

**Step 2: Update PostReelRequest type**

In `src/types/index.ts`, make `accountId` required:

```typescript
export interface PostReelRequest {
    caption?: string;
    hookText?: string;
    hashtags?: string[];
    shareToFeed?: boolean;
    accountId: number;
}
```

**Step 3: Update handlePostReel to fetch account and use its credentials**

In `src/routes/post-reel.ts`, update the main handler. Key changes:

1. Fetch account from DB after validation
2. Create `VideoSelectorService` with account's bucket name
3. Pass `accountId` to `getRandomCaption`, `getRandomHook`, `getRandomHashtags`

Replace `const accountId = validation.data.accountId ?? 2;` (line 180) with:

```typescript
const accountId = validation.data.accountId;

// Fetch account from DB
const account = await db.getAccount(accountId);
if (!account) {
    return Response.json(
        { success: false, error: `Account ${accountId} not found` },
        { status: 404 }
    );
}
```

Replace `const videoSelector = new VideoSelectorService();` (line 176) with:

```typescript
const videoSelector = new VideoSelectorService(account.gcs_bucket_name);
```

Update auto-select calls to pass accountId:

```typescript
// Auto-select caption from database if not provided
if (!caption) {
    const dbCaption = await db.getRandomCaption(accountId);
    // ...
}

// Auto-select hookText from database if not provided
if (!hookText) {
    const dbHook = await db.getRandomHook(accountId);
    // ...
}

// Auto-select hashtags from database if not provided
if (!hashtags || hashtags.length === 0) {
    const dbHashtags = await db.getRandomHashtags(accountId, 5);
    // ...
}
```

**Step 4: Update processPostInBackground to use account credentials**

In `processPostInBackground`, replace the service construction. The function needs to receive the account or its credentials. Add `account` parameter:

```typescript
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
    const instagramClient = new InstagramClientService(account.ig_access_token, account.ig_user_id);
    // ... rest unchanged
```

Update the `setImmediate` call to pass `account` instead of `accountId`:

```typescript
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
    ).catch((err) => { ... });
});
```

Also update the `instagramClient.postReel` call inside processPostInBackground to remove accountId:

```typescript
const instagramPost = await instagramClient.postReel(
    editedVideoUrl,
    caption,
    hashtags,
    shareToFeed
);
```

Add the import for DbAccount at top of file:

```typescript
import type { PostReelResponse, DbAccount } from '../types/index.js';
```

---

### Task 9: Update videos route — Account-scoped bucket listing

**Files:**
- Modify: `src/routes/videos.ts`

**Step 1: Require accountId and use account's bucket**

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { VideoSelectorService } from '../services/video-selector.js';
import { DatabaseService } from '../services/database.js';

export async function handleVideos(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized videos request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin videos request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');

        if (!accountIdParam) {
            return Response.json(
                { success: false, error: 'accountId query parameter is required' },
                { status: 400 }
            );
        }

        const accountId = parseInt(accountIdParam, 10);
        if (isNaN(accountId)) {
            return Response.json(
                { success: false, error: 'accountId must be a number' },
                { status: 400 }
            );
        }

        const db = new DatabaseService();
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: `Account ${accountId} not found` },
                { status: 404 }
            );
        }

        const videoSelector = new VideoSelectorService(account.gcs_bucket_name);
        const videos = await videoSelector.listAllVideoNames();

        return Response.json({ success: true, videos });
    } catch (error) {
        logger.error('Error fetching videos', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to fetch videos' },
            { status: 500 }
        );
    }
}
```

---

### Task 10: Update test-instagram route — Use DB credentials

**Files:**
- Modify: `src/routes/test-instagram.ts`

**Step 1: Load account credentials from DB for each account test**

Replace the handler body to create InstagramClientService per-account from DB credentials:

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { InstagramClientService } from '../services/instagram-client.js';
import { DatabaseService } from '../services/database.js';

export async function handleTestInstagram(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    try {
        const db = new DatabaseService();
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');

        let accounts;
        if (accountIdParam) {
            const account = await db.getAccount(parseInt(accountIdParam, 10));
            accounts = account ? [account] : [];
        } else {
            accounts = await db.getAccounts();
        }

        const results = [];
        let allSuccess = true;

        for (const account of accounts) {
            try {
                const instagramClient = new InstagramClientService(account.ig_access_token, account.ig_user_id);
                const accountInfo = await instagramClient.getAccountInfo();
                results.push({
                    id: account.id,
                    name: account.name,
                    username: accountInfo.username,
                    account_type: accountInfo.account_type,
                    media_count: accountInfo.media_count,
                    success: true,
                });
            } catch (error) {
                allSuccess = false;
                results.push({
                    id: account.id,
                    name: account.name,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        return Response.json({ success: allSuccess, accounts: results });
    } catch (error) {
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to verify Instagram credentials' },
            { status: 500 }
        );
    }
}
```

---

### Task 11: Update views-sync-cron — Per-account credential loading

**Files:**
- Modify: `src/services/views-sync-cron.ts`

**Step 1: Remove InstagramClientService from constructor, create per-account in syncViews**

```typescript
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

    // start(), runAndScheduleNext(), stop() stay the same

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
```

---

### Task 12: Update stats route — Remove hardcoded accountId validation

**Files:**
- Modify: `src/routes/stats.ts:36-44`

**Step 1: Remove the `accountId !== 1 && accountId !== 2` check**

Replace lines 36-44:

```typescript
if (accountIdParam !== null) {
    accountId = parseInt(accountIdParam, 10);
    if (isNaN(accountId) || accountId < 1) {
        return Response.json(
            { success: false, error: 'accountId must be a positive integer' },
            { status: 400 }
        );
    }
}
```

---

### Task 13: Account CRUD API routes

**Files:**
- Create: `src/routes/accounts.ts`
- Modify: `src/index.ts` (add route wiring)

**Step 1: Create accounts route handler**

Create `src/routes/accounts.ts`:

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { z } from 'zod';

const createAccountSchema = z.object({
    name: z.string().min(1, 'Name cannot be empty').max(200, 'Name too long'),
    ig_access_token: z.string().min(1, 'Instagram access token is required'),
    ig_user_id: z.string().min(1, 'Instagram user ID is required'),
    gcs_bucket_name: z.string().min(1, 'GCS bucket name is required'),
});

const updateAccountSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    ig_access_token: z.string().min(1).optional(),
    ig_user_id: z.string().min(1).optional(),
    gcs_bucket_name: z.string().min(1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

const assignContentSchema = z.object({
    captionIds: z.array(z.number().int().min(1)).optional(),
    hookIds: z.array(z.number().int().min(1)).optional(),
    hashtagCombinationIds: z.array(z.number().int().min(1)).optional(),
});

function maskToken(token: string): string {
    if (token.length <= 8) return '****';
    return token.slice(0, 4) + '...' + token.slice(-4);
}

export async function handleAccounts(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        if (request.method === 'GET') {
            const accounts = await db.getAccounts();
            return Response.json({
                success: true,
                accounts: accounts.map(a => ({
                    ...a,
                    ig_access_token: maskToken(a.ig_access_token),
                })),
            });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createAccountSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            try {
                const account = await db.createAccount(
                    parsed.data.name,
                    parsed.data.ig_access_token,
                    parsed.data.ig_user_id,
                    parsed.data.gcs_bucket_name
                );
                return Response.json({
                    success: true,
                    account: { ...account, ig_access_token: maskToken(account.ig_access_token) },
                }, { status: 201 });
            } catch (error: any) {
                if (error?.code === '23505' || error?.message?.includes('unique')) {
                    return Response.json(
                        { success: false, error: 'An account with this name already exists' },
                        { status: 409 }
                    );
                }
                throw error;
            }
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling accounts request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process accounts request' },
            { status: 500 }
        );
    }
}

export async function handleAccountById(request: Request, id: number): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        if (request.method === 'PATCH') {
            const body = await request.json();
            const parsed = updateAccountSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
                    { status: 400 }
                );
            }
            const account = await db.updateAccount(id, parsed.data);
            if (!account) {
                return Response.json(
                    { success: false, error: 'Account not found' },
                    { status: 404 }
                );
            }
            return Response.json({
                success: true,
                account: { ...account, ig_access_token: maskToken(account.ig_access_token) },
            });
        }

        if (request.method === 'DELETE') {
            const result = await db.deleteAccount(id);
            if (result.error) {
                return Response.json(
                    { success: false, error: result.error },
                    { status: 409 }
                );
            }
            if (!result.deleted) {
                return Response.json(
                    { success: false, error: 'Account not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling account by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process account request' },
            { status: 500 }
        );
    }
}

export async function handleAccountContent(request: Request, accountId: number, contentType: string, contentId?: number): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        // Verify account exists
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: 'Account not found' },
                { status: 404 }
            );
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = assignContentSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }

            if (contentType === 'captions' && parsed.data.captionIds) {
                await db.assignCaptionsToAccount(accountId, parsed.data.captionIds);
            } else if (contentType === 'hooks' && parsed.data.hookIds) {
                await db.assignHooksToAccount(accountId, parsed.data.hookIds);
            } else if (contentType === 'hashtag-combinations' && parsed.data.hashtagCombinationIds) {
                await db.assignHashtagCombinationsToAccount(accountId, parsed.data.hashtagCombinationIds);
            } else {
                return Response.json(
                    { success: false, error: `Missing ${contentType} IDs in request body` },
                    { status: 400 }
                );
            }

            return Response.json({ success: true });
        }

        if (request.method === 'DELETE' && contentId !== undefined) {
            let removed = false;
            if (contentType === 'captions') {
                removed = await db.removeCaptionFromAccount(accountId, contentId);
            } else if (contentType === 'hooks') {
                removed = await db.removeHookFromAccount(accountId, contentId);
            } else if (contentType === 'hashtag-combinations') {
                removed = await db.removeHashtagCombinationFromAccount(accountId, contentId);
            }

            if (!removed) {
                return Response.json(
                    { success: false, error: 'Assignment not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling account content request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process account content request' },
            { status: 500 }
        );
    }
}
```

**Step 2: Wire routes into index.ts**

In `src/index.ts`, add the import and route matching.

Add import:
```typescript
import { handleAccounts, handleAccountById, handleAccountContent } from './routes/accounts.js';
```

Add routes in the `fetch` handler (after the existing routes, before the 404), and add DELETE to the CORS allowed methods:

```typescript
// Accounts CRUD
if (url.pathname === '/api/accounts' && (request.method === 'GET' || request.method === 'POST')) {
    return withCors(await handleAccounts(request), request);
}

const accountByIdMatch = url.pathname.match(/^\/api\/accounts\/(\d+)$/);
if (accountByIdMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    return withCors(await handleAccountById(request, parseInt(accountByIdMatch[1], 10)), request);
}

// Account content assignment
const accountContentMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/(captions|hooks|hashtag-combinations)$/);
if (accountContentMatch && request.method === 'POST') {
    return withCors(await handleAccountContent(request, parseInt(accountContentMatch[1], 10), accountContentMatch[2]), request);
}

const accountContentItemMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/(captions|hooks|hashtag-combinations)\/(\d+)$/);
if (accountContentItemMatch && request.method === 'DELETE') {
    return withCors(await handleAccountContent(
        request,
        parseInt(accountContentItemMatch[1], 10),
        accountContentItemMatch[2],
        parseInt(accountContentItemMatch[3], 10)
    ), request);
}
```

Update CORS allowed methods to include DELETE:
```typescript
'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
```

---

### Task 14: Update captions and hooks routes — Add accountId filtering and optional assignment on create

**Files:**
- Modify: `src/routes/captions.ts`
- Modify: `src/routes/hooks.ts`

**Step 1: Update captions GET to support accountId filter**

In `src/routes/captions.ts`, update the GET handler:

```typescript
if (request.method === 'GET') {
    const showAll = url.searchParams.get('all') === 'true';
    const accountIdParam = url.searchParams.get('accountId');
    const accountId = accountIdParam ? parseInt(accountIdParam, 10) : undefined;
    const captions = await db.getAllCaptions(!showAll, accountId);
    return Response.json({ success: true, captions });
}
```

**Step 2: Update captions POST to support optional accountIds**

Update the create caption schema and handler:

```typescript
const createCaptionSchema = z.object({
    text: z.string().min(1, 'Caption text cannot be empty').max(2200, 'Caption text too long'),
    accountIds: z.array(z.number().int().min(1)).optional(),
});
```

In the POST handler, after creating the caption:

```typescript
if (request.method === 'POST') {
    const body = await request.json();
    const parsed = createCaptionSchema.safeParse(body);
    if (!parsed.success) {
        return Response.json(
            { success: false, error: parsed.error.errors[0].message },
            { status: 400 }
        );
    }
    const caption = await db.createCaption(parsed.data.text);
    if (!caption) {
        return Response.json(
            { success: false, error: 'A caption with this text already exists' },
            { status: 409 }
        );
    }
    // Assign to accounts if specified
    if (parsed.data.accountIds && parsed.data.accountIds.length > 0) {
        await db.assignCaptionsToAccount(parsed.data.accountIds[0], [caption.id]);
        for (let i = 1; i < parsed.data.accountIds.length; i++) {
            await db.assignCaptionsToAccount(parsed.data.accountIds[i], [caption.id]);
        }
    }
    return Response.json({ success: true, caption }, { status: 201 });
}
```

**Step 3: Apply same pattern to hooks route**

Same changes in `src/routes/hooks.ts`:

```typescript
const createHookSchema = z.object({
    text: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long'),
    accountIds: z.array(z.number().int().min(1)).optional(),
});
```

GET handler:
```typescript
if (request.method === 'GET') {
    const showAll = url.searchParams.get('all') === 'true';
    const accountIdParam = url.searchParams.get('accountId');
    const accountId = accountIdParam ? parseInt(accountIdParam, 10) : undefined;
    const hooks = await db.getAllHooks(!showAll, accountId);
    return Response.json({ success: true, hooks });
}
```

POST handler — after creating hook, assign to accounts:
```typescript
if (parsed.data.accountIds && parsed.data.accountIds.length > 0) {
    for (const accId of parsed.data.accountIds) {
        await db.assignHooksToAccount(accId, [hook.id]);
    }
}
```

---

### Task 15: Compile and verify

**Step 1: Run TypeScript compilation check**

Run: `bunx tsc --noEmit`
Expected: No errors. Fix any type errors found.

**Step 2: Start the server and verify it runs**

Run: `bun run src/index.ts`
Expected: Server starts, schema initializes, cron jobs start. Ctrl+C to stop.

---

### Task 16: Update .env.example

**Files:**
- Modify: `.env.example` (if it exists, otherwise skip)

**Step 1: Update env example to remove per-account vars, add note about DB**

Remove `INSTAGRAM_ACCESS_TOKEN_1`, `INSTAGRAM_USER_ID_1`, `INSTAGRAM_ACCESS_TOKEN_2`, `INSTAGRAM_USER_ID_2`, `GCS_BUCKET_NAME` from the example. Add a comment that account credentials are now managed via the API/DB.

Keep: `GCS_PROJECT_ID`, `DATABASE_URL`, `DASHBOARD_PASSWORD`, `NEON_JWKS_URL`, `NEON_AUTH_URL`, `ANTHROPIC_API_KEY`.

Note: The existing env vars are still read during the seed migration (Task 1, Step 4) to populate the DB for the first time. After first run, they're no longer needed.

