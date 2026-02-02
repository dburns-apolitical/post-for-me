import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { InstagramPost } from '../types/index.js';

export class InstagramClientService {
    private accessToken: string;
    private userId: string;
    private baseUrl = 'https://graph.instagram.com/v18.0';

    constructor() {
        const config = getConfig();
        this.accessToken = config.instagram.accessToken;
        this.userId = config.instagram.userId;
    }

    /**
     * Create a media container for a Reel
     */
    async createMediaContainer(
        videoUrl: string,
        caption: string
    ): Promise<string> {
        try {
            const params = new URLSearchParams({
                media_type: 'REELS',
                video_url: videoUrl,
                caption: caption,
                access_token: this.accessToken,
            });

            const response = await fetch(
                `${this.baseUrl}/${this.userId}/media?${params}`,
                { method: 'POST' }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(
                    `Failed to create media container: ${response.status} ${JSON.stringify(errorData)}`
                );
            }

            const data = (await response.json()) as { id?: string };

            if (!data.id) {
                throw new Error('No container ID returned from Instagram');
            }

            logger.info('Media container created', {
                containerId: data.id,
            });

            return data.id;
        } catch (error) {
            logger.error('Error creating media container', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw new Error('Failed to create media container on Instagram');
        }
    }

    /**
     * Check the status of a media container
     */
    async checkContainerStatus(
        containerId: string
    ): Promise<{ status: string; errorMessage?: string }> {
        try {
            const params = new URLSearchParams({
                fields: 'status_code,status',
                access_token: this.accessToken,
            });

            const response = await fetch(
                `${this.baseUrl}/${containerId}?${params}`
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(
                    `Failed to check container status: ${response.status} ${JSON.stringify(errorData)}`
                );
            }

            const data = (await response.json()) as { status_code?: string; status?: string };

            return {
                status: data.status_code || 'UNKNOWN',
                errorMessage: data.status,
            };
        } catch (error) {
            logger.error('Error checking container status', {
                error: error instanceof Error ? error.message : 'Unknown error',
                containerId,
            });
            throw new Error('Failed to check container status');
        }
    }

    /**
     * Wait for container to be ready (poll with backoff)
     */
    async waitForContainerReady(
        containerId: string,
        maxAttempts: number = 30,
        initialDelayMs: number = 5000
    ): Promise<void> {
        let attempts = 0;
        let delayMs = initialDelayMs;

        while (attempts < maxAttempts) {
            const { status, errorMessage } = await this.checkContainerStatus(containerId);

            logger.info('Container status check', {
                containerId,
                status,
                attempt: attempts + 1,
                maxAttempts,
            });

            if (status === 'FINISHED') {
                return;
            }

            if (status === 'ERROR') {
                throw new Error(`Container processing failed: ${errorMessage || 'Unknown error'}`);
            }

            if (status === 'EXPIRED') {
                throw new Error('Container expired before publishing');
            }

            // Wait before next check with exponential backoff (max 30s)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs = Math.min(delayMs * 1.5, 30000);
            attempts++;
        }

        throw new Error(`Container not ready after ${maxAttempts} attempts`);
    }

    /**
     * Publish a media container
     */
    async publishMedia(containerId: string): Promise<string> {
        try {
            const params = new URLSearchParams({
                creation_id: containerId,
                access_token: this.accessToken,
            });

            const response = await fetch(
                `${this.baseUrl}/${this.userId}/media_publish?${params}`,
                { method: 'POST' }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(
                    `Failed to publish media: ${response.status} ${JSON.stringify(errorData)}`
                );
            }

            const data = (await response.json()) as { id?: string };

            if (!data.id) {
                throw new Error('No media ID returned from Instagram');
            }

            logger.info('Media published successfully', {
                mediaId: data.id,
            });

            return data.id;
        } catch (error) {
            logger.error('Error publishing media', {
                error: error instanceof Error ? error.message : 'Unknown error',
                containerId,
            });
            throw new Error('Failed to publish media on Instagram');
        }
    }

    /**
     * Get basic account info to verify credentials
     */
    async getAccountInfo(): Promise<{
        id: string;
        username: string;
        account_type: string;
        media_count: number;
    }> {
        try {
            const params = new URLSearchParams({
                fields: 'id,username,account_type,media_count',
                access_token: this.accessToken,
            });

            const response = await fetch(
                `${this.baseUrl}/${this.userId}?${params}`
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(
                    `Failed to get account info: ${response.status} ${JSON.stringify(errorData)}`
                );
            }

            const data = (await response.json()) as {
                id: string;
                username: string;
                account_type: string;
                media_count: number;
            };

            logger.info('Retrieved Instagram account info', {
                username: data.username,
                accountType: data.account_type,
            });

            return {
                id: data.id,
                username: data.username,
                account_type: data.account_type,
                media_count: data.media_count,
            };
        } catch (error) {
            logger.error('Error getting account info', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }

    /**
     * Post a Reel to Instagram (full flow)
     */
    async postReel(
        videoUrl: string,
        caption: string,
        hashtags: string[]
    ): Promise<InstagramPost> {
        // Format caption with hashtags
        const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
        const fullCaption = `${caption}\n\n${hashtagString}`;

        // Step 1: Create media container
        logger.info('Creating media container for Reel');
        const containerId = await this.createMediaContainer(videoUrl, fullCaption);

        // Step 2: Wait for container to be ready
        logger.info('Waiting for container to be ready');
        await this.waitForContainerReady(containerId);

        // Step 3: Publish the media
        logger.info('Publishing Reel');
        const mediaId = await this.publishMedia(containerId);

        return {
            id: mediaId,
            status: 'published',
            containerId,
        };
    }
}
