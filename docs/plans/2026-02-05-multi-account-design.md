# Multi-Account Instagram Posting — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support posting Instagram reels to multiple accounts, with per-account video selection, per-account stats filtering, and multi-account credential checking.

**Architecture:** Add an `accounts` table and `account_id` FK on `posts`. The Instagram client methods accept an `accountId` to select credentials from config. Stats queries add optional `WHERE` clauses. Default account is 2 (backup).

**Tech Stack:** Bun, TypeScript, Neon PostgreSQL, Zod validation, bun:test

---

### Task 1: Update Types

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Update Config type**

Change the `instagram` property in the `Config` interface from:
```typescript
instagram: {
    accessToken: string;
    userId: string;
};
```
to:
```typescript
instagram: {
    accounts: Record<number, { accessToken: string; userId: string }>;
};
```

**Step 2: Add account_id to DbPost**

Add `account_id: number;` to the `DbPost` interface (after `hashtag_combination_id`).

**Step 3: Add accountId to PostReelRequest**

Add `accountId?: number;` to the `PostReelRequest` interface.

**Step 4: Add DbAccount type**

Add a new interface:
```typescript
export interface DbAccount {
    id: number;
    name: string;
    created_at: Date;
}
```

**Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: update types for multi-account support"
```

---

### Task 2: Update Config

**Files:**
- Modify: `src/config/index.ts`
- Modify: `.env.example`

**Step 1: Update .env.example**

Replace:
```
INSTAGRAM_ACCESS_TOKEN=your-instagram-access-token
INSTAGRAM_USER_ID=your-instagram-user-id
```
with:
```
# Instagram Graph API - Account 1 (Main)
INSTAGRAM_ACCESS_TOKEN_1=your-main-instagram-access-token
INSTAGRAM_USER_ID_1=your-main-instagram-user-id

