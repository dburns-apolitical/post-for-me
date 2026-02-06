# User Leaderboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track which dashboard user posted each reel and expose leaderboard data via the stats endpoint.

**Architecture:** Add `user_posts` table linking posts to neon_auth users. Extend auth to return user name from JWT. After successful posts, create user_posts entry. Add two leaderboard queries to stats endpoint.

**Tech Stack:** Bun, TypeScript, Neon PostgreSQL, Zod validation, bun:test

---

## Task 1: Add userName to AuthResult

**Files:**
- Modify: `src/utils/auth.ts:6-12`
- Test: `tests/unit/auth.test.ts` (create new)

**Step 1: Write the failing test**

Create `tests/unit/auth.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import type { AuthResult } from '../../src/utils/auth';

describe('AuthResult type', () => {
    test('should have userName property', () => {
        const result: AuthResult = {
            authenticated: true,
            isAdmin: true,
            method: 'bearer',
            userId: '70668aac-f6e0-4b40-b1f7-b7b4e0a72613',
            userName: 'Molars',
        };

        expect(result.userName).toBe('Molars');
    });

    test('should allow userName to be undefined', () => {
        const result: AuthResult = {
            authenticated: true,
            isAdmin: true,
            method: 'password',
        };

        expect(result.userName).toBeUndefined();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/auth.test.ts`
Expected: FAIL - Property 'userName' does not exist on type 'AuthResult'

**Step 3: Update AuthResult interface**

In `src/utils/auth.ts`, update the interface at lines 6-12:

```typescript
export interface AuthResult {
    authenticated: boolean;
    isAdmin: boolean;
    method?: 'password' | 'bearer';
    userId?: string;
    userName?: string;
    error?: string;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/auth.ts tests/unit/auth.test.ts
git commit -m "feat: add userName to AuthResult interface"
```

---

## Task 2: Extract userName from JWT and return in validateAuth

**Files:**
- Modify: `src/utils/auth.ts:76-86`
- Modify: `src/utils/auth.ts:102-106`
- Test: `tests/unit/auth.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/auth.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock neon before importing auth
const mockSql = mock(() => Promise.resolve([{ role: 'admin' }]));
mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Mock jose
mock.module('jose', () => ({
    jwtVerify: mock(() => Promise.resolve({
        payload: {
            sub: '70668aac-f6e0-4b40-b1f7-b7b4e0a72613',
            name: 'Molars',
            exp: Math.floor(Date.now() / 1000) + 3600,
        },
    })),
    createRemoteJWKSet: mock(() => ({})),
}));

import { validateAuth } from '../../src/utils/auth';

describe('validateAuth', () => {
    test('should return userName from JWT payload for bearer auth', async () => {
        const request = new Request('http://localhost/api/test', {
            headers: {
                'Authorization': 'Bearer valid-jwt-token',
            },
        });

        const result = await validateAuth(request);

        expect(result.authenticated).toBe(true);
        expect(result.method).toBe('bearer');
        expect(result.userId).toBe('70668aac-f6e0-4b40-b1f7-b7b4e0a72613');
        expect(result.userName).toBe('Molars');
    });

    test('should not have userName for password auth', async () => {
        const request = new Request('http://localhost/api/test', {
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const result = await validateAuth(request);

        expect(result.authenticated).toBe(true);
        expect(result.method).toBe('password');
        expect(result.userName).toBeUndefined();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/auth.test.ts`
Expected: FAIL - userName is undefined for bearer auth

**Step 3: Update TokenValidationResult interface**

In `src/utils/auth.ts`, update the interface at lines 102-106:

```typescript
interface TokenValidationResult {
    valid: boolean;
    userId?: string;
    userName?: string;
    error?: string;
}
```

**Step 4: Update validateBearerToken to extract name**

In `src/utils/auth.ts`, update the JWT verification success block around line 155:

```typescript
        return { valid: true, userId: payload.sub, userName: payload.name as string | undefined };
```

**Step 5: Update validateAuth to pass userName through**

In `src/utils/auth.ts`, update the bearer token success block at lines 76-86:

```typescript
        if (result.valid && result.userId) {
            // Check if user has admin role in neon_auth.users
            const isAdmin = await checkUserIsAdmin(result.userId);
            return {
                authenticated: true,
                isAdmin,
                method: 'bearer',
                userId: result.userId,
                userName: result.userName,
            };
        }
```

**Step 6: Update validateTokenBasic to extract name**

In `src/utils/auth.ts`, update the basic validation return around line 207:

