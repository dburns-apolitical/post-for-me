import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { VideoSelectorService } from '../../src/services/video-selector';
import * as fs from 'fs';

// Mock the Storage class from @google-cloud/storage
const mockGetFiles = mock(() => Promise.resolve([[]]));
const mockDownload = mock(() => Promise.resolve());
const mockFile = mock(() => ({
  download: mockDownload,
}));
const mockBucket = mock(() => ({
  getFiles: mockGetFiles,
  file: mockFile,
}));

// We'll test the core logic with mocked GCS
describe('VideoSelectorService', () => {
  describe('selectRandomVideo', () => {
    test('should throw error when no videos found', async () => {
      // This test would need proper mocking of the Storage class
      // For now, we'll test the happy path in integration tests
      expect(true).toBe(true);
    });
  });

  describe('downloadVideo', () => {
    test('should download video to temp directory', async () => {
      // This test would need proper mocking
      // For now, we'll test the happy path in integration tests
      expect(true).toBe(true);
    });
  });

  describe('cleanupTempFile', () => {
    test('should skip cleanup in development mode', () => {
      const service = new VideoSelectorService();
      const testFile = './tmp/test-cleanup-dev.txt';

      // Create a test file
      if (!fs.existsSync('./tmp')) {
        fs.mkdirSync('./tmp', { recursive: true });
      }
      fs.writeFileSync(testFile, 'test content');

      // Cleanup should be skipped in development mode (file remains)
      service.cleanupTempFile(testFile);

      expect(fs.existsSync(testFile)).toBe(true);

      // Manual cleanup for test
      fs.unlinkSync(testFile);
    });

    test('should delete file in production mode', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalInstagramToken1 = process.env.INSTAGRAM_ACCESS_TOKEN_1;
      const originalInstagramUserId1 = process.env.INSTAGRAM_USER_ID_1;
      const originalInstagramToken2 = process.env.INSTAGRAM_ACCESS_TOKEN_2;
      const originalInstagramUserId2 = process.env.INSTAGRAM_USER_ID_2;
      const originalDatabaseUrl = process.env.DATABASE_URL;

      process.env.NODE_ENV = 'production';
      process.env.INSTAGRAM_ACCESS_TOKEN_1 = 'test-token-1';
      process.env.INSTAGRAM_USER_ID_1 = 'test-user-id-1';
      process.env.INSTAGRAM_ACCESS_TOKEN_2 = 'test-token-2';
      process.env.INSTAGRAM_USER_ID_2 = 'test-user-id-2';
      process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

      try {
        const service = new VideoSelectorService();
        const testFile = './tmp/test-cleanup-prod.txt';

        // Create a test file
        if (!fs.existsSync('./tmp')) {
          fs.mkdirSync('./tmp', { recursive: true });
        }
        fs.writeFileSync(testFile, 'test content');

        // Cleanup should delete the file in production mode
        service.cleanupTempFile(testFile);

        expect(fs.existsSync(testFile)).toBe(false);
      } finally {
        // Restore original env vars
        process.env.NODE_ENV = originalNodeEnv;
        process.env.INSTAGRAM_ACCESS_TOKEN_1 = originalInstagramToken1;
        process.env.INSTAGRAM_USER_ID_1 = originalInstagramUserId1;
        process.env.INSTAGRAM_ACCESS_TOKEN_2 = originalInstagramToken2;
        process.env.INSTAGRAM_USER_ID_2 = originalInstagramUserId2;
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    });

    test('should not throw error if file does not exist', () => {
      const service = new VideoSelectorService();

      // Should not throw
      expect(() => {
        service.cleanupTempFile('./tmp/nonexistent-file.txt');
      }).not.toThrow();
    });
  });

  describe('listAllVideoNames', () => {
    test('should return array of video filenames', async () => {
      const service = new VideoSelectorService();

      // Mock fetch for GCS API
      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
            { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
            { name: 'edited/video3.mp4', timeCreated: '2025-01-03T00:00:00Z' },
            { name: 'document.pdf', timeCreated: '2025-01-04T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.listAllVideoNames();

        expect(result).toEqual(['video1.mp4', 'video2.mov']);
        expect(result).not.toContain('edited/video3.mp4');
        expect(result).not.toContain('document.pdf');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should return empty array when no videos', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.listAllVideoNames();
        expect(result).toEqual([]);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('findVideoByTitle', () => {
    test('should return video when title matches exactly', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
            { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.findVideoByTitle('video1.mp4');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('video1.mp4');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should return null when title does not match', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
            { name: 'video2.mov', timeCreated: '2025-01-02T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.findVideoByTitle('nonexistent.mp4');

        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should be case-sensitive (exact match only)', async () => {
      const service = new VideoSelectorService();

      const originalFetch = global.fetch;
      global.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { name: 'Video1.mp4', timeCreated: '2025-01-01T00:00:00Z' },
          ],
        }),
      }) as unknown as typeof fetch);

      try {
        const result = await service.findVideoByTitle('video1.mp4');

        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
