# Credentials Table Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple platform credentials from the accounts table into a dedicated credentials table, migrate existing Instagram credentials, and update the posting flow + API endpoints to use the new table.

**Architecture:** New `credentials` table with PostgreSQL ENUM for platform type and JSONB for credential data. Existing Instagram credentials migrated via idempotent startup SQL. All credential consumers (posting, testing, views sync) read from the new table. New CRUD API endpoints for credential management, existing account endpoints updated to stop accepting credential fields.

**Tech Stack:** Bun, TypeScript, PostgreSQL (Neon serverless), Zod validation

**Spec:** `docs/superpowers/specs/2026-03-14-credentials-table-design.md`

---

## Chunk 1: Types, Schema, Migration, and DB Methods

### Task 1: Add TypeScript types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add Platform, InstagramDirectCredentials, and DbCredential types**

Add after the `DbAccount` interface (line 131):

```typescript
export type Platform = 'instagram_direct' | 'upload_post';

export interface InstagramDirectCredentials {
    ig_access_token: string;
    ig_user_id: string;
}

export interface DbCredential {
    id: number;
    account_id: number;
    platform: Platform;
    credentials: InstagramDirectCredentials;
    created_at: Date;
}
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add Platform, InstagramDirectCredentials, and DbCredential types"
```

---

### Task 2: Add schema, migration, and index to initializeSchema()

**Files:**
- Modify: `src/services/database.ts:31-319` (initializeSchema method)

- [ ] **Step 1: Add ENUM creation, table creation, index, and data migration**

Add after the `idx_daily_views_day` index (line 317) and before the `logger.info('Database schema initialized')` line (line 319):

```typescript
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
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/database.ts
git commit -m "feat: add credentials table schema, index, and data migration"
```

---

### Task 3: Add credential database service methods

**Files:**
- Modify: `src/services/database.ts` (add methods after `deleteAccount` method, ~line 786)
- Modify: `src/services/database.ts:1-18` (add imports)

- [ ] **Step 1: Add DbCredential and Platform to the import block**

Update the import at the top of `src/services/database.ts` (line 4-16) to include the new types:

```typescript
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
    PostWithDetails,
    AgentEvaluation,
    ContentAccount,
    DbCredential,
    Platform,
} from '../types/index.js';
```

- [ ] **Step 2: Add credential CRUD methods**

Add after the `deleteAccount` method (~line 786):

```typescript
    // Credential methods

    async getCredentialsByAccountId(accountId: number): Promise<DbCredential[]> {
        return await this.sql`
            SELECT id, account_id, platform, credentials, created_at
            FROM credentials
            WHERE account_id = ${accountId}
            ORDER BY created_at DESC
        ` as DbCredential[];
    }

    async getCredentialsByPlatform(accountId: number, platform: Platform): Promise<DbCredential | null> {
        const result = await this.sql`
            SELECT id, account_id, platform, credentials, created_at
            FROM credentials
            WHERE account_id = ${accountId} AND platform = ${platform}
            ORDER BY created_at DESC
            LIMIT 1
        ` as DbCredential[];
        return result.length > 0 ? result[0] : null;
    }

    async createCredential(accountId: number, platform: Platform, credentials: DbCredential['credentials']): Promise<DbCredential> {
        const result = await this.sql`
            INSERT INTO credentials (account_id, platform, credentials)
            VALUES (${accountId}, ${platform}, ${JSON.stringify(credentials)})
            RETURNING id, account_id, platform, credentials, created_at
        ` as DbCredential[];
        return result[0];
    }

    async updateCredential(id: number, credentials: DbCredential['credentials']): Promise<DbCredential | null> {
        const result = await this.sql`
            UPDATE credentials
            SET credentials = ${JSON.stringify(credentials)}
            WHERE id = ${id}
            RETURNING id, account_id, platform, credentials, created_at
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
            SELECT id, account_id, platform, credentials, created_at
            FROM credentials
            WHERE id = ${id}
        ` as DbCredential[];
        return result.length > 0 ? result[0] : null;
    }
```