```typescript
        return { valid: true, userId: payload.sub, userName: payload.name };
```

**Step 7: Run tests to verify they pass**

Run: `bun test tests/unit/auth.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/utils/auth.ts tests/unit/auth.test.ts
git commit -m "feat: extract userName from JWT in validateAuth"
```

---

## Task 3: Add user_posts table to database schema

**Files:**
- Modify: `src/services/database.ts:27-148`
- Test: Manual verification (schema creates on startup)

**Step 1: Add user_posts table creation to initializeSchema**

In `src/services/database.ts`, add after the accounts table creation (around line 106):

```typescript
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
```

**Step 2: Run all tests to verify nothing broke**

Run: `bun test tests/unit`
Expected: All existing tests pass

**Step 3: Commit**

```bash
git add src/services/database.ts
git commit -m "feat: add user_posts table to database schema"
```

---

## Task 4: Add createUserPost method to DatabaseService

**Files:**
- Modify: `src/services/database.ts`
- Test: `tests/unit/database.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/database.test.ts` inside the main describe block:

```typescript
    describe('createUserPost', () => {
        test('should insert user_post record', async () => {
            mockSql.mockResolvedValueOnce([]);

            await expect(
                db.createUserPost(1, '70668aac-f6e0-4b40-b1f7-b7b4e0a72613', 'Molars')
            ).resolves.toBeUndefined();
        });
    });
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/database.test.ts`
Expected: FAIL - db.createUserPost is not a function

**Step 3: Add createUserPost method**

Add to `src/services/database.ts` after the `getAllHooks` method:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/database.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/database.ts tests/unit/database.test.ts
git commit -m "feat: add createUserPost method to DatabaseService"
```

---

## Task 5: Add leaderboard types

**Files:**
- Modify: `src/types/index.ts`
- Test: Type checking (compilation)

**Step 1: Add leaderboard types**

Add to `src/types/index.ts` after the `DashboardStats` interface:

```typescript
export interface UserLeaderboardEntry {
    name: string;
    posts: number;
}

export interface UserViewsEntry {
    name: string;
    viewsPerVideo: number;
}
```

**Step 2: Update DashboardStats interface**

In `src/types/index.ts`, update the `DashboardStats` interface:

```typescript
export interface DashboardStats {
    topPosts: PostWithDetails[];
    mostRecentPost: PostWithDetails | null;
    viewsMetrics: ViewsMetrics;
    topCaptions: RankedItem[];
    topHooks: RankedItem[];
    topHashtagCombinations: RankedItem[];
    topVideos: RankedItem[];
    userLeaderboard: UserLeaderboardEntry[];
    userViewsPerVideo: UserViewsEntry[];
}
```

**Step 3: Run tests to check compilation**

Run: `bun test tests/unit`
Expected: PASS (or type errors if not all usages updated)

**Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add user leaderboard types"
```

---

## Task 6: Add leaderboard queries to stats endpoint

**Files:**
- Modify: `src/routes/stats.ts`
- Test: Integration test

**Step 1: Add getUserLeaderboard function**

Add to `src/routes/stats.ts` after the `getTopVideos` function:

```typescript
/**
 * Get user leaderboard - posts per user
 */
async function getUserLeaderboard(sql: NeonSQL, accountId: number | null): Promise<UserLeaderboardEntry[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT up.user_name as name, COUNT(*) as posts
            FROM user_posts up
            JOIN posts p ON up.post_id = p.id
            WHERE p.account_id = ${accountId}
            GROUP BY up.user_name
            ORDER BY posts DESC
        ` as { name: string; posts: string }[]
        : await sql`
            SELECT up.user_name as name, COUNT(*) as posts
            FROM user_posts up
            GROUP BY up.user_name
            ORDER BY posts DESC
        ` as { name: string; posts: string }[];

    return rows.map(row => ({
        name: row.name,
        posts: parseInt(row.posts, 10),
    }));
}

/**
 * Get user views per video - average views per user's posts
 */
