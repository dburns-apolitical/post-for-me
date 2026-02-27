# Hooks & Captions Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CRUD management for hooks & captions with enabled/disabled state, filtering random selection to enabled-only.

**Architecture:** Add `enabled` boolean column to `hooks` and `captions` tables. Extend existing route handlers to support POST/PATCH methods and `?all=true` query param. Update random selection queries to filter by `enabled = TRUE`.

**Tech Stack:** Bun.js, TypeScript, PostgreSQL (Neon serverless), Zod validation

---

### Task 1: Add `enabled` column to database schema

**Files:**
- Modify: `src/services/database.ts:28-53` (initializeSchema — hooks & captions CREATE TABLE)
- Modify: `src/services/database.ts:124-148` (add migration block for existing tables)

**Step 1: Add `enabled` to CREATE TABLE statements**

In `initializeSchema()`, update the `captions` table creation (line 31-37):

```typescript
await this.sql`
    CREATE TABLE IF NOT EXISTS captions (
        id SERIAL PRIMARY KEY,
        text TEXT UNIQUE NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
    )
`;
```

Update the `hooks` table creation (line 47-53):

```typescript
await this.sql`
    CREATE TABLE IF NOT EXISTS hooks (
        id SERIAL PRIMARY KEY,
        text TEXT UNIQUE NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
    )
`;
```

**Step 2: Add migration for existing tables**

After the existing `account_id` migration block (around line 148), add:

