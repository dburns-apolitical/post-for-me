import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { logger } from '../utils/logger.js';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../config/index.js';

// Use the bundled ffmpeg and ffprobe binaries
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface TextOverlayOptions {
    text: string;
    fontSize?: number;
    fontColor?: string;
    position?: 'top' | 'center' | 'bottom';
    strokeColor?: string;
    strokeWidth?: number;
    paddingX?: number;
    paddingY?: number;
    autoFit?: boolean;
    minFontSize?: number;
    maxLines?: number;
}

export class VideoEditorService {
    private tempDir: string;

    constructor() {
        const config = getConfig();
        this.tempDir = config.tempDir;

        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Add text overlay to a video
     */
    async addTextOverlay(
        inputPath: string,
        text: string,
        options: Partial<TextOverlayOptions> = {}
    ): Promise<string> {
        const {
            fontSize = 60,
            fontColor = 'white',
            position = 'top',
            strokeColor = 'black',
            strokeWidth = 3,
            paddingX = 40,
            paddingY = 100,
            autoFit = true,
            minFontSize = 24,
            maxLines = 3,
        } = options;

        const outputPath = path.join(
            this.tempDir,
            `edited-${Date.now()}-${path.basename(inputPath)}`
        );

        try {
            let finalText = text;
            let finalFontSize = fontSize;

            if (autoFit) {
                // Probe video to get dimensions
                const videoInfo = await this.validateVideoFormat(inputPath);
                const videoWidth = videoInfo.width || 1080; // Default to 1080 for 9:16 reels

                const fitted = this.fitTextToWidth(
                    text,
                    videoWidth,
                    paddingX,
                    fontSize,
                    minFontSize,
                    maxLines
                );

                finalText = fitted.lines.join('\n');
                finalFontSize = fitted.fontSize;

                logger.debug('Auto-fit text overlay', {
                    originalText: text,
                    lines: fitted.lines,
                    originalFontSize: fontSize,
                    finalFontSize,
                });
            }

            await this.processVideo(
                inputPath,
                outputPath,
                finalText,
                finalFontSize,
                fontColor,
                position,
                strokeColor,
                strokeWidth,
                paddingY
            );

            logger.info('Video edited successfully', {
                inputPath,
                outputPath,
                text: finalText,
            });

            return outputPath;
        } catch (error) {
            logger.error('Error editing video', {
                error: error instanceof Error ? error.message : 'Unknown error',
                inputPath,
            });
            throw new Error('Failed to edit video');
        }
    }

    /**
     * Escape text for ffmpeg drawtext filter
     */
    private escapeTextForFFmpeg(text: string): string {
        return text
            .replace(/\\/g, '\\\\\\\\')  // Backslashes (must be first)
            .replace(/'/g, "'\\\\\\''")  // Single quotes: end quote, escaped quote, reopen
            .replace(/:/g, '\\:')        // Colons (filter separator)
            .replace(/%/g, '\\%')        // Percent signs
            .replace(/,/g, '\\,')        // Commas (filter option separator)
            .replace(/;/g, '\\;')        // Semicolons (filter chain separator)
            .replace(/\[/g, '\\[')       // Square brackets (stream labels)
            .replace(/\]/g, '\\]');
    }

    /**
     * Process video with ffmpeg
     */
    private processVideo(
        inputPath: string,
        outputPath: string,
        text: string,
        fontSize: number,
        fontColor: string,
        position: string,
        strokeColor: string,
        strokeWidth: number,
        paddingY: number
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            // Find a suitable bold font file (macOS or Linux paths)
            const fontPaths = [
                '/System/Library/Fonts/Supplemental/Arial Bold.ttf',  // macOS bold
                '/System/Library/Fonts/Helvetica.ttc',                // macOS (fallback)
                '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', // Linux/Docker bold
                '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',           // Alpine Linux bold
            ];

            let fontFile = '';
            for (const fontPath of fontPaths) {
                if (fs.existsSync(fontPath)) {
                    fontFile = fontPath;
                    break;
                }
            }

            const fontOption = fontFile ? `fontfile='${fontFile}':` : '';
            const lineHeight = fontSize + Math.round(fontSize * 0.4); // Font size + 40% spacing
            const lines = text.split('\n');

            // Calculate total text block height
            const totalTextHeight = lines.length * lineHeight;

            // Calculate base Y position based on placement
            let baseY: number;
            switch (position) {
                case 'top':
                    baseY = -3; // Marker for percentage-based top positioning (25% from top)
                    break;
                case 'center':
                    // This will be calculated as expression for center
                    baseY = -1; // Marker for center positioning
                    break;
                case 'bottom':
                    baseY = -2; // Marker for bottom positioning
                    break;
                default:
                    baseY = -3; // Default to percentage-based top positioning
            }

            // Build filter strings - one drawtext per line for reliable multi-line support
            const filterStrings = lines.map((line, index) => {
                const escapedLine = this.escapeTextForFFmpeg(line);
                const lineOffset = index * lineHeight;

                let yPosition: string;
                if (baseY === -1) {
                    // Center: calculate from middle of video
                    yPosition = `(h-${totalTextHeight})/2+${lineOffset}`;
                } else if (baseY === -2) {
                    // Bottom: calculate from bottom
                    yPosition = `h-${totalTextHeight}-${paddingY}+${lineOffset}`;
                } else if (baseY === -3) {
                    // Top at 25% of video height
                    yPosition = `(h*0.25)+${lineOffset}`;
                } else {
                    // Fallback to fixed pixel position
                    yPosition = `${baseY + lineOffset}`;
                }

                return `drawtext=${fontOption}text='${escapedLine}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=${yPosition}:borderw=${strokeWidth}:bordercolor=${strokeColor}`;
            });

            ffmpeg(inputPath)
                .videoFilters(filterStrings)
                .outputOptions([
                    '-codec:a', 'copy', // Copy audio without re-encoding
                    '-preset', 'ultrafast', // Less memory usage than 'fast'
                    '-crf', '23', // Constant Rate Factor for quality
                    '-threads', '1', // Single thread to reduce memory usage
                    '-max_muxing_queue_size', '1024', // Limit muxing buffer
                ])
                .output(outputPath)
                .on('start', (commandLine) => {
                    logger.debug('FFmpeg command', { commandLine });
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        logger.debug('Processing video', { percent: progress.percent.toFixed(1) });
                    }
                })
                .on('end', () => {
                    logger.info('FFmpeg processing completed');
                    resolve();
                })
                .on('error', (err) => {
                    logger.error('FFmpeg error', { error: err.message });
                    reject(err);
                })
                .run();
        });
    }

    /**
     * Validate video format and aspect ratio (Instagram Reels: 9:16)
     */
    async validateVideoFormat(videoPath: string): Promise<{
        isValid: boolean;
        width?: number;
        height?: number;
        duration?: number;
        aspectRatio?: number;
    }> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    logger.error('Error probing video', { error: err.message });
                    reject(err);
                    return;
                }

                const videoStream = metadata.streams.find((s) => s.codec_type === 'video');

                if (!videoStream) {
                    resolve({ isValid: false });
                    return;
                }

                const width = videoStream.width || 0;
                const height = videoStream.height || 0;
                const duration = metadata.format.duration || 0;
                const aspectRatio = width / height;
                const targetAspectRatio = 9 / 16;

                // Allow some tolerance in aspect ratio (±0.05)
                const isValidAspectRatio = Math.abs(aspectRatio - targetAspectRatio) < 0.05;

                // Instagram Reels: 3-90 seconds
                const isValidDuration = duration >= 3 && duration <= 90;

                resolve({
                    isValid: isValidAspectRatio && isValidDuration,
                    width,
                    height,
                    duration,
                    aspectRatio,
                });
            });
        });
    }

    /**
     * Fit text to video width by wrapping and/or reducing font size
     */
    private fitTextToWidth(
        text: string,
        videoWidth: number,
        paddingX: number,
        maxFontSize: number,
        minFontSize: number = 24,
        maxLines: number = 3
    ): { lines: string[]; fontSize: number } {
        const usableWidth = videoWidth - (paddingX * 2);
        // Approximate character width ratio (most fonts are ~0.6x font size width)
        const charWidthRatio = 0.7;

        let fontSize = maxFontSize;

        while (fontSize >= minFontSize) {
            const avgCharWidth = fontSize * charWidthRatio;
            const charsPerLine = Math.floor(usableWidth / avgCharWidth);

            const lines = this.wrapText(text, charsPerLine);

            // Check if all lines fit and we're within max lines
            if (lines.length <= maxLines) {
                const allLinesFit = lines.every(
                    (line) => line.length * avgCharWidth <= usableWidth
                );
                if (allLinesFit) {
                    return { lines, fontSize };
                }
            }

            // Reduce font size and try again
            fontSize -= 4;
        }

        // Fallback: use minimum font size with max lines
        const avgCharWidth = minFontSize * charWidthRatio;
        const charsPerLine = Math.floor(usableWidth / avgCharWidth);
        const lines = this.wrapText(text, charsPerLine).slice(0, maxLines);

        return { lines, fontSize: minFontSize };
    }

    /**
     * Wrap text into lines at word boundaries
     */
    private wrapText(text: string, maxCharsPerLine: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;

            if (testLine.length <= maxCharsPerLine) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }
                // Handle words longer than max chars per line
                if (word.length > maxCharsPerLine) {
                    currentLine = word.substring(0, maxCharsPerLine);
                } else {
                    currentLine = word;
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
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
}
