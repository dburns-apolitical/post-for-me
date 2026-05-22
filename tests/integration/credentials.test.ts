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

        test('should return 401 when toggling active without authentication', async () => {
            const response = await fetch(`${BASE_URL}/api/credentials/1`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: false }),
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
