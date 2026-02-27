import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the neon module
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleHooks, handleHookById } from '../../src/routes/hooks';

const authHeaders = {
    'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
};

describe('GET /api/hooks', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/hooks', {
            method: 'GET',
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return hooks with valid password auth', async () => {
        const mockHooks = [
            { id: 1, text: 'Wait for it!', created_at: new Date() },
        ];
        mockSql.mockResolvedValueOnce(mockHooks);

        const request = new Request('http://localhost/api/hooks', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.hooks).toBeDefined();
        expect(Array.isArray(body.hooks)).toBe(true);
    });

    test('should pass enabledOnly=false when all=true', async () => {
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/hooks?all=true', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });
});

describe('POST /api/hooks', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/hooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'New hook' }),
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(401);
    });

    test('should create a hook and return 201', async () => {
        const mockHook = { id: 1, text: 'New hook', enabled: true, created_at: new Date().toISOString() };
        mockSql.mockResolvedValueOnce([mockHook]);

        const request = new Request('http://localhost/api/hooks', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'New hook' }),
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.hook.text).toBe('New hook');
    });

    test('should return 409 when hook already exists', async () => {
        const error = new Error('unique constraint violation');
        (error as any).code = '23505';
        mockSql.mockRejectedValueOnce(error);

        const request = new Request('http://localhost/api/hooks', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Duplicate hook' }),
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('A hook with this text already exists');
    });

    test('should return 400 when text is empty', async () => {
        const request = new Request('http://localhost/api/hooks', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: '' }),
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return 400 when text exceeds 500 chars', async () => {
        const request = new Request('http://localhost/api/hooks', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'a'.repeat(501) }),
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });
});

describe('PATCH /api/hooks/:id', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/hooks/1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
        });

        const response = await handleHookById(request, 1);

        expect(response.status).toBe(401);
    });

    test('should update hook enabled status', async () => {
        const mockHook = { id: 1, text: 'Test hook', enabled: false, created_at: new Date().toISOString() };
        mockSql.mockResolvedValueOnce([mockHook]);

        const request = new Request('http://localhost/api/hooks/1', {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
        });

        const response = await handleHookById(request, 1);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.hook.enabled).toBe(false);
    });

    test('should return 404 when hook not found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/hooks/999', {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
        });

        const response = await handleHookById(request, 999);

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('Hook not found');
    });

    test('should return 400 with invalid body', async () => {
        const request = new Request('http://localhost/api/hooks/1', {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: 'not-a-boolean' }),
        });

        const response = await handleHookById(request, 1);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return 405 for unsupported methods', async () => {
        const request = new Request('http://localhost/api/hooks/1', {
            method: 'DELETE',
            headers: authHeaders,
        });

        const response = await handleHookById(request, 1);

        expect(response.status).toBe(405);
    });
});

describe('Unsupported methods on /api/hooks', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 405 for PUT', async () => {
        const request = new Request('http://localhost/api/hooks', {
            method: 'PUT',
            headers: authHeaders,
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(405);
        const body = await response.json();
        expect(body.error).toBe('Method not allowed');
    });
});
