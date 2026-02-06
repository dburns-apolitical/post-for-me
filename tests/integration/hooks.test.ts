import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the neon module
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleHooks } from '../../src/routes/hooks';

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
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const response = await handleHooks(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.hooks).toBeDefined();
        expect(Array.isArray(body.hooks)).toBe(true);
    });
});
