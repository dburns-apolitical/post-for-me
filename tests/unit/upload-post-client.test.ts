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

    describe('getTotalImpressions', () => {
        test('returns per-platform counts from per_platform response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 5000,
                    per_platform: { instagram: 2000, youtube: 1500, tiktok: 1000, twitter: 500 },
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

        test('returns zeros when per_platform is absent', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ total_impressions: 0 }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result).toEqual({ instagram: 0, youtube: 0, tiktok: 0, twitter: 0 });
        });

        test('defaults missing platforms to 0', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 2000,
                    per_platform: { instagram: 2000 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result).toEqual({ instagram: 2000, youtube: 0, tiktok: 0, twitter: 0 });
        });

        test('uses ?date=YYYY-MM-DD when options.date is provided (instead of period=last_day)', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 3000,
                    per_platform: { instagram: 1500, youtube: 1000, tiktok: 400, twitter: 100 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile', { date: '2025-05-15' });

            expect(result).toEqual({ instagram: 1500, youtube: 1000, tiktok: 400, twitter: 100 });
            const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/uploadposts/total-impressions/myprofile');
            expect(url).toContain('breakdown=true');
            expect(url).toContain('date=2025-05-15');
            expect(url).not.toContain('period=last_day');
        });

        test('maps per_platform.x to twitter when per_platform.twitter is absent', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    total_impressions: 999,
                    per_platform: { x: 999 },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getTotalImpressions('myprofile');

            expect(result.twitter).toBe(999);
            expect(result).toEqual({ instagram: 0, youtube: 0, tiktok: 0, twitter: 999 });
        });
    });

    describe('postVideoAsync', () => {
        test('submits with async_upload=true and X-Request-Id header, resolves on 2xx', async () => {
            const fetchMock = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ request_id: 'req-async' }),
            })) as ReturnType<typeof mock>;
            globalThis.fetch = fetchMock as unknown as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await client.postVideoAsync({
                requestId: 'req-async',
                videoUrl: 'https://video.url/x.mp4',
                caption: 'cap',
                hashtags: ['a', 'b'],
                platforms: ['tiktok', 'instagram'],
            });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toBe('https://api.upload-post.com/api/upload');
            expect(options.method).toBe('POST');
            const headers = options.headers as Record<string, string>;
            expect(headers['Authorization']).toBe('Apikey test-api-key');
            expect(headers['X-Request-Id']).toBe('req-async');
            const body = options.body as FormData;
            expect(body.get('user')).toBe('test-user');
            expect(body.get('video')).toBe('https://video.url/x.mp4');
            expect(body.get('async_upload')).toBe('true');
            expect(body.get('title')).toBe('cap\n\n#a #b');
            expect(body.getAll('platform[]')).toEqual(['tiktok', 'instagram']);
        });

        test('throws on non-2xx', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: 'kaboom' }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.postVideoAsync({
                requestId: 'req-x',
                videoUrl: 'https://video.url/x.mp4',
                caption: 'cap',
                hashtags: [],
                platforms: ['tiktok'],
            })).rejects.toThrow(/Upload-Post submission failed: 500/);
        });
    });

    describe('getUploadStatus', () => {
        test('returns in-progress for each documented in-progress status (regression for the original bug)', async () => {
            const inProgressStatuses = ['pending', 'queued', 'processing', 'in_progress'] as const;
            for (const status of inProgressStatuses) {
                globalThis.fetch = mock(() => Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ request_id: 'r', status }),
                })) as typeof fetch;

                const client = new UploadPostClientService('test-api-key', 'test-user');
                const result = await client.getUploadStatus('r');

                expect(result.status).toBe(status);
            }
        });

        test('returns completed with extracted instagramPostId from results.instagram.post_id', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    request_id: 'r',
                    status: 'completed',
                    results: { instagram: { post_id: 'ig-123', success: true } },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe('completed');
            if (result.status === 'completed') {
                expect(result.instagramPostId).toBe('ig-123');
            }
        });

        test('falls back to publish_id when post_id is absent in completed response', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    request_id: 'r',
                    status: 'completed',
                    results: { instagram: { publish_id: 'pub-999' } },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe('completed');
            if (result.status === 'completed') {
                expect(result.instagramPostId).toBe('pub-999');
            }
        });

        test('returns completed with instagramPostId=null when instagram is absent', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    request_id: 'r',
                    status: 'completed',
                    results: { tiktok: { success: true } },
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe('completed');
            if (result.status === 'completed') {
                expect(result.instagramPostId).toBeNull();
            }
        });

        test('returns failed with results payload', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    request_id: 'r',
                    status: 'failed',
                    results: [{ platform: 'tiktok', status: 'failed', error: 'nope' }],
                }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe('failed');
        });

        test('returns not_found on HTTP 404', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ error: 'not found' }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe('not_found');
        });

        test('returns unknown for unrecognized status string (does NOT treat as terminal)', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ request_id: 'r', status: 'something-new' }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            const result = await client.getUploadStatus('r');

            expect(result.status).toBe('unknown');
            if (result.status === 'unknown') {
                expect(result.raw).toBe('something-new');
            }
        });

        test('throws on HTTP 5xx', async () => {
            globalThis.fetch = mock(() => Promise.resolve({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: 'kaboom' }),
            })) as typeof fetch;

            const client = new UploadPostClientService('test-api-key', 'test-user');
            await expect(client.getUploadStatus('r')).rejects.toThrow(/Upload-Post status fetch failed: 500/);
        });
    });
});
