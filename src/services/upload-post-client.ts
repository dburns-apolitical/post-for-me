import { logger } from '../utils/logger.js';

export class UploadPostClientService {
    private baseUrl = 'https://api.upload-post.com/api';

    constructor(
        private apiKey: string,
        private user: string
    ) {}

    /**
     * Post a video to Upload-Post platforms.
     * Uses sync mode — Upload-Post auto-switches to async if >59s.
     * If auto-switched, polls for completion.
     * Never throws — returns { success: false } on error.
     */
    async postVideo(
        videoUrl: string,
        caption: string,
        hashtags: string[],
        platforms: string[]
    ): Promise<{ success: boolean; requestId?: string; instagramPostId?: string }> {
        try {
            const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
            const fullCaption = `${caption}\n\n${hashtagString}`;

            const formData = new FormData();
            formData.append('user', this.user);
            formData.append('video', videoUrl);
            formData.append('title', fullCaption);

            for (const platform of platforms) {
                formData.append('platform[]', platform);
            }

            logger.info('Posting video to Upload-Post', {
                user: this.user,
                platforms,
                videoUrl,
            });

            const response = await fetch(`${this.baseUrl}/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Apikey ${this.apiKey}`,
                },
                body: formData,
            });

            const data = await response.json() as Record<string, unknown>;

            if (!response.ok) {
                logger.error('Upload-Post request failed', {
                    status: response.status,
                    response: data,
                    platforms,
                });
                return { success: false };
            }

            const requestId = (data as { request_id?: string }).request_id;

            // Check if Upload-Post auto-switched to async (returns request_id without results)
            if (requestId && !data.results) {
                logger.info('Upload-Post switched to async, polling for completion', {
                    requestId,
                    platforms,
                });
                return await this.pollForCompletion(requestId, platforms);
            }

            // Sync response — check per-platform results
            logger.info('Upload-Post completed (sync)', {
                status: response.status,
                platforms,
                results: data.results,
                response: data,
            });

            const igResult = (data.results as Record<string, Record<string, unknown>> | undefined)?.instagram;
            const instagramPostId = (igResult?.post_id ?? igResult?.publish_id) as string | undefined;
            return { success: true, requestId: requestId || undefined, instagramPostId };
        } catch (error) {
            logger.error('Error calling Upload-Post API', {
                error: error instanceof Error ? error.message : 'Unknown error',
                platforms,
            });
            return { success: false };
        }
    }

    /**
     * Poll Upload-Post status endpoint until completion.
     * Max 20 attempts with 15s intervals = 5 minutes.
     */
    private async pollForCompletion(
        requestId: string,
        platforms: string[],
        maxAttempts: number = 20,
        intervalMs: number = 15000
    ): Promise<{ success: boolean; requestId?: string; instagramPostId?: string }> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));

            try {
                const response = await fetch(
                    `${this.baseUrl}/uploadposts/status?request_id=${requestId}`,
                    {
                        headers: { 'Authorization': `Apikey ${this.apiKey}` },
                    }
                );

                if (!response.ok) {
                    logger.warn('Upload-Post status check failed', {
                        requestId,
                        status: response.status,
                        attempt,
                    });
                    continue;
                }

                const data = await response.json() as Record<string, unknown>;
                const status = data.status as string;

                logger.info('Upload-Post status poll', {
                    requestId,
                    status,
                    attempt,
                    results: data.results,
                });

                if (status === 'completed') {
                    const igResult = (data.results as Record<string, Record<string, unknown>> | undefined)?.instagram;
                    const instagramPostId = (igResult?.post_id ?? igResult?.publish_id) as string | undefined;
                    return { success: true, requestId, instagramPostId };
                }

                if (status !== 'pending' && status !== 'in_progress') {
                    logger.error('Upload-Post unexpected status', { requestId, status, data });
                    return { success: false, requestId, instagramPostId: undefined };
                }
            } catch (error) {
                logger.warn('Upload-Post status poll error', {
                    requestId,
                    attempt,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        logger.error('Upload-Post polling timed out', { requestId, maxAttempts, platforms });
        return { success: false, requestId, instagramPostId: undefined };
    }

    /**
     * Fetches the Instagram view count for a post via the Upload-Post analytics API.
     * Instagram-only: hardcodes platform=instagram and reads platforms.instagram.post_metrics.views.
     * Throws on API failure or missing views data so callers can handle per-post errors.
     */
    async getPostAnalytics(platformPostId: string): Promise<number> {
        const url = `${this.baseUrl}/uploadposts/post-analytics?platform_post_id=${encodeURIComponent(platformPostId)}&platform=instagram&user=${encodeURIComponent(this.user)}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Apikey ${this.apiKey}` },
        });

        if (!response.ok) {
            logger.error('Upload-Post post-analytics request failed', {
                status: response.status,
                platformPostId,
            });
            throw new Error(`Failed to fetch post analytics: ${response.status}`);
        }

        const data = await response.json() as Record<string, unknown>;

        const platforms = data.platforms as Record<string, Record<string, unknown>> | undefined;
        const postMetrics = platforms?.instagram?.post_metrics as Record<string, unknown> | undefined;
        const views = postMetrics?.views;

        if (typeof views !== 'number') {
            throw new Error(`Views metric not found in post analytics response for post ${platformPostId}`);
        }

        logger.debug('Retrieved post analytics', { platformPostId, views });
        return views;
    }

    /**
     * Fetches per-platform total impressions for the given Upload-Post username
     * for the last 24 hours. Platforms absent from the breakdown default to 0.
     * Throws on API failure or if the breakdown key is missing entirely.
     *
     * Note: the Upload-Post API docs do not show a concrete response example;
     * verify the exact breakdown key names against a live response if values
     * are unexpectedly 0.
     */
    async getTotalImpressions(username: string): Promise<{
        instagram: number;
        youtube: number;
        tiktok: number;
        twitter: number;
    }> {
        const url = `${this.baseUrl}/uploadposts/total-impressions/${encodeURIComponent(username)}?breakdown=true&period=last_day`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Apikey ${this.apiKey}` },
        });

        if (!response.ok) {
            logger.error('Upload-Post total-impressions request failed', {
                status: response.status,
                username,
            });
            throw new Error(`Failed to fetch total impressions: ${response.status}`);
        }

        const data = await response.json() as Record<string, unknown>;
        const breakdown = data.breakdown as Record<string, unknown> | undefined;

        if (!breakdown || typeof breakdown !== 'object') {
            throw new Error(`No breakdown in total-impressions response for user ${username}`);
        }

        return {
            instagram: typeof breakdown.instagram === 'number' ? breakdown.instagram : 0,
            youtube:   typeof breakdown.youtube   === 'number' ? breakdown.youtube   : 0,
            tiktok:    typeof breakdown.tiktok    === 'number' ? breakdown.tiktok    : 0,
            twitter:   typeof breakdown.twitter   === 'number' ? breakdown.twitter   : 0,
        };
    }
}
