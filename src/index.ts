import { getConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { handlePostReel } from './routes/post-reel.js';
import { handlePostStatus } from './routes/post-status.js';
import { handleTestInstagram } from './routes/test-instagram.js';
import { handleStats } from './routes/stats.js';
import { handleViewsHistory } from './routes/views-history.js';
import { handleImpressionsHistory } from './routes/impressions-history.js';
import { handleSyncImpressions } from './routes/sync-impressions.js';
import { handleRecentPosts } from './routes/recent-posts.js';
import { handleBackfillDailyViews } from './routes/backfill-daily-views.js';
import { handleCaptions, handleCaptionById } from './routes/captions.js';
import { handleHooks, handleHookById } from './routes/hooks.js';
import { handleVideos } from './routes/videos.js';
import { handleSyncViews } from './routes/sync-views.js';
import { handleRunEvaluation } from './routes/run-evaluation.js';
import { handleEvaluations } from './routes/evaluations.js';
import { handleAccounts, handleAccountById, handleAccountContent } from './routes/accounts.js';
import { handleAccountCredentials, handleCredentialById } from './routes/credentials.js';
import { DatabaseService } from './services/database.js';
import { ViewsSyncCronService } from './services/views-sync-cron.js';
import { AgentEvalCronService } from './services/agent-eval-cron.js';
import { ImpressionsSyncCronService } from './services/impressions-sync-cron.js';
import * as fs from 'fs';
import * as path from 'path';

const config = getConfig();
const db = new DatabaseService();
const viewsSyncCron = new ViewsSyncCronService();
const impressionsSyncCron = new ImpressionsSyncCronService();
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

  // Start the impressions sync cron job
  impressionsSyncCron.start();

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

  // Stop the impressions sync cron job
  impressionsSyncCron.stop();

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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

      // Views history endpoint (requires authentication)
      if (url.pathname === '/api/stats/views-history' && request.method === 'GET') {
        return withCors(await handleViewsHistory(request), request);
      }

      // Impressions history endpoint (requires authentication)
      if (url.pathname === '/api/stats/impressions-history' && request.method === 'GET') {
        return withCors(await handleImpressionsHistory(request), request);
      }

      // Recent posts endpoint (requires authentication)
      if (url.pathname === '/api/stats/recent-posts' && request.method === 'GET') {
        return withCors(await handleRecentPosts(request), request);
      }

      // Captions endpoint (requires authentication)
      if (url.pathname === '/api/captions' && (request.method === 'GET' || request.method === 'POST')) {
        return withCors(await handleCaptions(request), request);
      }

      // Caption by ID endpoint (PATCH for enable/disable)
      const captionMatch = url.pathname.match(/^\/api\/captions\/(\d+)$/);
      if (captionMatch && request.method === 'PATCH') {
        return withCors(await handleCaptionById(request, parseInt(captionMatch[1], 10)), request);
      }

      // Hooks endpoint (requires authentication)
      if (url.pathname === '/api/hooks' && (request.method === 'GET' || request.method === 'POST')) {
        return withCors(await handleHooks(request), request);
      }

      // Hook by ID endpoint (PATCH for enable/disable)
      const hookMatch = url.pathname.match(/^\/api\/hooks\/(\d+)$/);
      if (hookMatch && request.method === 'PATCH') {
        return withCors(await handleHookById(request, parseInt(hookMatch[1], 10)), request);
      }

      // List videos endpoint (requires authentication)
      if (url.pathname === '/api/videos' && request.method === 'GET') {
        return withCors(await handleVideos(request), request);
      }

      // Manual views sync endpoint (requires admin authentication)
      if (url.pathname === '/api/sync-views' && request.method === 'POST') {
        return withCors(await handleSyncViews(request, viewsSyncCron), request);
      }

      // Manual impressions sync endpoint (requires admin authentication)
      if (url.pathname === '/api/sync-impressions' && request.method === 'POST') {
        return withCors(await handleSyncImpressions(request, impressionsSyncCron), request);
      }

      // Backfill daily views (one-time admin endpoint)
      if (url.pathname === '/api/backfill-daily-views' && request.method === 'POST') {
        return withCors(await handleBackfillDailyViews(request), request);
      }

      // Agent evaluation endpoints (requires admin authentication)
      if (url.pathname === '/api/evaluations' && request.method === 'GET') {
        return withCors(await handleEvaluations(request), request);
      }

      if (url.pathname === '/api/run-evaluation' && request.method === 'POST') {
        return withCors(await handleRunEvaluation(request), request);
      }

      // Accounts CRUD
      if (url.pathname === '/api/accounts' && (request.method === 'GET' || request.method === 'POST')) {
        return withCors(await handleAccounts(request), request);
      }

      const accountByIdMatch = url.pathname.match(/^\/api\/accounts\/(\d+)$/);
      if (accountByIdMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
        return withCors(await handleAccountById(request, parseInt(accountByIdMatch[1], 10)), request);
      }

      // Account content assignment
      const accountContentMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/(captions|hooks|hashtag-combinations)$/);
      if (accountContentMatch && request.method === 'POST') {
        return withCors(await handleAccountContent(request, parseInt(accountContentMatch[1], 10), accountContentMatch[2]), request);
      }

      const accountContentItemMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/(captions|hooks|hashtag-combinations)\/(\d+)$/);
      if (accountContentItemMatch && request.method === 'DELETE') {
        return withCors(await handleAccountContent(
          request,
          parseInt(accountContentItemMatch[1], 10),
          accountContentItemMatch[2],
          parseInt(accountContentItemMatch[3], 10)
        ), request);
      }

      // Account credentials
      const accountCredentialsMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/credentials$/);
      if (accountCredentialsMatch && (request.method === 'GET' || request.method === 'POST')) {
        return withCors(await handleAccountCredentials(request, parseInt(accountCredentialsMatch[1], 10)), request);
      }

      // Credential by ID
      const credentialByIdMatch = url.pathname.match(/^\/api\/credentials\/(\d+)$/);
      if (credentialByIdMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
        return withCors(await handleCredentialById(request, parseInt(credentialByIdMatch[1], 10)), request);
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
