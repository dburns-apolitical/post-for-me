import { logger } from '../utils/logger.js';

export type UploadPostStatusResult =
    | { status: 'pending' | 'queued' | 'processing' | 'in_progress'; raw: string; data: unknown }
    | { status: 'completed'; instagramPostId: string | null; raw: string; data: unknown }
    | { status: 'failed'; raw: string; data: unknown }
    | { status: 'not_found' }
    | { status: 'unknown'; raw: string; data: unknown };

const IN_PROGRESS_STATUSES = new Set(['pending', 'queued', 'processing', 'in_progress']);

export class UploadPostClientService {
    private baseUrl = 'https://api.upload-post.com/api';

    constructor(
        private apiKey: string,
        private user: string
    ) {}

    /**
     * Submit a video upload to Upload-Post with async_upload=true. The caller is responsible
     * for persisting the requestId beforehand so the status cron can poll it. This method
     * never polls — it returns once Upload-Post has accepted the submission (2xx) or throws
     * on any failure. The X-Request-Id header makes the submission idempotent: if a network
     * timeout causes a retry with the same requestId, Upload-Post returns the existing job
     * rather than creating a duplicate.
     */
    async postVideoAsync(opts: {
        requestId: string;
        videoUrl: string;
        caption: string;
        hashtags: string[];
        platforms: string[];
        shareToFeed?: boolean;
    }): Promise<void> {
        const hashtagString = opts.hashtags.map((tag) => `#${tag}`).join(' ');
        const fullCaption = opts.hashtags.length > 0
            ? `${opts.caption}\n\n${hashtagString}`
            : opts.caption;

        const formData = new FormData();
        formData.append('user', this.user);
        formData.append('video', opts.videoUrl);
        formData.append('title', fullCaption);
        formData.append('async_upload', 'true');
        if (opts.shareToFeed !== undefined && opts.platforms.includes('instagram')) {
            formData.append('share_to_feed', String(opts.shareToFeed));
        }
        for (const platform of opts.platforms) {
            formData.append('platform[]', platform);
        }

        logger.info('Submitting video to Upload-Post (async)', {
            user: this.user,
            requestId: opts.requestId,
            platforms: opts.platforms,
            videoUrl: opts.videoUrl,
        });

        const response = await fetch(`${this.baseUrl}/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Apikey ${this.apiKey}`,
                'X-Request-Id': opts.requestId,
            },
            body: formData,
        });

        if (!response.ok) {
            let bodyText = '';
            try { bodyText = JSON.stringify(await response.json()); } catch { /* ignore */ }
            logger.error('Upload-Post submission failed', {
                status: response.status,
                requestId: opts.requestId,
                body: bodyText,
            });
            throw new Error(`Upload-Post submission failed: ${response.status}`);
        }
    }

    /**
     * Fetch the current status of an async Upload-Post submission. Returns a typed result
     * matching the documented top-level status field. Unrecognized statuses become
     * `{ status: 'unknown' }` — the cron's caller treats this as no-op and lets the
     * 1-hour safety net handle truly stuck requests.
     */
    async getUploadStatus(requestId: string): Promise<UploadPostStatusResult> {
        const response = await fetch(
            `${this.baseUrl}/uploadposts/status?request_id=${encodeURIComponent(requestId)}`,
            { headers: { 'Authorization': `Apikey ${this.apiKey}` } }
        );

        if (response.status === 404) {
            return { status: 'not_found' };
        }
        if (!response.ok) {
            logger.error('Upload-Post status fetch failed', { requestId, status: response.status });
            throw new Error(`Upload-Post status fetch failed: ${response.status}`);
        }

        const data = await response.json() as Record<string, unknown>;
        const raw = String(data.status ?? '');

        if (IN_PROGRESS_STATUSES.has(raw)) {
            return { status: raw as 'pending' | 'queued' | 'processing' | 'in_progress', raw, data };
        }
        if (raw === 'completed') {
            const results = Array.isArray(data.results)
                ? (data.results as Array<Record<string, unknown>>)
                : [];
            const igResult = results.find((r) => r.platform === 'instagram');
            const instagramPostId = (igResult?.platform_post_id ?? null) as string | null;
            return { status: 'completed', instagramPostId, raw, data };
        }
        if (raw === 'failed') {
            return { status: 'failed', raw, data };
        }
        return { status: 'unknown', raw, data };
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
     * Fetches per-platform total impressions for the given Upload-Post username.
     * - With no options (or `options.date` omitted): rolling last 24 hours (`period=last_day`).
     *   This is what the daily cron uses.
     * - With `options.date` (YYYY-MM-DD): impressions for that specific past day, used by the
     *   manual backfill endpoint.
     *
     * The Upload-Post API returns per-platform counts under `per_platform` (note: the
     * `breakdown=true` query param is what asks for it, but the response field is named
     * `per_platform`). Platforms absent from `per_platform` default to 0. If `per_platform`
     * itself is missing (e.g. a day with no activity), all platforms default to 0 rather
     * than throwing — that way legitimate "no data" days still get a zero row recorded.
     *
     * Twitter is accepted under either `twitter` or `x` (Upload-Post's docs are inconsistent).
     * Throws only on API/HTTP failure.
     */
    async getTotalImpressions(
        username: string,
        options?: { date?: string }
    ): Promise<{
        instagram: number;
        youtube: number;
        tiktok: number;
        twitter: number;
    }> {
        const params = new URLSearchParams({ breakdown: 'true' });
        if (options?.date) {
            params.set('date', options.date);
        } else {
            params.set('period', 'last_day');
        }
        const url = `${this.baseUrl}/uploadposts/total-impressions/${encodeURIComponent(username)}?${params.toString()}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Apikey ${this.apiKey}` },
        });

        if (!response.ok) {
            logger.error('Upload-Post total-impressions request failed', {
                status: response.status,
                username,
                date: options?.date,
            });
            throw new Error(`Failed to fetch total impressions: ${response.status}`);
        }

        const data = await response.json() as Record<string, unknown>;
        const perPlatform = data.per_platform as Record<string, unknown> | undefined;

        if (!perPlatform || typeof perPlatform !== 'object') {
            return { instagram: 0, youtube: 0, tiktok: 0, twitter: 0 };
        }

        const twitterRaw = perPlatform.twitter ?? perPlatform.x;
        return {
            instagram: typeof perPlatform.instagram === 'number' ? perPlatform.instagram : 0,
            youtube:   typeof perPlatform.youtube   === 'number' ? perPlatform.youtube   : 0,
            tiktok:    typeof perPlatform.tiktok    === 'number' ? perPlatform.tiktok    : 0,
            twitter:   typeof twitterRaw            === 'number' ? twitterRaw            : 0,
        };
    }
}
