import { logger } from '../utils/logger.js';

export class UploadPostClientService {
    private baseUrl = 'https://api.upload-post.com/api';

    constructor(
        private apiKey: string,
        private user: string
    ) {}

    /**
     * Post a video to Upload-Post platforms (fire-and-forget style).
     * Never throws — returns { success: false } on error.
     */
    async postVideo(
        videoUrl: string,
        caption: string,
        hashtags: string[],
        platforms: string[]
    ): Promise<{ success: boolean; requestId?: string }> {
        try {
            const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
            const fullCaption = `${caption}\n\n${hashtagString}`;

            const formData = new FormData();
            formData.append('user', this.user);
            formData.append('video', videoUrl);
            formData.append('title', fullCaption);
            formData.append('async_upload', 'true');

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

            if (response.ok) {
                const requestId = (data as { request_id?: string }).request_id;
                logger.info('Upload-Post request accepted', {
                    status: response.status,
                    requestId,
                    platforms,
                });
                return { success: true, requestId: requestId || undefined };
            }

            logger.error('Upload-Post request failed', {
                status: response.status,
                response: data,
                platforms,
            });
            return { success: false };
        } catch (error) {
            logger.error('Error calling Upload-Post API', {
                error: error instanceof Error ? error.message : 'Unknown error',
                platforms,
            });
            return { success: false };
        }
    }
}
