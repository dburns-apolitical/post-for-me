# Credentials Table Design

## Overview

Decouple platform credentials from the `accounts` table into a dedicated `credentials` table, enabling multi-platform posting support. Migrate existing Instagram credentials and update the posting flow to read from the new table.

## Database Changes

### New PostgreSQL ENUM

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform') THEN
        CREATE TYPE platform AS ENUM ('instagram_direct', 'upload_post');
    END IF;
END $$;
```

- `instagram_direct`: Current Instagram Graph API posting flow
- `upload_post`: Alternative posting method (not implemented yet)

### New `credentials` Table

```sql
CREATE TABLE credentials (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform platform NOT NULL,
  credentials JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

- `JSONB` for efficient querying and indexing
- `ON DELETE CASCADE` — credentials are removed when their account is deleted
- No unique constraint on `(account_id, platform)` — an account may have multiple credentials of the same platform type
- Index on `account_id` for query performance, consistent with other FK indexes in the project

### Accounts Table

- `ig_access_token` and `ig_user_id` columns **stay** for now (removed as a separate task later)
- `gcs_bucket_name` stays permanently — it is account-level, not credential-level

## Data Migration

Runs on startup in `initializeSchema()`, after creating the credentials table:

```sql
INSERT INTO credentials (account_id, platform, credentials)
SELECT id, 'instagram_direct', jsonb_build_object(
  'ig_access_token', ig_access_token,
  'ig_user_id', ig_user_id
)
FROM accounts
WHERE ig_access_token IS NOT NULL
  AND ig_user_id IS NOT NULL
  AND id NOT IN (
    SELECT account_id FROM credentials WHERE platform = 'instagram_direct'
  );
```

- Idempotent — skips accounts that already have an `instagram_direct` credentials row
- Only migrates accounts with both fields populated
- Safe to run every startup

## TypeScript Types

New types in `src/types/index.ts`:

```typescript
type Platform = 'instagram_direct' | 'upload_post';

interface InstagramDirectCredentials {
  ig_access_token: string;
  ig_user_id: string;
}

interface DbCredential {
  id: number;
  account_id: number;
  platform: Platform;
  credentials: InstagramDirectCredentials;
  created_at: Date;
}
```

When new platforms are added, `DbCredential.credentials` becomes a union:
```typescript
credentials: InstagramDirectCredentials | NewPlatformCredentials;
```

## Database Service Methods

New methods on `DatabaseService`:

- **`getCredentialsByAccountId(accountId: number): Promise<DbCredential[]>`** — all credentials for an account
- **`getCredentialsByPlatform(accountId: number, platform: Platform): Promise<DbCredential | null>`** — most recent credentials for an account+platform pair (`ORDER BY created_at DESC LIMIT 1`)
- **`createCredential(accountId: number, platform: Platform, credentials: DbCredential['credentials']): Promise<DbCredential>`** — insert new credentials
- **`updateCredential(id: number, credentials: DbCredential['credentials']): Promise<DbCredential>`** — replace the JSON blob
- **`deleteCredential(id: number): Promise<void>`** — remove a credentials row

## Posting Flow Changes

Update all places that read Instagram credentials to use the credentials table instead of the accounts table:

1. **`src/routes/post-reel.ts`** — fetch credentials via `getCredentialsByPlatform(accountId, 'instagram_direct')`, pass to `InstagramClientService`
2. **`src/routes/test-instagram.ts`** — same pattern for credential verification
3. **`src/services/views-sync-cron.ts`** — same pattern for views syncing (also covers `src/routes/sync-views.ts` manual trigger which delegates to this service)

If no `instagram_direct` credentials row exists for the account, fail with a clear error.

## API Endpoints

### New Credentials Endpoints

- **`GET /api/accounts/:id/credentials`** — list all credentials for an account (values masked)
- **`POST /api/accounts/:id/credentials`** — add credentials (body: `{ platform, credentials }`)
- **`PATCH /api/credentials/:id`** — update credentials (body: `{ credentials }`)
- **`DELETE /api/credentials/:id`** — remove credentials

### Changes to Existing Account Endpoints

- **`POST /api/accounts`** — stop accepting `ig_access_token` / `ig_user_id` in the request body. New accounts are created first, then credentials are added via `POST /api/accounts/:id/credentials`.
- **`PATCH /api/accounts/:id`** — stop accepting credential fields
- **`GET /api/accounts`** — include each account's credentials in the response (joined), with all credential values masked. Each account includes a `credentials` array of `{ id, platform, credentials (masked), created_at }`.

### Masking

All credential values are masked in GET responses. Apply the existing `maskToken()` utility to each string value in the credentials JSON object individually (e.g., `{ ig_access_token: "igxx...xxAb", ig_user_id: "12...89" }`).

### Validation

New credential endpoints use Zod schemas for request validation, consistent with existing endpoints. Validate `platform` against the Platform type values and `credentials` shape based on platform type.
