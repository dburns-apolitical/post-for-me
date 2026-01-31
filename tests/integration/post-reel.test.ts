import { describe, test, expect } from 'bun:test';

const BASE_URL = 'http://localhost:3000';

describe('POST /api/post-reel', () => {
  test('should return 400 for invalid request body', async () => {
    const response = await fetch(`${BASE_URL}/api/post-reel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation failed');
  });

  test('should return 200 for valid request', async () => {
    const response = await fetch(`${BASE_URL}/api/post-reel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        caption: 'Test caption',
        hookText: 'Hook text',
        hashtags: ['test', 'reel'],
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.postId).toBeDefined();
    expect(data.videoUsed).toBeDefined();
  });

  test('should reject empty caption', async () => {
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
  });

  test('should reject invalid hashtags', async () => {
    const response = await fetch(`${BASE_URL}/api/post-reel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        caption: 'Caption',
        hookText: 'Hook',
        hashtags: ['test', 'invalid-tag!'],
      }),
    });

    expect(response.status).toBe(400);
  });
});
