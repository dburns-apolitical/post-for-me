import { getConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { handlePostReel } from './routes/post-reel.js';

const config = getConfig();

const server = Bun.serve({
  port: config.port,
  async fetch(request) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Post reel endpoint
    if (url.pathname === '/api/post-reel' && request.method === 'POST') {
      return handlePostReel(request);
    }

    // 404 for unknown routes
    return Response.json(
      { error: 'Not found' },
      { status: 404 }
    );
  },
});

logger.info(`Server running on port ${server.port}`, {
  environment: config.nodeEnv,
  port: config.port,
});
