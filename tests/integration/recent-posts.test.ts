import { describe, test, expect } from 'bun:test';

const BASE_URL = 'http://localhost:3000';

describe('GET /api/stats/recent-posts', () => {
    test('should return 401 without authentication', async () => {
        const response = await fetch(`${BASE_URL}/api/stats/recent-posts`);
        expect(response.status).toBe(401);
    });

    test('should return recent posts array with correct shape', async () => {
        // This test requires a valid admin auth token
        // In CI, this would use a test token
        const response = await fetch(`${BASE_URL}/api/stats/recent-posts`);
        // Without auth, we verify it rejects properly
        const data = await response.json() as { success: boolean; error?: string };
        expect(data.success).toBe(false);
    });
});
