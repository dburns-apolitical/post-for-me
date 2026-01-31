import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { BufferPost } from '../types/index.js';
import * as fs from 'fs';

export class BufferClientService {
  private accessToken: string;
  private profileId: string;
  private baseUrl = 'https://api.bufferapp.com/1';

  constructor() {
    const config = getConfig();
    this.accessToken = config.buffer.accessToken;
    this.profileId = config.buffer.profileId;
  }

  /**
   * Upload media to Buffer
   */
  async uploadMedia(videoPath: string): Promise<string> {
    try {
      // Read video file as blob
      const videoFile = await Bun.file(videoPath).arrayBuffer();
      const fileName = videoPath.split('/').pop() || 'video.mp4';

      // Create form data
      const formData = new FormData();
      formData.append('media', new Blob([videoFile], { type: 'video/mp4' }), fileName);
      formData.append('access_token', this.accessToken);

      const response = await fetch(`${this.baseUrl}/uploads`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Buffer upload failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.media || !data.media.url) {
        throw new Error('No media URL returned from Buffer');
      }

      logger.info('Video uploaded to Buffer', {
        mediaUrl: data.media.url,
      });

      return data.media.url;
    } catch (error) {
      logger.error('Error uploading media to Buffer', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to upload media to Buffer');
    }
  }

  /**
   * Create a post on Buffer
   */
  async createPost(
    caption: string,
    hashtags: string[],
    mediaUrl: string,
    scheduleAt?: Date
  ): Promise<BufferPost> {
    try {
      // Format caption with hashtags
      const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');
      const fullCaption = `${caption}\n\n${hashtagString}`;

      const postData: any = {
        profile_ids: [this.profileId],
        text: fullCaption,
        media: {
          video: mediaUrl,
        },
        shorten: false,
        now: !scheduleAt,
      };

      if (scheduleAt) {
        postData.scheduled_at = Math.floor(scheduleAt.getTime() / 1000);
      }

      const response = await fetch(`${this.baseUrl}/updates/create.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(postData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Buffer post creation failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      logger.info('Post created on Buffer', {
        postId: data.updates?.[0]?.id || 'unknown',
        profileId: this.profileId,
      });

      return {
        id: data.updates?.[0]?.id || 'unknown',
        status: data.updates?.[0]?.status || 'created',
        scheduledAt: scheduleAt?.toISOString(),
      };
    } catch (error) {
      logger.error('Error creating post on Buffer', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to create post on Buffer');
    }
  }

  /**
   * Get profile information
   */
  async getProfile(): Promise<any> {
    try {
      const response = await fetch(
        `${this.baseUrl}/profiles/${this.profileId}.json?access_token=${this.accessToken}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Buffer profile fetch failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      logger.info('Retrieved Buffer profile', {
        profileId: this.profileId,
        service: data.service,
      });

      return data;
    } catch (error) {
      logger.error('Error fetching Buffer profile', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to fetch Buffer profile');
    }
  }

  /**
   * Upload video and create post in one step
   */
  async postVideo(
    videoPath: string,
    caption: string,
    hashtags: string[],
    scheduleAt?: Date
  ): Promise<BufferPost> {
    // Upload video
    const mediaUrl = await this.uploadMedia(videoPath);

    // Create post with media
    const post = await this.createPost(caption, hashtags, mediaUrl, scheduleAt);

    return post;
  }
}