- [ ] **Step 3: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/database.ts
git commit -m "feat: add credential CRUD methods to DatabaseService"
```

---

### Task 4: Add unit tests for credential DB methods

**Files:**
- Modify: `tests/unit/database.test.ts`

- [ ] **Step 1: Add credential method tests**

Add a new `describe` block at the end of the existing test file, before the final closing `});`:

```typescript
    describe('getCredentialsByAccountId', () => {
        test('should return credentials for account', async () => {
            const mockCreds = [
                { id: 1, account_id: 1, platform: 'instagram_direct', credentials: { ig_access_token: 'token', ig_user_id: 'user1' }, created_at: new Date() },
            ];
            mockSql.mockResolvedValueOnce(mockCreds);

            const result = await db.getCredentialsByAccountId(1);

            expect(result).toEqual(mockCreds);
        });

        test('should return empty array when no credentials', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getCredentialsByAccountId(999);

            expect(result).toEqual([]);
        });
    });

    describe('getCredentialsByPlatform', () => {
        test('should return credential for account and platform', async () => {
            const mockCred = { id: 1, account_id: 1, platform: 'instagram_direct', credentials: { ig_access_token: 'token', ig_user_id: 'user1' }, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCred]);

            const result = await db.getCredentialsByPlatform(1, 'instagram_direct');

            expect(result).toEqual(mockCred);
        });

        test('should return null when no credential found', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getCredentialsByPlatform(1, 'instagram_direct');

            expect(result).toBeNull();
        });
    });

    describe('createCredential', () => {
        test('should create and return credential', async () => {
            const mockCred = { id: 1, account_id: 1, platform: 'instagram_direct', credentials: { ig_access_token: 'token', ig_user_id: 'user1' }, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCred]);

            const result = await db.createCredential(1, 'instagram_direct', { ig_access_token: 'token', ig_user_id: 'user1' });

            expect(result).toEqual(mockCred);
        });
    });

    describe('updateCredential', () => {
        test('should update and return credential', async () => {
            const mockCred = { id: 1, account_id: 1, platform: 'instagram_direct', credentials: { ig_access_token: 'new_token', ig_user_id: 'user1' }, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCred]);

            const result = await db.updateCredential(1, { ig_access_token: 'new_token', ig_user_id: 'user1' });

            expect(result).toEqual(mockCred);
        });

        test('should return null when credential not found', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.updateCredential(999, { ig_access_token: 'token', ig_user_id: 'user1' });

            expect(result).toBeNull();
        });
    });

    describe('deleteCredential', () => {
        test('should return true when credential deleted', async () => {
            mockSql.mockResolvedValueOnce([{ id: 1 }]);

            const result = await db.deleteCredential(1);

            expect(result).toBe(true);
        });

        test('should return false when credential not found', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.deleteCredential(999);

            expect(result).toBe(false);
        });
    });

    describe('getCredential', () => {
        test('should return credential by id', async () => {
            const mockCred = { id: 1, account_id: 1, platform: 'instagram_direct', credentials: { ig_access_token: 'token', ig_user_id: 'user1' }, created_at: new Date() };
            mockSql.mockResolvedValueOnce([mockCred]);

            const result = await db.getCredential(1);

            expect(result).toEqual(mockCred);
        });

        test('should return null when credential not found', async () => {
            mockSql.mockResolvedValueOnce([]);

            const result = await db.getCredential(999);

            expect(result).toBeNull();
        });
    });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/unit/database.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/unit/database.test.ts
