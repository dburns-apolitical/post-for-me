import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock fetch for GCS API
const mockFetch = mock(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
}) as unknown as typeof fetch);

// Store original fetch
const originalFetch = global.fetch;

// Mock the neon module (needed for validateAuth)
mock.module('@neondatabase/serverless', () => ({
    neon: () => mock(() => Promise.resolve([])),
}));

// Import after mocking
import { handleVideos } from '../../src/routes/videos';

describe('GET /api/videos', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch;
    });

    test('should return 401 without authentication', async () => {
        const request = new Request('http://localhost/api/videos', {
            method: 'GET',
        });

        const response = await handleVideos(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('should return videos with valid password auth', async () => {
        mockFetch.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                items: [
                    { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
                    { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
                ],
            }),
        }) as unknown as ReturnType<typeof fetch>);

        const request = new Request('http://localhost/api/videos', {
            method: 'GET',
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const response = await handleVideos(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.videos).toBeDefined();
        expect(Array.isArray(body.videos)).toBe(true);
    });
});