```typescript
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
```

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/index.ts:80-96`

**Step 1: Add `enabled` to `DbCaption` and `DbHook`**

Update `DbCaption` (line 80-84):

```typescript
export interface DbCaption {
    id: number;
    text: string;
    enabled: boolean;
    created_at: Date;
}
```

Update `DbHook` (line 92-96):

```typescript
export interface DbHook {
    id: number;
    text: string;
    enabled: boolean;
    created_at: Date;
}
```

---

### Task 3: Add new database methods and update existing ones

**Files:**
- Modify: `src/services/database.ts`

**Step 1: Update `getAllCaptions` to accept `enabledOnly` param (line 516-523)**

```typescript
async getAllCaptions(enabledOnly: boolean = false): Promise<DbCaption[]> {
    if (enabledOnly) {
        const result = await this.sql`
            SELECT id, text, enabled, created_at
            FROM captions
            WHERE enabled = TRUE
            ORDER BY created_at DESC
        ` as DbCaption[];
        return result;
    }
    const result = await this.sql`
        SELECT id, text, enabled, created_at
        FROM captions
        ORDER BY created_at DESC
    ` as DbCaption[];
    return result;
}
```

**Step 2: Update `getAllHooks` to accept `enabledOnly` param (line 528-535)**

```typescript
async getAllHooks(enabledOnly: boolean = false): Promise<DbHook[]> {
    if (enabledOnly) {
        const result = await this.sql`
            SELECT id, text, enabled, created_at
            FROM hooks
            WHERE enabled = TRUE
            ORDER BY created_at DESC
        ` as DbHook[];
        return result;
    }
    const result = await this.sql`
        SELECT id, text, enabled, created_at
        FROM hooks
        ORDER BY created_at DESC
    ` as DbHook[];
    return result;
}
```

**Step 3: Update `getRandomCaption` to filter by enabled (line 344-352)**

```typescript
async getRandomCaption(): Promise<DbCaption | null> {
    const result = await this.sql`
        SELECT id, text, enabled, created_at
        FROM captions
        WHERE enabled = TRUE
        ORDER BY RANDOM()
        LIMIT 1
    ` as DbCaption[];
    return result.length > 0 ? result[0] : null;
}
```

**Step 4: Update `getRandomHook` to filter by enabled (line 357-365)**

```typescript
async getRandomHook(): Promise<DbHook | null> {
    const result = await this.sql`
        SELECT id, text, enabled, created_at
        FROM hooks
        WHERE enabled = TRUE
        ORDER BY RANDOM()
        LIMIT 1
    ` as DbHook[];
    return result.length > 0 ? result[0] : null;
}
```

**Step 5: Update `upsertCaption` to include `enabled` in RETURNING (line 181-189)**

```typescript
async upsertCaption(text: string): Promise<DbCaption> {
    const result = await this.sql`
        INSERT INTO captions (text)
        VALUES (${text})
        ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text
        RETURNING id, text, enabled, created_at
    ` as DbCaption[];
    return result[0];
}
```

**Step 6: Update `upsertHook` to include `enabled` in RETURNING (line 207-215)**

```typescript
async upsertHook(text: string): Promise<DbHook> {
    const result = await this.sql`
        INSERT INTO hooks (text)
        VALUES (${text})
        ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text
        RETURNING id, text, enabled, created_at
    ` as DbHook[];
    return result[0];
}
```

**Step 7: Add `createHook` method**

Add after `upsertHook`:

```typescript
async createHook(text: string): Promise<DbHook | null> {
    try {
        const result = await this.sql`
            INSERT INTO hooks (text)
            VALUES (${text})
            RETURNING id, text, enabled, created_at
        ` as DbHook[];
        return result[0];
    } catch (error: any) {
        if (error.message?.includes('unique') || error.code === '23505') {
            return null; // duplicate
        }
        throw error;
    }
}
```

**Step 8: Add `createCaption` method**

Add after `upsertCaption`:

```typescript
async createCaption(text: string): Promise<DbCaption | null> {
    try {
        const result = await this.sql`
            INSERT INTO captions (text)
            VALUES (${text})
            RETURNING id, text, enabled, created_at
        ` as DbCaption[];
        return result[0];
    } catch (error: any) {
        if (error.message?.includes('unique') || error.code === '23505') {
            return null; // duplicate
        }
        throw error;
    }
}
```

**Step 9: Add `updateHookEnabled` method**

```typescript
async updateHookEnabled(id: number, enabled: boolean): Promise<DbHook | null> {
    const result = await this.sql`
        UPDATE hooks
        SET enabled = ${enabled}
        WHERE id = ${id}
        RETURNING id, text, enabled, created_at
    ` as DbHook[];
    return result.length > 0 ? result[0] : null;
}
```

**Step 10: Add `updateCaptionEnabled` method**

```typescript
async updateCaptionEnabled(id: number, enabled: boolean): Promise<DbCaption | null> {
    const result = await this.sql`
        UPDATE captions
        SET enabled = ${enabled}
        WHERE id = ${id}
        RETURNING id, text, enabled, created_at
    ` as DbCaption[];
    return result.length > 0 ? result[0] : null;
}
```

---

### Task 4: Update hooks route handler to support GET with `?all`, POST, and PATCH

**Files:**
- Modify: `src/routes/hooks.ts` (full rewrite)

**Step 1: Rewrite `src/routes/hooks.ts`**

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { z } from 'zod';

const createHookSchema = z.object({
    text: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long'),
});

const updateHookSchema = z.object({
    enabled: z.boolean(),
});

export async function handleHooks(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized hooks request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin hooks request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();
    const url = new URL(request.url);

    try {
        if (request.method === 'GET') {
            const showAll = url.searchParams.get('all') === 'true';
            const hooks = await db.getAllHooks(!showAll);
            return Response.json({ success: true, hooks });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createHookSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const hook = await db.createHook(parsed.data.text);
            if (!hook) {
                return Response.json(
                    { success: false, error: 'A hook with this text already exists' },
                    { status: 409 }
                );
            }
            return Response.json({ success: true, hook }, { status: 201 });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling hooks request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process hooks request' },
            { status: 500 }
        );
    }
}

export async function handleHookById(request: Request, id: number): Promise<Response> {
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
            const parsed = updateHookSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const hook = await db.updateHookEnabled(id, parsed.data.enabled);
            if (!hook) {
                return Response.json(
                    { success: false, error: 'Hook not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true, hook });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling hook by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process hook request' },
            { status: 500 }
        );
    }
}
```

---

### Task 5: Update captions route handler to support GET with `?all`, POST, and PATCH

**Files:**
- Modify: `src/routes/captions.ts` (full rewrite)

**Step 1: Rewrite `src/routes/captions.ts`**

