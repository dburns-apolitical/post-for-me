import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock fetch (for GCS public JSON API used by VideoSelectorService)
const mockFetch = mock(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
}) as unknown as ReturnType<typeof fetch>);

// Mock the neon SQL module (for DatabaseService)
const mockSql = mock(() => Promise.resolve([] as Record<string, unknown>[]));

mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Import after mocking
import { handleMedia } from '../../src/routes/media';

const authHeaders = {
    'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
};

const json = (res: Response) => res.json() as Promise<any>;

describe('GET /api/media', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        mockSql.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    test('returns 401 without authentication', async () => {
        const request = new Request('http://localhost/api/media?accountId=1', {
            method: 'GET',
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(401);
        const body = await json(response);
        expect(body.success).toBe(false);
    });

    test('returns 400 when accountId is missing', async () => {
        const request = new Request('http://localhost/api/media', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(400);
        const body = await json(response);
        expect(body.success).toBe(false);
        expect(body.error).toContain('accountId');
    });

    test('returns 400 when accountId is not a number', async () => {
        const request = new Request('http://localhost/api/media?accountId=abc', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(400);
        const body = await json(response);
        expect(body.success).toBe(false);
        expect(body.error).toContain('number');
    });

    test('returns 404 when account does not exist', async () => {
        // First DB call: getAccount returns empty
        mockSql.mockResolvedValueOnce([]);

        const request = new Request('http://localhost/api/media?accountId=999', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(404);
        const body = await json(response);
        expect(body.success).toBe(false);
    });

    test('returns merged + sorted media (newest first) with posted flags', async () => {
        // 1st DB call: getAccount
        mockSql.mockResolvedValueOnce([{
            id: 1,
            name: 'Test Account',
            ig_access_token: 'tok',
            ig_user_id: 'uid',
            gcs_bucket_name: 'test-bucket',
            created_at: new Date(),
        }]);

        // GCS list response (intentionally out of order to verify sort)
        mockFetch.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                items: [
                    { name: 'old.mp4', timeCreated: '2025-01-01T00:00:00Z' },
                    { name: 'new.mp4', timeCreated: '2025-03-01T00:00:00Z' },
                    { name: 'mid.mp4', timeCreated: '2025-02-01T00:00:00Z' },
                    { name: 'edited/skip.mp4', timeCreated: '2025-04-01T00:00:00Z' }, // must be excluded
                    { name: 'not-a-video.txt', timeCreated: '2025-05-01T00:00:00Z' }, // must be excluded
                ],
            }),
        }) as unknown as ReturnType<typeof fetch>);

        // 2nd DB call: getPostedVideoTitles → 'mid.mp4' has been posted
        mockSql.mockResolvedValueOnce([{ title: 'mid.mp4' }]);

        const request = new Request('http://localhost/api/media?accountId=1', {
            method: 'GET',
            headers: authHeaders,
        });

        const response = await handleMedia(request);

        expect(response.status).toBe(200);
        const body = await json(response);
        expect(body.success).toBe(true);

        // Sorted newest → oldest, filtered to mp4s outside edited/
        expect(body.media.map((m: { name: string }) => m.name)).toEqual([
            'new.mp4',
            'mid.mp4',
            'old.mp4',
        ]);

        // Posted flag matches the DB title
        const byName = Object.fromEntries(
            body.media.map((m: { name: string; posted: boolean }) => [m.name, m.posted])
        );
        expect(byName['mid.mp4']).toBe(true);
        expect(byName['new.mp4']).toBe(false);
        expect(byName['old.mp4']).toBe(false);

        // URLs use the account's bucket name
        for (const item of body.media) {
            expect(item.url).toBe(`https://storage.googleapis.com/test-bucket/${item.name}`);
        }
    });
});

// Separate describe block to isolate the auth mock override
describe('GET /api/media (admin gate)', () => {
    test('returns 403 when authenticated user is not admin', async () => {
        // Re-mock auth to simulate authenticated non-admin
        const { handleMedia: handleMediaForbidden } = await import('../../src/routes/media');

        const originalValidateAuth = (await import('../../src/utils/auth')).validateAuth;
        mock.module('../../src/utils/auth', () => ({
            validateAuth: async () => ({
                authenticated: true,
                isAdmin: false,
                userId: 'user-123',
            }),
            unauthorizedResponse: (msg: string) =>
                Response.json({ success: false, error: 'Unauthorized', message: msg }, { status: 401 }),
            forbiddenResponse: (msg: string) =>
                Response.json({ success: false, error: 'Forbidden', message: msg }, { status: 403 }),
        }));

        // Re-import handler so it picks up the new mock
        const reImported = await import('../../src/routes/media?bust=' + Date.now()) as { handleMedia: typeof handleMediaForbidden };

        const request = new Request('http://localhost/api/media?accountId=1', {
            method: 'GET',
        });

        const response = await reImported.handleMedia(request);

        expect(response.status).toBe(403);
        const body = await response.json() as { success: boolean };
        expect(body.success).toBe(false);

        // Restore original
        mock.module('../../src/utils/auth', () => ({
            validateAuth: originalValidateAuth,
        }));
    });
});
