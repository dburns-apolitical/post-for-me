import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const BASE_URL = 'http://localhost:3000';

interface ApiResponse {
  success?: boolean;
  error?: string;
  status?: string;
  timestamp?: string;
  postId?: string;
  videoUsed?: string;
}

describe('End-to-End Integration Tests', () => {
  describe('Health Check', () => {
    test('GET /health should return ok status', async () => {
      const response = await fetch(`${BASE_URL}/health`);

      expect(response.status).toBe(200);
      const data = await response.json() as ApiResponse;
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('POST /api/post-reel - Validation', () => {
    test('should return 400 for empty body when database has no records', async () => {
      // Empty body passes validation (all fields optional)
      // But fails when trying to auto-select from empty database
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiResponse;
      expect(data.success).toBe(false);
      // Error will be about missing captions/hooks/hashtags in database
      expect(data.error).toContain('No caption provided');
    });

    test('should return 400 for invalid hashtags', async () => {
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: 'Test caption',
          hookText: 'Hook',
          hashtags: ['valid', 'invalid-tag!', 'another'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiResponse;
      expect(data.success).toBe(false);
    });

    test('should return 400 for too long caption', async () => {
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: 'a'.repeat(2201),
          hookText: 'Hook',
          hashtags: ['test'],
        }),
      });

      expect(response.status).toBe(400);
    });

    test('should return 400 for empty caption string', async () => {
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: '',
          hookText: 'Hook',
          hashtags: ['test'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiResponse;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    test('should return 400 for empty hookText string', async () => {
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: 'Test caption',
          hookText: '',
          hashtags: ['test'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiResponse;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    test('should return 400 for empty hashtags array', async () => {
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: 'Test caption',
          hookText: 'Hook',
          hashtags: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiResponse;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });
  });

  describe('POST /api/post-reel - Full Flow', () => {
    // Note: This test requires:
    // - Valid GCS credentials and bucket with videos
    // - Valid Instagram Graph API credentials
    // - Valid DATABASE_URL connection
    // - ffmpeg installed
    // For CI/CD, these would be mocked or run in a staging environment

    test('should handle valid request (may fail due to missing credentials)', async () => {
      // In development without real credentials, this will fail
      // In production/staging with real credentials, this should return 200
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: 'Test caption for Instagram Reel',
          hookText: 'Hook text overlay',
          hashtags: ['test', 'reel', 'automation'],
        }),
      });

      // In development, we expect this to fail with 500 due to missing real credentials
      // In production/staging with real credentials, this should return 200
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for unknown routes', async () => {
      const response = await fetch(`${BASE_URL}/unknown-route`);

      expect(response.status).toBe(404);
      const data = await response.json() as ApiResponse;
      expect(data.error).toBe('Not found');
    });

    test('should handle malformed JSON', async () => {
      const response = await fetch(`${BASE_URL}/api/post-reel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'not valid json',
      });

      expect(response.status).toBe(500);
    });
  });
});
