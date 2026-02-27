# Multi-Account Configuration Design

**Date:** 2026-02-27
**Status:** Approved

## Overview

Move account configuration from hardcoded env vars to fully DB-managed, FE-configurable accounts. Support creating new accounts, per-account content assignment, and per-account GCS buckets.

## Database Schema

### Modified `accounts` table

```sql
ALTER TABLE accounts
  ADD COLUMN ig_access_token TEXT NOT NULL DEFAULT '',
  ADD COLUMN ig_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN gcs_bucket_name TEXT NOT NULL DEFAULT '';
```

Migration populates existing accounts from current env vars.

### New junction tables

```sql
CREATE TABLE account_captions (
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  caption_id INTEGER REFERENCES captions(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, caption_id)
);

CREATE TABLE account_hooks (
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  hook_id INTEGER REFERENCES hooks(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, hook_id)
);

CREATE TABLE account_hashtag_combinations (
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  hashtag_combination_id INTEGER REFERENCES hashtag_combinations(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, hashtag_combination_id)
);
```

Migration assigns all existing content to both accounts 1 and 2.

Videos don't need junction tables — they live in the account's GCS bucket and are linked to accounts via the `posts` table.

## API Endpoints

### New: Account CRUD

- `GET /api/accounts` — List all accounts (tokens masked in response)
- `POST /api/accounts` — Create account `{ name, ig_access_token, ig_user_id, gcs_bucket_name }`
- `PATCH /api/accounts/:id` — Update account fields
- `DELETE /api/accounts/:id` — Delete account (blocked if posts exist)

### New: Content-Account Assignment

- `POST /api/accounts/:id/captions` — `{ captionIds: number[] }`
- `DELETE /api/accounts/:id/captions/:captionId`
- Same pattern for `/hooks` and `/hashtag-combinations`

### Modified Endpoints

**Content listing** — optional `?accountId=N` filter:
- `GET /api/captions?accountId=1` — captions assigned to account 1
- `GET /api/hooks?accountId=1` — hooks assigned to account 1

**Content creation** — optional account assignment:
- `POST /api/captions` — `{ text, accountIds?: number[] }`
- `POST /api/hooks` — `{ text, accountIds?: number[] }`

**Post reel** — `accountId` becomes required:
- `POST /api/post-reel` — `accountId` required (no default)
- Video selection uses account's `gcs_bucket_name`
- Random content selection filters by account assignment

**Videos** — account-scoped:
- `GET /api/videos?accountId=1` — lists from account 1's bucket

**Stats** — aggregate + per-account:
- `GET /api/stats` — aggregate across all accounts
- `GET /api/stats?accountId=1` — per-account

**Test Instagram** — account-scoped:
- `GET /api/test-instagram?accountId=1` — test specific account

## Service Changes

### Config
- Remove `instagram.accounts` config (no more per-account env vars)
- Keep `GCS_PROJECT_ID`, `DATABASE_URL`, `DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY`, auth URLs

### Database Service
- Account CRUD methods
- Junction table management methods
- Content queries gain optional `accountId` JOIN filtering
- `getRandomCaption(accountId)`, `getRandomHook(accountId)`, `getRandomHashtagCombination(accountId)` — JOIN junction tables

### Instagram Client
- Load credentials from DB via `getAccount(id)` instead of config
- Accept credentials per-call or resolve from account ID

### Video Selector
- `listVideos(bucketName)` — parameterized bucket name
- `selectPrioritizedVideo(accountId, bucketName)` — account-scoped

### Post Reel Route
- Fetch account from DB for credentials + bucket
- Pass to video selector and Instagram client
- Content selection filtered by account

### Crons
- Views sync: iterate all accounts, use per-account credentials
- Agent eval: iterate all accounts, per-account context

## Migration Strategy

1. Schema migration (add columns, create junction tables)
2. Data migration (populate accounts from env vars, populate junction tables for both accounts)
3. Code changes (all services and routes)
4. Env cleanup (remove per-account env vars after deployment)

## Edge Cases

- **No content assigned to account**: Clear error message
- **Delete account with posts**: Blocked — admin must handle posts first
- **New accounts**: Start empty (no content assigned by default)
- **Token expiry**: Not in scope (managed externally via Instagram)
- **Invalid GCS bucket**: Existing error handling in video selector
