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
            await expect(client.getPostAnalytics('ig-post-123')).rejects.toThrow('Views metric not found in post analytics response for post ig-post-123');
        });
    });

    describe('postVideo instagramPostId extraction', () => {
        test('returns instagramPostId from sync response results.instagram.post_id', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    request_id: 'req-123',
                    results: {
                        instagram: { post_id: 'ig-456', success: true },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.postVideo('https://video.url', 'caption', [], ['instagram']);

            expect(result.success).toBe(true);
            expect(result.instagramPostId).toBe('ig-456');
        });

        test('falls back to publish_id when post_id is absent', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    request_id: 'req-123',
                    results: {
                        instagram: { publish_id: 'pub-789', success: true },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.postVideo('https://video.url', 'caption', [], ['instagram']);

            expect(result.success).toBe(true);
            expect(result.instagramPostId).toBe('pub-789');
        });

        test('returns undefined instagramPostId when Instagram is not in results', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    request_id: 'req-123',
                    results: {
                        youtube: { video_id: 'yt-123', success: true },
                    },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.postVideo('https://video.url', 'caption', [], ['youtube']);

            expect(result.success).toBe(true);
            expect(result.instagramPostId).toBeUndefined();
        });
    });

    describe('getTotalImpressions', () => {
        test('returns per-platform counts from breakdown response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 5000,
                    breakdown: { instagram: 2000, youtube: 1500, tiktok: 1000, twitter: 500 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result).toEqual({ instagram: 2000, youtube: 1500, tiktok: 1000, twitter: 500 });
            const [url, options] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/uploadposts/total-impressions/myprofile');
            expect(url).toContain('breakdown=true');
            expect(url).toContain('period=last_day');
            expect((options.headers as Record<string, string>)['Authorization']).toBe('Apikey test-api-key');
        });

        test('throws when API response is not ok', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 401,
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getTotalImpressions('myprofile')).rejects.toThrow('Failed to fetch total impressions: 401');
        });

        test('throws when breakdown is absent in response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ total_impressions: 5000 }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getTotalImpressions('myprofile')).rejects.toThrow('No breakdown in total-impressions response for user myprofile');
        });

        test('defaults missing platforms to 0', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 2000,
                    breakdown: { instagram: 2000 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result).toEqual({ instagram: 2000, youtube: 0, tiktok: 0, twitter: 0 });
        });
    });
});