async function getUserViewsPerVideo(sql: NeonSQL, accountId: number | null): Promise<UserViewsEntry[]> {
    const rows = accountId !== null
        ? await sql`
            SELECT up.user_name as name, ROUND(AVG(p.views)) as views_per_video
            FROM user_posts up
            JOIN posts p ON up.post_id = p.id
            WHERE p.views IS NOT NULL AND p.account_id = ${accountId}
            GROUP BY up.user_name
            ORDER BY views_per_video DESC
        ` as { name: string; views_per_video: string }[]
        : await sql`
            SELECT up.user_name as name, ROUND(AVG(p.views)) as views_per_video
            FROM user_posts up
            JOIN posts p ON up.post_id = p.id
            WHERE p.views IS NOT NULL
            GROUP BY up.user_name
            ORDER BY views_per_video DESC
        ` as { name: string; views_per_video: string }[];

    return rows.map(row => ({
        name: row.name,
        viewsPerVideo: parseInt(row.views_per_video, 10) || 0,
    }));
}
```

**Step 2: Add imports for new types**

Update the imports at the top of `src/routes/stats.ts`:

```typescript
import type {
    DashboardStats,
    PostWithDetails,
    RankedItem,
    ViewsMetrics,
    PostStatus,
    UserLeaderboardEntry,
    UserViewsEntry,
} from '../types/index.js';
```

**Step 3: Add leaderboard queries to Promise.all**

Update the Promise.all in `handleStats` (around line 46-62):

```typescript
        const [
            topPostsResult,
            mostRecentPostResult,
            viewsMetricsResult,
            topCaptionsResult,
            topHooksResult,
            topHashtagCombinationsResult,
            topVideosResult,
            userLeaderboardResult,
            userViewsPerVideoResult,
        ] = await Promise.all([
            getTopPosts(sql, accountId),
            getMostRecentPost(sql, accountId),
            getViewsMetrics(sql, accountId),
            getTopCaptions(sql, accountId),
            getTopHooks(sql, accountId),
            getTopHashtagCombinations(sql, accountId),
            getTopVideos(sql, accountId),
            getUserLeaderboard(sql, accountId),
            getUserViewsPerVideo(sql, accountId),
        ]);
```

**Step 4: Add leaderboard data to stats response**

Update the stats object (around line 64-73):

```typescript
        const stats: DashboardStats = {
            topPosts: topPostsResult,
            mostRecentPost: mostRecentPostResult,
            viewsMetrics: viewsMetricsResult,
            topCaptions: topCaptionsResult,
            topHooks: topHooksResult,
            topHashtagCombinations: topHashtagCombinationsResult,
            topVideos: topVideosResult,
            userLeaderboard: userLeaderboardResult,
            userViewsPerVideo: userViewsPerVideoResult,
        };
```

**Step 5: Run all tests**

Run: `bun test tests/unit`
Expected: PASS

**Step 6: Commit**

```bash
git add src/routes/stats.ts
git commit -m "feat: add user leaderboard queries to stats endpoint"
```

---

## Task 7: Pass user info to background processing and create user_posts

**Files:**
- Modify: `src/routes/post-reel.ts:14-23` (function signature)
- Modify: `src/routes/post-reel.ts:75` (call createUserPost)
- Modify: `src/routes/post-reel.ts:289-306` (pass user info)

**Step 1: Update processPostInBackground signature**

Update the function signature at lines 14-23:

```typescript
async function processPostInBackground(
    postId: number,
    accountId: number,
    inputVideoPath: string,
    hookText: string,
    caption: string,
    hashtags: string[],
    shareToFeed: boolean,
    db: DatabaseService,
    userId?: string,
    userName?: string
): Promise<void> {
```

**Step 2: Add createUserPost call after markPostSuccess**

After line 75 (`await db.markPostSuccess(postId, instagramPost.id);`), add:

```typescript
        // Step 7b: Create user_posts entry if user info available
        if (userId && userName) {
            logger.info('Creating user_posts entry', { postId, userId, userName });
            await db.createUserPost(postId, userId, userName);
        }
```

**Step 3: Update the setImmediate call to pass user info**

Update the call at lines 289-306:

```typescript
        // Start background processing (fire-and-forget)
        // Using setImmediate to ensure the response is sent first
        setImmediate(() => {
            processPostInBackground(
                post.id,
                accountId,
                localPath,
                hookText,
                caption,
                hashtags,
                shareToFeed || false,
                db,
                authResult.userId,
                authResult.userName
            ).catch((err) => {
                // This catch is a safety net - errors should be handled inside processPostInBackground
                logger.error('Unhandled error in background processing', {
                    postId: post.id,
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
            });
        });
```

**Step 4: Run all tests**

Run: `bun test tests/unit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: create user_posts entry on successful reel post"
```

---

## Task 8: Run full test suite

**Step 1: Run all unit tests**

Run: `bun test tests/unit`
Expected: All tests pass

**Step 2: Run all integration tests**

Run: `bun test tests/integration`
Expected: All tests pass

**Step 3: Commit any fixes if needed**

If any tests fail, fix them and commit with appropriate message.