git commit -m "test: add unit tests for credential DB methods"
```

---

## Chunk 2: Extract maskToken, Credentials Route, and Wire Up Routes

### Task 5: Extract maskToken to shared utility

**Files:**
- Create: `src/utils/mask.ts`
- Modify: `src/routes/accounts.ts:26-29` (remove maskToken, import from utility)

- [ ] **Step 1: Create mask utility**

Create `src/utils/mask.ts`:

```typescript
export function maskToken(token: string): string {
    if (token.length <= 8) return '****';
    return token.slice(0, 4) + '...' + token.slice(-4);
}

export function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(credentials)) {
        masked[key] = typeof value === 'string' ? maskToken(value) : value;
    }
    return masked;
}
```

- [ ] **Step 2: Update accounts.ts to import from shared utility**

Replace the `maskToken` function definition in `src/routes/accounts.ts` (lines 26-29) with an import. Add to the top of the file:

```typescript
import { maskToken } from '../utils/mask.js';
```

Remove lines 26-29 (the local `maskToken` function).

- [ ] **Step 3: Verify types compile and existing tests pass**

Run: `bunx tsc --noEmit && bun test tests/unit/database.test.ts`
Expected: No errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/utils/mask.ts src/routes/accounts.ts
git commit -m "refactor: extract maskToken to shared utility, add maskCredentials"
```

---

### Task 6: Add unit tests for mask utilities

**Files:**
- Create: `tests/unit/mask.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, test, expect } from 'bun:test';
import { maskToken, maskCredentials } from '../../src/utils/mask';

describe('maskToken', () => {
    test('should mask long tokens showing first 4 and last 4 chars', () => {
        expect(maskToken('abcdefghijklmnop')).toBe('abcd...mnop');
    });

    test('should return **** for short tokens', () => {
        expect(maskToken('short')).toBe('****');
    });

    test('should return **** for 8-char tokens', () => {
        expect(maskToken('12345678')).toBe('****');
    });

    test('should mask 9-char token', () => {
        expect(maskToken('123456789')).toBe('1234...6789');
    });
});

describe('maskCredentials', () => {
    test('should mask all string values in credentials object', () => {
        const creds = { ig_access_token: 'abcdefghijklmnop', ig_user_id: '1234567890' };
        const masked = maskCredentials(creds);

        expect(masked.ig_access_token).toBe('abcd...mnop');
        expect(masked.ig_user_id).toBe('1234...7890');
    });

    test('should leave non-string values unchanged', () => {
        const creds = { token: 'abcdefghijklmnop', count: 42 };
        const masked = maskCredentials(creds);

        expect(masked.token).toBe('abcd...mnop');
        expect(masked.count).toBe(42);
    });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/unit/mask.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/unit/mask.test.ts
git commit -m "test: add unit tests for mask utilities"
```

---

### Task 7: Create credentials route handler

**Files:**
- Create: `src/routes/credentials.ts`

- [ ] **Step 1: Create the credentials route handler with Zod validation**

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { maskCredentials } from '../utils/mask.js';
import { z } from 'zod';
import type { Platform, InstagramDirectCredentials } from '../types/index.js';

const platformValues: [Platform, ...Platform[]] = ['instagram_direct', 'upload_post'];

const instagramDirectCredentialsSchema = z.object({
    ig_access_token: z.string().min(1, 'Instagram access token is required'),
    ig_user_id: z.string().min(1, 'Instagram user ID is required'),
});

const createCredentialSchema = z.object({
    platform: z.enum(platformValues),
    credentials: z.record(z.unknown()),
}).refine(
    (data) => {
        if (data.platform === 'instagram_direct') {
            return instagramDirectCredentialsSchema.safeParse(data.credentials).success;
        }
        return true;
    },
    { message: 'Invalid credentials for the specified platform' }
);

const updateCredentialSchema = z.object({
    credentials: z.record(z.unknown()),
});

