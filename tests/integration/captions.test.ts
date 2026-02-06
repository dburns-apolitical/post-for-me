import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the neon module
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleCaptions } from '../../src/routes/captions';

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
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const response = await handleCaptions(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.captions).toBeDefined();
        expect(Array.isArray(body.captions)).toBe(true);
    });
});
