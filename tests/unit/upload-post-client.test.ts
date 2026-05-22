import { describe, test, expect, mock, afterEach } from 'bun:test';
import { UploadPostClientService } from '../../src/services/upload-post-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('UploadPostClientService', () => {
    describe('getPostAnalytics', () => {
        test('returns views count from Instagram post_metrics', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    platforms: {
                        instagram: {
                            post_metrics: { views: 1234, likes: 56 },
                        },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const views = await client.getPostAnalytics('ig-post-123');

            expect(views).toBe(1234);
            const [url, options] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
            expect(url).toContain('platform_post_id=ig-post-123');
            expect(url).toContain('platform=instagram');
            expect(url).toContain('user=test-user');
            expect((options.headers as Record<string, string>)['Authorization']).toBe('Apikey test-api-key');
        });

        test('throws when API response is not ok', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 401,
                json: () => Promise.resolve({ error: 'Unauthorized' }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getPostAnalytics('ig-post-123')).rejects.toThrow('Failed to fetch post analytics: 401');
        });

        test('throws when views field is absent in response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    platforms: { instagram: { post_metrics: {} } },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getPostAnalytics('ig-post-123')).rejects.toThrow('Views metric not found');
        });
    });
});
