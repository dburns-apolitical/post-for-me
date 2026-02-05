import { describe, test, expect } from 'bun:test';
import { VideoEditorService } from '../../src/services/video-editor';
import * as fs from 'fs';

describe('VideoEditorService', () => {
  describe('cleanupTempFile', () => {
    test('should skip cleanup in development mode', () => {
      const service = new VideoEditorService();
      const testFile = './tmp/test-editor-cleanup-dev.txt';

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
        const service = new VideoEditorService();
        const testFile = './tmp/test-editor-cleanup-prod.txt';

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
      const service = new VideoEditorService();

      // Should not throw
      expect(() => {
        service.cleanupTempFile('./tmp/nonexistent-editor-file.txt');
      }).not.toThrow();
    });
  });

  // Note: Full video processing tests require ffmpeg and sample video files
  // These will be tested in integration tests with actual video files
});
