import { getConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { handlePostReel } from './routes/post-reel.js';
import { handlePostStatus } from './routes/post-status.js';
import { handleTestInstagram } from './routes/test-instagram.js';
import { handleStats } from './routes/stats.js';
import { handleCaptions } from './routes/captions.js';
import { handleHooks } from './routes/hooks.js';
import { handleVideos } from './routes/videos.js';
import { handleSyncViews } from './routes/sync-views.js';
import { handleRunEvaluation } from './routes/run-evaluation.js';
import { DatabaseService } from './services/database.js';
import { ViewsSyncCronService } from './services/views-sync-cron.js';
import { AgentEvalCronService } from './services/agent-eval-cron.js';
import * as fs from 'fs';
import * as path from 'path';

const config = getConfig();
const db = new DatabaseService();
const viewsSyncCron = new ViewsSyncCronService();
const agentEvalCron = new AgentEvalCronService();

/**
 * Clear all files in the tmp directory
 */
function clearTmpDirectory(): void {
  const tmpDir = config.tempDir;

  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
      logger.debug('Created tmp directory', { tmpDir });
      return;
    }

    const files = fs.readdirSync(tmpDir);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(tmpDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (err) {
        logger.warn('Failed to delete tmp file', {
          filePath,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }

    if (deletedCount > 0) {
      logger.info('Cleared tmp directory', { deletedCount, tmpDir });
    }
  } catch (err) {
    logger.error('Failed to clear tmp directory', {
      tmpDir,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}

/**
 * Startup initialization
 */
async function startup(): Promise<void> {
  logger.info('Starting server initialization...');

  // Clear tmp directory (catches orphaned files from hard crashes)
  clearTmpDirectory();

  // Initialize database schema
  try {
    await db.initializeSchema();
  } catch (err) {
    logger.error('Failed to initialize database schema', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    throw err;
  }

  // Mark stale pending posts as failed (from previous crashes)
  try {
    const markedCount = await db.markPendingPostsAsFailed();
    if (markedCount > 0) {
      logger.info('Marked stale pending posts as failed on startup', { count: markedCount });
    }
  } catch (err) {
    logger.error('Failed to mark pending posts as failed', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    // Don't throw - continue starting the server
  }

  // Start the views sync cron job
  viewsSyncCron.start();

  // Start the weekly agent evaluation cron job
  agentEvalCron.start();

  logger.info('Server initialization complete');
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop the views sync cron job
  viewsSyncCron.stop();

  // Stop the agent evaluation cron job
  agentEvalCron.stop();

  // Mark any in-progress posts as failed
  try {
    const markedCount = await db.markPendingPostsAsFailed();
    if (markedCount > 0) {
      logger.info('Marked in-progress posts as failed during shutdown', { count: markedCount });
    }
  } catch (err) {
    logger.error('Failed to mark pending posts as failed during shutdown', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  // Clear tmp directory
  clearTmpDirectory();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// CORS configuration
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://molars-admin-dashboard.netlify.app',
  'https://admin.molarsuk.com',
];

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dashboard-Password',
    'Access-Control-Max-Age': '86400',
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function withCors(response: Response, request: Request): Response {
  const corsHeaders = getCorsHeaders(request);
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// Run startup and then start server
startup().then(() => {
  const server = Bun.serve({
    port: config.port,
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url);

      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(request),
        });
      }

      // Health check endpoint
      if (url.pathname === '/health' && request.method === 'GET') {
        return withCors(Response.json({ status: 'ok', timestamp: new Date().toISOString() }), request);
      }

      // Post reel endpoint
      if (url.pathname === '/api/post-reel' && request.method === 'POST') {
        return withCors(await handlePostReel(request), request);
      }

      // Post status endpoint
      if (url.pathname === '/api/post-status' && request.method === 'GET') {
        return withCors(await handlePostStatus(request), request);
      }

      // Test Instagram credentials endpoint
      if (url.pathname === '/api/test-instagram' && request.method === 'GET') {
        return withCors(await handleTestInstagram(request), request);
      }

      // Dashboard stats endpoint (requires authentication)
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        return withCors(await handleStats(request), request);
      }

      // List captions endpoint (requires authentication)
      if (url.pathname === '/api/captions' && request.method === 'GET') {
        return withCors(await handleCaptions(request), request);
      }

      // List hooks endpoint (requires authentication)
      if (url.pathname === '/api/hooks' && request.method === 'GET') {
        return withCors(await handleHooks(request), request);
      }

      // List videos endpoint (requires authentication)
      if (url.pathname === '/api/videos' && request.method === 'GET') {
        return withCors(await handleVideos(request), request);
      }

      // Manual views sync endpoint (requires admin authentication)
      if (url.pathname === '/api/sync-views' && request.method === 'POST') {
        return withCors(await handleSyncViews(request, viewsSyncCron), request);
      }

      // Agent evaluation endpoint (requires admin authentication)
      if (url.pathname === '/api/run-evaluation' && request.method === 'POST') {
        return withCors(await handleRunEvaluation(request), request);
      }

      // 404 for unknown routes
      return withCors(Response.json(
        { error: 'Not found' },
        { status: 404 }
      ), request);
    },
  });

  logger.info(`Server running on port ${server.port}`, {
    environment: config.nodeEnv,
    port: config.port,
  });
}).catch((err) => {
  logger.error('Failed to start server', {
    error: err instanceof Error ? err.message : 'Unknown error',
  });
  process.exit(1);
});