export async function handleAccountCredentials(request: Request, accountId: number): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: 'Account not found' },
                { status: 404 }
            );
        }

        if (request.method === 'GET') {
            const credentials = await db.getCredentialsByAccountId(accountId);
            return Response.json({
                success: true,
                credentials: credentials.map(c => ({
                    ...c,
                    credentials: maskCredentials(c.credentials as Record<string, unknown>),
                })),
            });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createCredentialSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }

            const credential = await db.createCredential(
                accountId,
                parsed.data.platform,
                parsed.data.credentials as InstagramDirectCredentials
            );
            return Response.json({
                success: true,
                credential: {
                    ...credential,
                    credentials: maskCredentials(credential.credentials as Record<string, unknown>),
                },
            }, { status: 201 });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling account credentials request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process credentials request' },
            { status: 500 }
        );
    }
}

export async function handleCredentialById(request: Request, credentialId: number): Promise<Response> {
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
            const parsed = updateCredentialSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
                    { status: 400 }
                );
            }

            const existing = await db.getCredential(credentialId);
            if (!existing) {
                return Response.json(
                    { success: false, error: 'Credential not found' },
                    { status: 404 }
                );
            }

            // Validate credentials shape based on platform
            if (existing.platform === 'instagram_direct') {
                const platformValidation = instagramDirectCredentialsSchema.safeParse(parsed.data.credentials);
                if (!platformValidation.success) {
                    return Response.json(
                        { success: false, error: platformValidation.error.errors[0].message },
                        { status: 400 }
                    );
                }
            }

            const credential = await db.updateCredential(credentialId, parsed.data.credentials as any);
            if (!credential) {
                return Response.json(
                    { success: false, error: 'Credential not found' },
                    { status: 404 }
                );
            }
            return Response.json({
                success: true,
                credential: {
                    ...credential,
                    credentials: maskCredentials(credential.credentials as Record<string, unknown>),
                },
            });
        }

        if (request.method === 'DELETE') {
            const deleted = await db.deleteCredential(credentialId);
            if (!deleted) {
                return Response.json(
                    { success: false, error: 'Credential not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling credential by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process credential request' },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/credentials.ts
git commit -m "feat: add credentials route handler with Zod validation"
```

---

### Task 8: Wire up credential routes in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import**

Add after the existing accounts import (line 16):

```typescript
import { handleAccountCredentials, handleCredentialById } from './routes/credentials.js';
```

- [ ] **Step 2: Add route matchers**

Add after the `accountContentItemMatch` block (~line 303) and before the 404 fallback:

```typescript
      // Account credentials
      const accountCredentialsMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/credentials$/);
      if (accountCredentialsMatch && (request.method === 'GET' || request.method === 'POST')) {
        return withCors(await handleAccountCredentials(request, parseInt(accountCredentialsMatch[1], 10)), request);
      }

      // Credential by ID
      const credentialByIdMatch = url.pathname.match(/^\/api\/credentials\/(\d+)$/);
      if (credentialByIdMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
        return withCors(await handleCredentialById(request, parseInt(credentialByIdMatch[1], 10)), request);
      }
```

- [ ] **Step 3: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up credential routes in server"
```

---

## Chunk 3: Update Posting Flow and Account Endpoints

### Task 9: Update post-reel to read from credentials table

**Files:**
- Modify: `src/routes/post-reel.ts`

- [ ] **Step 1: Update the processPostInBackground function signature and credential loading**

In `src/routes/post-reel.ts`, update the `processPostInBackground` function. Replace line 30:

```typescript
    const instagramClient = new InstagramClientService(account.ig_access_token, account.ig_user_id);
```

With:

```typescript
    const credential = await db.getCredentialsByPlatform(account.id, 'instagram_direct');
    if (!credential) {
        throw new Error(`No instagram_direct credentials found for account ${account.id}`);
    }
    const instagramClient = new InstagramClientService(credential.credentials.ig_access_token, credential.credentials.ig_user_id);
```

Note: The `db` instance is already passed as a parameter to `processPostInBackground` and `DatabaseService` is stateless (HTTP-based Neon connections), so we reuse it.

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/post-reel.ts
git commit -m "feat: update post-reel to read credentials from credentials table"
```

---

### Task 10: Update test-instagram to read from credentials table

**Files:**
- Modify: `src/routes/test-instagram.ts`

- [ ] **Step 1: Update credential loading in the account loop**

Replace lines 33-34:

```typescript
                const instagramClient = new InstagramClientService(account.ig_access_token, account.ig_user_id);
                const accountInfo = await instagramClient.getAccountInfo();
```

With:

```typescript
                const credential = await db.getCredentialsByPlatform(account.id, 'instagram_direct');
                if (!credential) {
                    throw new Error(`No instagram_direct credentials found for account ${account.id}`);
                }
                const instagramClient = new InstagramClientService(credential.credentials.ig_access_token, credential.credentials.ig_user_id);
                const accountInfo = await instagramClient.getAccountInfo();
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/test-instagram.ts
git commit -m "feat: update test-instagram to read credentials from credentials table"
```

---

### Task 11: Update views-sync-cron to read from credentials table

**Files:**
- Modify: `src/services/views-sync-cron.ts`

- [ ] **Step 1: Replace account-based credential loading with credentials table lookup**

The current code (lines 76-77) loads all accounts and builds a map. Then in the loop (line 97) it creates `InstagramClientService` from `account.ig_access_token`.

Replace lines 76-77:

```typescript
            const accounts = await this.db.getAccounts();
            const accountMap = new Map(accounts.map(a => [a.id, a]));
```

With:

```typescript
            const accounts = await this.db.getAccounts();
            const accountMap = new Map(accounts.map(a => [a.id, a]));

            // Pre-load credentials for all accounts
            const credentialMap = new Map<number, { ig_access_token: string; ig_user_id: string }>();
            for (const account of accounts) {
                const credential = await this.db.getCredentialsByPlatform(account.id, 'instagram_direct');
                if (credential) {
                    credentialMap.set(account.id, credential.credentials);
                }
            }
```

Replace line 97:

```typescript
                    const instagram = new InstagramClientService(account.ig_access_token, account.ig_user_id);
```

With:

```typescript
                    const creds = credentialMap.get(post.account_id);
                    if (!creds) {
                        logger.warn('No instagram_direct credentials found for account, skipping', { accountId: post.account_id });
                        failed++;
                        continue;
                    }
                    const instagram = new InstagramClientService(creds.ig_access_token, creds.ig_user_id);
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/views-sync-cron.ts
git commit -m "feat: update views-sync-cron to read credentials from credentials table"
```

---

### Task 12: Update account endpoints

**Files:**
- Modify: `src/routes/accounts.ts`

- [ ] **Step 1: Update createAccountSchema to remove credential fields**

Replace the `createAccountSchema` (lines 6-11):

```typescript
const createAccountSchema = z.object({
    name: z.string().min(1, 'Name cannot be empty').max(200, 'Name too long'),
    gcs_bucket_name: z.string().min(1, 'GCS bucket name is required'),
});
```

- [ ] **Step 2: Update updateAccountSchema to remove credential fields**

Replace the `updateAccountSchema` (lines 13-18):

```typescript
const updateAccountSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    gcs_bucket_name: z.string().min(1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' });
```

- [ ] **Step 3: Update the POST handler to pass empty strings for credential columns**

In the `handleAccounts` function, update the `POST` handler (lines 64-68). Replace:

```typescript
                const account = await db.createAccount(
                    parsed.data.name,
                    parsed.data.ig_access_token,
                    parsed.data.ig_user_id,
                    parsed.data.gcs_bucket_name
                );
```

With:

```typescript
                const account = await db.createAccount(
                    parsed.data.name,
                    '',
                    '',
                    parsed.data.gcs_bucket_name
                );
```

Also update the POST response (lines 70-73) to include an empty credentials array for consistency with the GET response:

Replace:
```typescript
                return Response.json({
                    success: true,
                    account: { ...account, ig_access_token: maskToken(account.ig_access_token) },
                }, { status: 201 });
```

With:
```typescript
                return Response.json({
                    success: true,
                    account: { ...account, ig_access_token: maskToken(account.ig_access_token), credentials: [] },
                }, { status: 201 });
```

- [ ] **Step 4: Update the GET handler to include credentials**

Import `maskCredentials` at the top of the file:

```typescript
import { maskToken, maskCredentials } from '../utils/mask.js';
```

Replace the GET handler block (lines 43-52):

```typescript
        if (request.method === 'GET') {
            const accounts = await db.getAccounts();
            const accountsWithCreds = await Promise.all(
                accounts.map(async (a) => {
                    const credentials = await db.getCredentialsByAccountId(a.id);
                    return {
                        ...a,
                        ig_access_token: maskToken(a.ig_access_token),
                        credentials: credentials.map(c => ({
                            ...c,
                            credentials: maskCredentials(c.credentials as Record<string, unknown>),
                        })),
                    };
                })
            );
            return Response.json({
                success: true,
                accounts: accountsWithCreds,
            });
        }
```

- [ ] **Step 5: Update PATCH handler to remove ig_access_token masking from response**

The `handleAccountById` PATCH response (line 125-128) currently masks `ig_access_token`. Update to also include credentials:

```typescript
            const credentials = await db.getCredentialsByAccountId(id);
            return Response.json({
                success: true,
                account: {
                    ...account,
                    ig_access_token: maskToken(account.ig_access_token),
                    credentials: credentials.map(c => ({
                        ...c,
                        credentials: maskCredentials(c.credentials as Record<string, unknown>),
                    })),
                },
            });
```

- [ ] **Step 6: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/routes/accounts.ts
git commit -m "feat: update account endpoints to use credentials table"
```

---

### Task 13: Add integration tests for credential endpoints

**Files:**
- Create: `tests/integration/credentials.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
import { describe, test, expect } from 'bun:test';

const BASE_URL = 'http://localhost:3000';

describe('Credentials Endpoints', () => {
    describe('GET /api/accounts/:id/credentials', () => {
        test('should return 401 without authentication', async () => {
            const response = await fetch(`${BASE_URL}/api/accounts/1/credentials`);
            expect(response.status).toBe(401);
        });

        test('should reject unauthenticated request', async () => {
            const response = await fetch(`${BASE_URL}/api/accounts/1/credentials`);
            const data = await response.json() as { success: boolean };
            expect(data.success).toBe(false);
        });
    });

    describe('POST /api/accounts/:id/credentials', () => {
        test('should return 401 without authentication', async () => {
            const response = await fetch(`${BASE_URL}/api/accounts/1/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: 'instagram_direct', credentials: { ig_access_token: 'test', ig_user_id: 'test' } }),
            });
            expect(response.status).toBe(401);
        });
    });

    describe('PATCH /api/credentials/:id', () => {
        test('should return 401 without authentication', async () => {
            const response = await fetch(`${BASE_URL}/api/credentials/1`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentials: { ig_access_token: 'test', ig_user_id: 'test' } }),
            });
            expect(response.status).toBe(401);
        });
    });

    describe('DELETE /api/credentials/:id', () => {
        test('should return 401 without authentication', async () => {
            const response = await fetch(`${BASE_URL}/api/credentials/1`, {
                method: 'DELETE',
            });
            expect(response.status).toBe(401);
        });
    });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/integration/credentials.test.ts`
Expected: All tests pass (these only test auth rejection, so they work without a running server with auth)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/credentials.test.ts
git commit -m "test: add integration tests for credential endpoints"
```

---

### Task 14: Run full test suite

- [ ] **Step 1: Run all unit tests**

Run: `bun test tests/unit/`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit any fixes if needed**