```typescript
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { z } from 'zod';

const createCaptionSchema = z.object({
    text: z.string().min(1, 'Caption text cannot be empty').max(2200, 'Caption text too long'),
});

const updateCaptionSchema = z.object({
    enabled: z.boolean(),
});

export async function handleCaptions(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized captions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin captions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();
    const url = new URL(request.url);

    try {
        if (request.method === 'GET') {
            const showAll = url.searchParams.get('all') === 'true';
            const captions = await db.getAllCaptions(!showAll);
            return Response.json({ success: true, captions });
        }

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
            return Response.json({ success: true, caption }, { status: 201 });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling captions request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process captions request' },
            { status: 500 }
        );
    }
}

export async function handleCaptionById(request: Request, id: number): Promise<Response> {
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
            const parsed = updateCaptionSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const caption = await db.updateCaptionEnabled(id, parsed.data.enabled);
            if (!caption) {
                return Response.json(
                    { success: false, error: 'Caption not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true, caption });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling caption by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process caption request' },
            { status: 500 }
        );
    }
}
```

---

### Task 6: Register new routes and update CORS in `src/index.ts`

**Files:**
- Modify: `src/index.ts:7-8` (imports)
- Modify: `src/index.ts:152` (CORS allowed methods)
- Modify: `src/index.ts:218-226` (route registration)

**Step 1: Update imports (line 7-8)**

Add the new `handleHookById` and `handleCaptionById` imports:

```typescript
import { handleCaptions, handleCaptionById } from './routes/captions.js';
import { handleHooks, handleHookById } from './routes/hooks.js';
```

**Step 2: Update CORS allowed methods (line 152)**

```typescript
'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
```

**Step 3: Add route matching for new endpoints**

The existing routes match `GET` only. We need to:

1. Change the captions/hooks routes to also accept `POST`:

Replace the captions route block (line 219-221):
```typescript
// Captions endpoint (requires authentication)
if (url.pathname === '/api/captions' && (request.method === 'GET' || request.method === 'POST')) {
    return withCors(await handleCaptions(request), request);
}
```

Replace the hooks route block (line 224-226):
```typescript
// Hooks endpoint (requires authentication)
if (url.pathname === '/api/hooks' && (request.method === 'GET' || request.method === 'POST')) {
    return withCors(await handleHooks(request), request);
}
```

2. Add new PATCH routes for `/api/hooks/:id` and `/api/captions/:id`. Add these right after the hooks GET/POST block:

```typescript
// Hook by ID endpoint (PATCH for enable/disable)
const hookMatch = url.pathname.match(/^\/api\/hooks\/(\d+)$/);
if (hookMatch && request.method === 'PATCH') {
    return withCors(await handleHookById(request, parseInt(hookMatch[1], 10)), request);
}

// Caption by ID endpoint (PATCH for enable/disable)
const captionMatch = url.pathname.match(/^\/api\/captions\/(\d+)$/);
if (captionMatch && request.method === 'PATCH') {
    return withCors(await handleCaptionById(request, parseInt(captionMatch[1], 10)), request);
}
```

---

### Task 7: Verify the implementation

**Step 1: Run the TypeScript compiler to check for type errors**

Run: `bunx tsc --noEmit`
Expected: No errors

**Step 2: Start the server and verify it boots without errors**

Run: `bun run src/index.ts`
Expected: Server starts, "Database schema initialized" logged (which means migrations ran)

**Step 3: Test the endpoints manually with curl**

Test GET hooks (enabled only, default):
```bash
curl -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" http://localhost:3000/api/hooks
```

Test GET hooks (all, for management):
```bash
curl -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" "http://localhost:3000/api/hooks?all=true"
```

Test POST new hook:
```bash
curl -X POST -H "Content-Type: application/json" -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" \
  -d '{"text":"Test hook text"}' http://localhost:3000/api/hooks
```

Test PATCH hook (disable):
```bash
curl -X PATCH -H "Content-Type: application/json" -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" \
  -d '{"enabled":false}' http://localhost:3000/api/hooks/1
```

Same tests for captions with `/api/captions` and `/api/captions/:id`.
