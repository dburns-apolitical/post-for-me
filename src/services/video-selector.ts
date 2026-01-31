import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { VideoFile } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

export class VideoSelectorService {
    private bucketName: string;
    private tempDir: string;
    private projectId: string;

    constructor() {
        const config = getConfig();

        this.bucketName = config.gcs.bucketName;
        this.tempDir = config.tempDir;
        this.projectId = config.gcs.projectId;

        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * List all video files in the GCS bucket using public JSON API
     */
    async listVideos(): Promise<VideoFile[]> {
        try {
            // Use public JSON API to list files (no authentication required for public buckets)
            const url = `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o`;

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to list bucket contents: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as { items?: Array<{ name: string; timeCreated: string }> };
            const items = data.items || [];

            // Filter for video files (excluding edited/ folder)
            const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
            const videoFiles: VideoFile[] = items
                .filter((file: any) => {
                    const ext = path.extname(file.name).toLowerCase();
                    const isVideo = videoExtensions.includes(ext);
                    const isInEditedFolder = file.name.startsWith('edited/');
                    return isVideo && !isInEditedFolder;
                })
                .map((file: any) => ({
                    name: file.name,
                    path: `gs://${this.bucketName}/${file.name}`,
                    url: `https://storage.googleapis.com/${this.bucketName}/${file.name}`,
                    createdAt: new Date(file.timeCreated),
                }));

            logger.info(`Found ${videoFiles.length} video files in bucket`, {
                bucket: this.bucketName,
            });

            return videoFiles;
        } catch (error) {
            logger.error('Error listing videos from GCS', {
                error: error instanceof Error ? error.message : 'Unknown error',
                bucket: this.bucketName,
            });
            throw new Error('Failed to list videos from storage');
        }
    }

    /**
     * Select a random video from available videos
     */
    async selectRandomVideo(): Promise<VideoFile> {
        const videos = await this.listVideos();

        if (videos.length === 0) {
            throw new Error('No videos found in storage bucket');
        }

        const randomIndex = Math.floor(Math.random() * videos.length);
        const selectedVideo = videos[randomIndex];

        logger.info('Selected random video', {
            video: selectedVideo.name,
            totalVideos: videos.length,
        });

        return selectedVideo;
    }

    /**
     * Select the newest unused video, or fall back to the newest video if all have been posted
     * Videos are sorted by upload date (newest first)
     */
    async selectPrioritizedVideo(postedVideos: string[]): Promise<VideoFile> {
        const videos = await this.listVideos();

        if (videos.length === 0) {
            throw new Error('No videos found in storage bucket');
        }

        // Sort by createdAt descending (newest first)
        const sortedVideos = [...videos].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );

        // Filter to unused videos
        const postedSet = new Set(postedVideos);
        const unusedVideos = sortedVideos.filter((v) => !postedSet.has(v.name));

        let selectedVideo: VideoFile;

        if (unusedVideos.length > 0) {
            // Select the newest unused video
            selectedVideo = unusedVideos[0];
            logger.info('Selected newest unused video', {
                video: selectedVideo.name,
                createdAt: selectedVideo.createdAt.toISOString(),
                unusedCount: unusedVideos.length,
                totalVideos: videos.length,
            });
        } else {
            // All videos have been posted, fall back to newest overall
            selectedVideo = sortedVideos[0];
            logger.info('All videos posted, selected newest video', {
                video: selectedVideo.name,
                createdAt: selectedVideo.createdAt.toISOString(),
                totalVideos: videos.length,
            });
        }

        return selectedVideo;
    }

    /**
     * Download a video from public URL to local temp storage
     */
    async downloadVideo(videoFile: VideoFile): Promise<string> {
        try {
            const localPath = path.join(
                this.tempDir,
                `input-${Date.now()}-${path.basename(videoFile.name)}`
            );

            // Download from public URL
            const response = await fetch(videoFile.url);

            if (!response.ok) {
                throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Write to file
            fs.writeFileSync(localPath, buffer);

            logger.info('Video downloaded successfully', {
                video: videoFile.name,
                localPath,
                size: buffer.length,
            });

            return localPath;
        } catch (error) {
            logger.error('Error downloading video', {
                error: error instanceof Error ? error.message : 'Unknown error',
                video: videoFile.name,
            });
            throw new Error('Failed to download video from storage');
        }
    }

    /**
     * Select and download a random video
     */
    async getRandomVideo(): Promise<{ videoFile: VideoFile; localPath: string }> {
        const videoFile = await this.selectRandomVideo();
        const localPath = await this.downloadVideo(videoFile);

        return { videoFile, localPath };
    }

    /**
     * Select and download the newest unused video (prioritized selection)
     */
    async getPrioritizedVideo(postedVideos: string[]): Promise<{ videoFile: VideoFile; localPath: string }> {
        const videoFile = await this.selectPrioritizedVideo(postedVideos);
        const localPath = await this.downloadVideo(videoFile);

        return { videoFile, localPath };
    }

    /**
     * Clean up temporary video file
     */
    cleanupTempFile(filePath: string): void {
        // only run this in production
        if (process.env.NODE_ENV !== 'production') {
            logger.debug('Skipping cleanup of temp file in development', { filePath });
            return;
        }
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.debug('Cleaned up temp file', { filePath });
            }
        } catch (error) {
            logger.warn('Failed to cleanup temp file', {
                filePath,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * Upload an edited video to GCS (in edited/ folder) and return the public URL
     * Videos in edited/ folder won't be picked up by listVideos()
     */
    async uploadEditedVideo(localPath: string): Promise<string> {
        try {
            const fileName = path.basename(localPath);
            const gcsPath = `edited/${fileName}`;
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucketName}/o?uploadType=media&name=${encodeURIComponent(gcsPath)}`;

            // Read the file
            const fileBuffer = fs.readFileSync(localPath);

            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'video/mp4',
                },
                body: fileBuffer,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`GCS upload failed: ${response.status} ${errorText}`);
            }

            const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${gcsPath}`;

            logger.info('Edited video uploaded to GCS', {
                localPath,
                gcsPath,
                publicUrl,
                size: fileBuffer.length,
            });

            return publicUrl;
        } catch (error) {
            logger.error('Error uploading edited video to GCS', {
                error: error instanceof Error ? error.message : 'Unknown error',
                localPath,
            });
            throw new Error('Failed to upload edited video to storage');
        }
    }
}
