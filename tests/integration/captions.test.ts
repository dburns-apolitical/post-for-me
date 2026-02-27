import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the neon module
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleCaptions, handleCaptionById } from '../../src/routes/captions';

const authHeaders = {
    'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
};

describe('GET /api/captions', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/captions', {
            method: 'GET',
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return captions with valid password auth', async () => {
        const mockCaptions = [
            { id: 1, text: 'Test caption', created_at: new Date() },
        ];
        mockSql.mockResolvedValueOnce(mockCaptions);

        const request = new Request('http://localhost/api/captions', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.captions).toBeDefined();
        expect(Array.isArray(body.captions)).toBe(true);
    });

    test('should pass enabledOnly=true when all param is not set', async () => {
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/captions', {
            method: 'GET',
            headers: authHeaders,
        });

        await handleCaptions(request);

        expect(mockSql).toHaveBeenCalled();
    });

    test('should pass enabledOnly=false when all=true', async () => {
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/captions?all=true', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });
});

describe('POST /api/captions', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/captions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'New caption' }),
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(401);
    });

    test('should create a caption and return 201', async () => {
        const mockCaption = { id: 1, text: 'New caption', enabled: true, created_at: new Date().toISOString() };
        mockSql.mockResolvedValueOnce([mockCaption]);

        const request = new Request('http://localhost/api/captions', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'New caption' }),
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.caption.text).toBe('New caption');
    });

    test('should return 409 when caption already exists', async () => {
        const error = new Error('unique constraint violation');
        (error as any).code = '23505';
        mockSql.mockRejectedValueOnce(error);

        const request = new Request('http://localhost/api/captions', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Duplicate caption' }),
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('A caption with this text already exists');
    });

    test('should return 400 when text is empty', async () => {
        const request = new Request('http://localhost/api/captions', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: '' }),
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return 400 when text exceeds 2200 chars', async () => {
        const request = new Request('http://localhost/api/captions', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'a'.repeat(2201) }),
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });
});

describe('PATCH /api/captions/:id', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/captions/1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
        });

        const response = await handleCaptionById(request, 1);

        expect(response.status).toBe(401);
    });

    test('should update caption enabled status', async () => {
        const mockCaption = { id: 1, text: 'Test caption', enabled: false, created_at: new Date().toISOString() };
        mockSql.mockResolvedValueOnce([mockCaption]);

        const request = new Request('http://localhost/api/captions/1', {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
        });

        const response = await handleCaptionById(request, 1);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.caption.enabled).toBe(false);
    });

    test('should return 404 when caption not found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/captions/999', {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
        });

        const response = await handleCaptionById(request, 999);

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('Caption not found');
    });

    test('should return 400 with invalid body', async () => {
        const request = new Request('http://localhost/api/captions/1', {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: 'not-a-boolean' }),
        });

        const response = await handleCaptionById(request, 1);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return 405 for unsupported methods', async () => {
        const request = new Request('http://localhost/api/captions/1', {
            method: 'DELETE',
            headers: authHeaders,
        });

        const response = await handleCaptionById(request, 1);

        expect(response.status).toBe(405);
    });
});

describe('Unsupported methods on /api/captions', () => {
    beforeEach(() => {
        mockSql.mockClear();
    });

    test('should return 405 for PUT', async () => {
        const request = new Request('http://localhost/api/captions', {
            method: 'PUT',
            headers: authHeaders,
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(405);
        const body = await response.json();
        expect(body.error).toBe('Method not allowed');
    });
});