# Instagram Graph API - Account 2 (Backup)
INSTAGRAM_ACCESS_TOKEN_2=your-backup-instagram-access-token
INSTAGRAM_USER_ID_2=your-backup-instagram-user-id
```

**Step 2: Update getConfig()**

Change `requiredEnvVars` from:
```typescript
'INSTAGRAM_ACCESS_TOKEN',
'INSTAGRAM_USER_ID',
```
to:
```typescript
'INSTAGRAM_ACCESS_TOKEN_1',
'INSTAGRAM_USER_ID_1',
'INSTAGRAM_ACCESS_TOKEN_2',
'INSTAGRAM_USER_ID_2',
```

Change the return object's `instagram` property from:
```typescript
instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
    userId: process.env.INSTAGRAM_USER_ID || '',
},
```
to:
```typescript
instagram: {
    accounts: {
        1: {
            accessToken: process.env.INSTAGRAM_ACCESS_TOKEN_1 || '',
            userId: process.env.INSTAGRAM_USER_ID_1 || '',
        },
        2: {
            accessToken: process.env.INSTAGRAM_ACCESS_TOKEN_2 || '',
            userId: process.env.INSTAGRAM_USER_ID_2 || '',
        },
    },
},
```

**Step 3: Commit**

```bash
git add src/config/index.ts .env.example
git commit -m "feat: update config for multi-account Instagram credentials"
```

---

### Task 3: Update Database Service

**Files:**
- Modify: `src/services/database.ts`

**Step 1: Add accounts table creation and seeding to initializeSchema()**

After the `posts` table creation (after line 86), add:

```typescript
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
```

**Step 2: Add account_id column migration to initializeSchema()**

After the `instagram_post_id` migration block (after line 99), add:

```typescript
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
```

**Step 3: Add account_id index to initializeSchema()**

After the existing index creations:

```typescript
await this.sql`
    CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id)
`;
```

**Step 4: Update createPost() to accept accountId**

Change `createPost` signature from:
```typescript
async createPost(
    videoId: number,
    hookId: number,
    captionId: number,
    hashtagCombinationId: number,
    sharedToFeed: boolean = false
): Promise<DbPost> {
```
to:
```typescript
async createPost(
    videoId: number,
    hookId: number,
    captionId: number,
    hashtagCombinationId: number,
    sharedToFeed: boolean = false,
    accountId: number = 2
): Promise<DbPost> {
```

Update the INSERT query to include `account_id`:
```typescript
const result = await this.sql`
    INSERT INTO posts (video_id, hook_id, caption_id, hashtag_combination_id, shared_to_feed, account_id, status)
    VALUES (${videoId}, ${hookId}, ${captionId}, ${hashtagCombinationId}, ${sharedToFeed}, ${accountId}, 'pending')
    RETURNING id, video_id, hook_id, caption_id, hashtag_combination_id, instagram_post_id, views, status, account_id, created_at, updated_at
` as DbPost[];
```

**Step 5: Update getPostedVideoTitles() to accept accountId**

Change from:
```typescript
async getPostedVideoTitles(): Promise<string[]> {
    const result = await this.sql`
        SELECT title FROM videos
    ` as { title: string }[];
    return result.map((row) => row.title);
}
```
to:
```typescript
async getPostedVideoTitles(accountId: number): Promise<string[]> {
    const result = await this.sql`
        SELECT DISTINCT v.title FROM posts p
        JOIN videos v ON p.video_id = v.id
        WHERE p.account_id = ${accountId}
    ` as { title: string }[];
    return result.map((row) => row.title);
}
```

**Step 6: Update getPostsNeedingViewsUpdate() to include account_id**

Change the SELECT to also return `account_id`:
```typescript
async getPostsNeedingViewsUpdate(): Promise<DbPost[]> {
    const result = await this.sql`
        SELECT id, video_id, hook_id, caption_id, hashtag_combination_id,
               instagram_post_id, views, status, account_id, created_at, updated_at
        FROM posts
        WHERE status = 'success'
          AND views IS NULL
          AND instagram_post_id IS NOT NULL
          AND created_at <= NOW() - INTERVAL '5 days'
    ` as DbPost[];
    return result;
}
```

**Step 7: Add getAccounts() method**

```typescript
async getAccounts(): Promise<DbAccount[]> {
    const result = await this.sql`
        SELECT id, name, created_at FROM accounts ORDER BY id
    ` as DbAccount[];
    return result;
}
```

**Step 8: Commit**

```bash
git add src/services/database.ts
git commit -m "feat: add accounts table and account_id to posts in database service"
```

---

### Task 4: Update Instagram Client

**Files:**
- Modify: `src/services/instagram-client.ts`

**Step 1: Change constructor to store all account credentials**

Replace the constructor and instance properties:

From:
```typescript
export class InstagramClientService {
    private accessToken: string;
    private userId: string;
    private baseUrl = 'https://graph.instagram.com/v18.0';

    constructor() {
        const config = getConfig();
        this.accessToken = config.instagram.accessToken;
        this.userId = config.instagram.userId;
    }
```

To:
```typescript
export class InstagramClientService {
    private accounts: Record<number, { accessToken: string; userId: string }>;
    private baseUrl = 'https://graph.instagram.com/v18.0';

    constructor() {
        const config = getConfig();
        this.accounts = config.instagram.accounts;
    }

    private getCredentials(accountId: number): { accessToken: string; userId: string } {
        const creds = this.accounts[accountId];
        if (!creds) {
            throw new Error(`No credentials found for account ID ${accountId}`);
        }
        return creds;
    }
```

**Step 2: Update createMediaContainer()**

Add `accountId: number` as the first parameter. Replace `this.accessToken` and `this.userId` with credentials lookup:

```typescript
async createMediaContainer(
    accountId: number,
    videoUrl: string,
    caption: string,
    shareToFeed: boolean = false
): Promise<string> {
    const { accessToken, userId } = this.getCredentials(accountId);
    try {
        const params = new URLSearchParams({
            media_type: 'REELS',
            video_url: videoUrl,
            caption: caption,
            access_token: accessToken,
            share_to_feed: shareToFeed ? 'true' : 'false',
        });

        const response = await fetch(
            `${this.baseUrl}/${userId}/media?${params}`,
            { method: 'POST' }
        );
```

(Rest of the method body stays the same.)

**Step 3: Update checkContainerStatus()**

Add `accountId: number` as the first parameter:

```typescript
async checkContainerStatus(
    accountId: number,
    containerId: string
): Promise<{ status: string; errorMessage?: string }> {
    const { accessToken } = this.getCredentials(accountId);
    try {
        const params = new URLSearchParams({
            fields: 'status_code,status',
            access_token: accessToken,
        });
```

(Rest stays the same.)

**Step 4: Update waitForContainerReady()**

Add `accountId: number` as the first parameter, pass it through to `checkContainerStatus`:

```typescript
async waitForContainerReady(
    accountId: number,
    containerId: string,
    maxAttempts: number = 30,
    initialDelayMs: number = 5000
): Promise<void> {
    // ...
    const { status, errorMessage } = await this.checkContainerStatus(accountId, containerId);
    // ... rest stays the same
```

**Step 5: Update publishMedia()**

Add `accountId: number` as the first parameter:

```typescript
async publishMedia(accountId: number, containerId: string): Promise<string> {
    const { accessToken, userId } = this.getCredentials(accountId);
    try {
        const params = new URLSearchParams({
            creation_id: containerId,
            access_token: accessToken,
        });

        const response = await fetch(
            `${this.baseUrl}/${userId}/media_publish?${params}`,
            { method: 'POST' }
        );
```

(Rest stays the same.)

**Step 6: Update getAccountInfo()**

Add `accountId: number` as the first parameter:

```typescript
async getAccountInfo(accountId: number): Promise<{
    id: string;
    username: string;
    account_type: string;
    media_count: number;
}> {
    const { accessToken, userId } = this.getCredentials(accountId);
    try {
        const params = new URLSearchParams({
            fields: 'id,username,account_type,media_count',
            access_token: accessToken,
        });

        const response = await fetch(
            `${this.baseUrl}/${userId}?${params}`
        );
```

(Rest stays the same.)

**Step 7: Update postReel()**

Add `accountId: number` as the first parameter, pass it through:

```typescript
async postReel(
    accountId: number,
    videoUrl: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean = false
): Promise<InstagramPost> {
    const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
    const fullCaption = `${caption}\n\n${hashtagString}`;

    logger.info('Creating media container for Reel', { accountId });
    const containerId = await this.createMediaContainer(accountId, videoUrl, fullCaption, shareToFeed);

    logger.info('Waiting for container to be ready', { accountId });
    await this.waitForContainerReady(accountId, containerId);

    logger.info('Publishing Reel', { accountId });
    const mediaId = await this.publishMedia(accountId, containerId);

    return {
        id: mediaId,
        status: 'published',
        containerId,
    };
}
```

**Step 8: Update getMediaInsights()**

Add `accountId: number` as the first parameter:

```typescript
async getMediaInsights(accountId: number, mediaId: string): Promise<number> {
    const { accessToken } = this.getCredentials(accountId);
    try {
        const params = new URLSearchParams({
            metric: 'ig_reels_aggregated_all_plays_count',
            access_token: accessToken,
        });
```

(Rest stays the same.)

**Step 9: Commit**

```bash
git add src/services/instagram-client.ts
git commit -m "feat: add accountId parameter to all Instagram client methods"
```

---

### Task 5: Update Validation

**Files:**
- Modify: `src/utils/validation.ts`

**Step 1: Add accountId to schema**

Change `postReelSchema` to:
```typescript
export const postReelSchema = z.object({
    caption: z.string().min(1, 'Caption cannot be empty').max(2200, 'Caption too long').optional(),
    hookText: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long').optional(),
    hashtags: z.array(z.string().regex(/^[a-zA-Z0-9_]+$/, 'Invalid hashtag format'))
        .min(1, 'At least one hashtag required if provided')
        .max(30, 'Maximum 30 hashtags allowed')
        .optional(),
    shareToFeed: z.boolean().optional(),
    accountId: z.number().int().min(1).max(2).optional(),
});
```

**Step 2: Commit**

```bash
git add src/utils/validation.ts
git commit -m "feat: add accountId validation to post reel schema"
```

---

### Task 6: Update Post Reel Route

**Files:**
- Modify: `src/routes/post-reel.ts`

**Step 1: Add accountId to processPostInBackground()**

Change the function signature to include `accountId`:

```typescript
async function processPostInBackground(
    postId: number,
    accountId: number,
    inputVideoPath: string,
    hookText: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean,
    db: DatabaseService
): Promise<void> {
```

Update the InstagramClientService call at line 58 (inside the function):
```typescript
const instagramPost = await instagramClient.postReel(
    accountId,
    videoUrl,
    caption,
    hashtags,
    shareToFeed
);
```

**Step 2: Update handlePostReel() to extract accountId**

After `let { caption, hookText, hashtags, shareToFeed } = validation.data;` (line 153), add:

```typescript
const accountId = validation.data.accountId ?? 2;
```

**Step 3: Update video selection to use per-account filtering**

Change line 212 from:
```typescript
const postedVideos = await db.getPostedVideoTitles();
```
to:
```typescript
const postedVideos = await db.getPostedVideoTitles(accountId);
```

**Step 4: Update createPost call to include accountId**

Change:
```typescript
const post = await db.createPost(
    dbVideo.id,
    dbHook.id,
    dbCaption.id,
    hashtagCombination.id,
    shareToFeed || false
);
```
to:
```typescript
const post = await db.createPost(
    dbVideo.id,
    dbHook.id,
    dbCaption.id,
    hashtagCombination.id,
    shareToFeed || false,
    accountId
);
```

**Step 5: Update setImmediate call to pass accountId**

```typescript
setImmediate(() => {
    processPostInBackground(
        post.id,
        accountId,
        localPath,
        hookText,
        caption,
        hashtags,
        shareToFeed || false,
        db
    ).catch((err) => {
```

**Step 6: Add accountId to logging**

In the `logger.info('Post reel request received', ...)` call, add `accountId`:
```typescript
logger.info('Post reel request received', {
    captionLength: caption.length,
    hookText,
    hashtagCount: hashtags.length,
    shareToFeed,
    accountId,
});
```

**Step 7: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: add multi-account support to post-reel route"
```

---

### Task 7: Update Stats Route

**Files:**
- Modify: `src/routes/stats.ts`

**Step 1: Parse accountId from query params**

At the start of the `try` block (after line 27), add:

```typescript
const url = new URL(request.url);
const accountIdParam = url.searchParams.get('accountId');
let accountId: number | null = null;

if (accountIdParam !== null) {
    accountId = parseInt(accountIdParam, 10);
    if (isNaN(accountId) || (accountId !== 1 && accountId !== 2)) {
        return Response.json(
            { success: false, error: 'accountId must be 1 or 2' },
            { status: 400 }
        );
    }
}
```

**Step 2: Pass accountId to all query functions**

Update the `Promise.all` block to pass `accountId`:

```typescript
const [
    topPostsResult,
    mostRecentPostResult,
    viewsMetricsResult,
    topCaptionsResult,
    topHooksResult,
    topHashtagCombinationsResult,
    topVideosResult,
] = await Promise.all([
    getTopPosts(sql, accountId),
    getMostRecentPost(sql, accountId),
    getViewsMetrics(sql, accountId),
    getTopCaptions(sql, accountId),
    getTopHooks(sql, accountId),
    getTopHashtagCombinations(sql, accountId),
    getTopVideos(sql, accountId),
]);
```

**Step 3: Update each query function to accept and use accountId**

For **getTopPosts**: change signature to `async function getTopPosts(sql: NeonSQL, accountId: number | null)`. Add conditional WHERE:

The existing WHERE is `WHERE p.views IS NOT NULL`. Change to:
```sql
WHERE p.views IS NOT NULL
${accountId !== null ? sql`AND p.account_id = ${accountId}` : sql``}
```

Note: Neon's tagged template doesn't support conditional fragments this way. Instead, use two separate queries:

```typescript
async function getTopPosts(sql: NeonSQL, accountId: number | null): Promise<PostWithDetails[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text
            ORDER BY p.views DESC
            LIMIT 10
        ` as RawPostRow[]
        : await sql`
            SELECT
                p.id, p.instagram_post_id, p.views, p.status, p.created_at, p.updated_at,
                v.id as video_id, v.title as video_title,
                h.id as hook_id, h.text as hook_text,
                c.id as caption_id, c.text as caption_text,
                COALESCE(ARRAY_AGG(ht.text ORDER BY ht.id) FILTER (WHERE ht.text IS NOT NULL), ARRAY[]::text[]) as hashtags
            FROM posts p
            JOIN videos v ON p.video_id = v.id
            JOIN hooks h ON p.hook_id = h.id
            JOIN captions c ON p.caption_id = c.id
            JOIN hashtag_combinations hc ON p.hashtag_combination_id = hc.id
            LEFT JOIN hashtags ht ON ht.id IN (hc.hashtag1_id, hc.hashtag2_id, hc.hashtag3_id, hc.hashtag4_id, hc.hashtag5_id)
            WHERE p.views IS NOT NULL
            GROUP BY p.id, v.id, v.title, h.id, h.text, c.id, c.text
            ORDER BY p.views DESC
            LIMIT 10
        ` as RawPostRow[];

    return rows.map(mapPostRow);
}
```

Apply the same pattern to all other query functions:
- **getMostRecentPost**: no WHERE changes needed for `views IS NOT NULL`, just add `AND p.account_id = ${accountId}` or not
- **getViewsMetrics**: filter on `account_id` in the WHERE
- **getTopCaptions**: add `AND p.account_id = ${accountId}` to WHERE
- **getTopHooks**: add `AND p.account_id = ${accountId}` to WHERE
- **getTopHashtagCombinations**: add `AND p.account_id = ${accountId}` to WHERE
- **getTopVideos**: add `AND p.account_id = ${accountId}` to WHERE

Each function gets the same ternary pattern: if `accountId !== null`, include the filter; otherwise, use the original query.

**Step 4: Commit**

```bash
git add src/routes/stats.ts
git commit -m "feat: add accountId query param filtering to stats endpoint"
```

---

### Task 8: Update Test Instagram Route

**Files:**
- Modify: `src/routes/test-instagram.ts`

**Step 1: Rewrite handler to check both accounts**

```typescript
export async function handleTestInstagram(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized test-instagram request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin test-instagram request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const instagramClient = new InstagramClientService();
        const db = new DatabaseService();
        const accounts = await db.getAccounts();

        const results = [];
        let allSuccess = true;

        for (const account of accounts) {
            try {
                const accountInfo = await instagramClient.getAccountInfo(account.id);
                logger.info('Instagram credentials test successful', {
                    accountId: account.id,
                    accountName: account.name,
                    username: accountInfo.username,
                });
                results.push({
                    id: account.id,
                    name: account.name,
                    username: accountInfo.username,
                    account_type: accountInfo.account_type,
                    media_count: accountInfo.media_count,
                    success: true,
                });
            } catch (error) {
                logger.error('Instagram credentials test failed for account', {
                    accountId: account.id,
                    accountName: account.name,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                allSuccess = false;
                results.push({
                    id: account.id,
                    name: account.name,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        return Response.json({
            success: allSuccess,
            accounts: results,
        });
    } catch (error) {
        logger.error('Instagram credentials test failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to verify Instagram credentials',
            },
            { status: 500 }
        );
    }
}
```

Add the missing import at the top:
```typescript
import { DatabaseService } from '../services/database.js';
```

**Step 2: Commit**

```bash
git add src/routes/test-instagram.ts
git commit -m "feat: check all account credentials in test-instagram endpoint"
```

---

### Task 9: Update Views Sync Cron

**Files:**
- Modify: `src/services/views-sync-cron.ts`

**Step 1: Update syncViews() to pass accountId to getMediaInsights**

In the `for (const post of posts)` loop, change:
```typescript
const views = await this.instagram.getMediaInsights(post.instagram_post_id);
```
to:
```typescript
const views = await this.instagram.getMediaInsights(post.account_id, post.instagram_post_id);
```

**Step 2: Commit**

```bash
git add src/services/views-sync-cron.ts
git commit -m "feat: use per-account credentials in views sync cron"
```

---

### Task 10: Update Unit Tests — Validation

**Files:**
- Modify: `tests/unit/validation.test.ts`

**Step 1: Add accountId tests**

After the existing tests (before the closing `});`), add:

```typescript
test('should pass with valid accountId', () => {
    const input = {
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test'],
        accountId: 1,
    };

    const result = validatePostReelRequest(input);
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.accountId).toBe(1);
    }
});

test('should pass with accountId 2', () => {
    const input = {
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test'],
        accountId: 2,
    };

    const result = validatePostReelRequest(input);
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.accountId).toBe(2);
    }
});

test('should fail with accountId 0', () => {
    const input = {
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test'],
        accountId: 0,
    };

    const result = validatePostReelRequest(input);
    expect(result.success).toBe(false);
});

test('should fail with accountId 3', () => {
    const input = {
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test'],
        accountId: 3,
    };

    const result = validatePostReelRequest(input);
    expect(result.success).toBe(false);
});

test('should fail with non-integer accountId', () => {
    const input = {
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test'],
        accountId: 1.5,
    };

    const result = validatePostReelRequest(input);
    expect(result.success).toBe(false);
});

test('should pass when accountId is not provided', () => {
    const input = {
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test'],
    };

    const result = validatePostReelRequest(input);
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.accountId).toBeUndefined();
    }
});
```

**Step 2: Run tests to verify they pass**

```bash
bun test tests/unit/validation.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/unit/validation.test.ts
git commit -m "test: add accountId validation tests"
```

---

### Task 11: Update Unit Tests — Instagram Client

**Files:**
- Modify: `tests/unit/instagram-client.test.ts`

**Step 1: Update the test to verify instantiation with multi-account config**

Replace the file contents:

```typescript
import { describe, test, expect } from 'bun:test';
import { InstagramClientService } from '../../src/services/instagram-client';

describe('InstagramClientService', () => {
    test('should instantiate without errors', () => {
        expect(() => {
            const service = new InstagramClientService();
        }).not.toThrow();
    });

    test('should throw when getting credentials for invalid account', () => {
        const service = new InstagramClientService();
        // Access the private method via casting — test that invalid account IDs are rejected
        expect(() => {
            (service as any).getCredentials(999);
        }).toThrow('No credentials found for account ID 999');
    });

    test('should return credentials for valid account IDs', () => {
        const service = new InstagramClientService();
        // Should not throw for account 1 and 2
        expect(() => {
            (service as any).getCredentials(1);
        }).not.toThrow();
        expect(() => {
            (service as any).getCredentials(2);
        }).not.toThrow();
    });
});
```

**Step 2: Run tests to verify they pass**

```bash
bun test tests/unit/instagram-client.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/unit/instagram-client.test.ts
git commit -m "test: update instagram client tests for multi-account credentials"
```

---

### Task 12: Update Unit Tests — Database

**Files:**
- Modify: `tests/unit/database.test.ts`

**Step 1: Update the createPost test**

Change the existing `createPost` test to pass `accountId`:

```typescript
describe('createPost', () => {
    test('should create post with pending status and default accountId', async () => {
        const mockPost = {
            id: 1,
            video_id: 1,
            hook_id: 1,
            caption_id: 1,
            hashtag_combination_id: 1,
            instagram_post_id: null,
            views: null,
            status: 'pending' as PostStatus,
            account_id: 2,
            created_at: new Date(),
            updated_at: new Date(),
        };
        mockSql.mockResolvedValueOnce([mockPost]);

        const result = await db.createPost(1, 1, 1, 1);

        expect(result).toEqual(mockPost);
        expect(result.status).toBe('pending');
        expect(result.account_id).toBe(2);
    });

    test('should create post with specified accountId', async () => {
        const mockPost = {
            id: 2,
            video_id: 1,
            hook_id: 1,
            caption_id: 1,
            hashtag_combination_id: 1,
            instagram_post_id: null,
            views: null,
            status: 'pending' as PostStatus,
            account_id: 1,
            created_at: new Date(),
            updated_at: new Date(),
        };
        mockSql.mockResolvedValueOnce([mockPost]);

        const result = await db.createPost(1, 1, 1, 1, false, 1);

        expect(result).toEqual(mockPost);
        expect(result.account_id).toBe(1);
    });
});
```

**Step 2: Update the getPostedVideoTitles tests**

```typescript
describe('getPostedVideoTitles', () => {
    test('should return array of video titles for account', async () => {
        mockSql.mockResolvedValueOnce([
            { title: 'video1.mp4' },
            { title: 'video2.mp4' },
        ]);

        const result = await db.getPostedVideoTitles(2);

        expect(result).toEqual(['video1.mp4', 'video2.mp4']);
    });

    test('should return empty array when no videos for account', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await db.getPostedVideoTitles(1);

        expect(result).toEqual([]);
    });
});
```

**Step 3: Add getAccounts test**

```typescript
describe('getAccounts', () => {
    test('should return all accounts', async () => {
        const mockAccounts = [
            { id: 1, name: 'Molars UK (MAIN ACCOUNT)', created_at: new Date() },
            { id: 2, name: 'MLRSUK (BACKUP ACCOUNT)', created_at: new Date() },
        ];
        mockSql.mockResolvedValueOnce(mockAccounts);

        const result = await db.getAccounts();

        expect(result).toEqual(mockAccounts);
        expect(result).toHaveLength(2);
    });
});
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/database.test.ts
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add tests/unit/database.test.ts
git commit -m "test: update database tests for multi-account support"
```

---

### Task 13: Update Integration Tests

**Files:**
- Modify: `tests/integration/post-reel.test.ts`
- Modify: `tests/integration/e2e.test.ts`

**Step 1: Add accountId tests to post-reel.test.ts**

Add after the existing tests:

```typescript
test('should reject invalid accountId', async () => {
    const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            caption: 'Caption',
            hookText: 'Hook',
            hashtags: ['test'],
            accountId: 3,
        }),
    });

    expect(response.status).toBe(400);
    const data = await response.json() as ApiResponse;
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation failed');
});

test('should accept valid accountId', async () => {
    const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            caption: 'Caption',
            hookText: 'Hook',
            hashtags: ['test'],
            accountId: 1,
        }),
    });

    // Should pass validation (may fail later due to credentials)
    expect([202, 400, 500]).toContain(response.status);
    if (response.status === 400) {
        const data = await response.json() as ApiResponse;
        // If 400, it shouldn't be a validation error for accountId
        expect(data.error).not.toBe('Validation failed');
    }
});
```

**Step 2: Add stats filtering test to e2e.test.ts**

Add a new describe block:

```typescript
describe('GET /api/stats - Account Filtering', () => {
    test('should reject invalid accountId query param', async () => {
        const response = await fetch(`${BASE_URL}/api/stats?accountId=3`);

        expect(response.status).toBe(400);
        const data = await response.json() as ApiResponse;
        expect(data.success).toBe(false);
    });

    test('should accept valid accountId query param', async () => {
        const response = await fetch(`${BASE_URL}/api/stats?accountId=1`);

        // May fail due to auth, but shouldn't be 400 for accountId
        expect([200, 401, 403]).toContain(response.status);
    });

    test('should accept no accountId (returns all)', async () => {
        const response = await fetch(`${BASE_URL}/api/stats`);

        expect([200, 401, 403]).toContain(response.status);
    });
});
```

**Step 3: Commit**

```bash
git add tests/integration/post-reel.test.ts tests/integration/e2e.test.ts
git commit -m "test: add multi-account integration tests"
```

---

### Task 14: Run All Tests and Verify

**Step 1: Run all unit tests**

```bash
bun test tests/unit
```

Expected: All pass.

**Step 2: Run TypeScript type checking**

```bash
bunx tsc --noEmit
```

Expected: No type errors.

**Step 3: Commit any fixes if needed**

---

### Task 15: Final Cleanup

**Step 1: Update the .env file**

Add the new env vars to the actual `.env` file (rename `INSTAGRAM_ACCESS_TOKEN` → `INSTAGRAM_ACCESS_TOKEN_1` etc). This is a manual step.

**Step 2: Verify the app starts**

```bash
bun run src/index.ts
```

Expected: Server starts, accounts table created and seeded, no errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete multi-account Instagram posting support"
```
