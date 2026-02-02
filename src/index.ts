import { getConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { handlePostReel } from './routes/post-reel.js';
import { handleTestInstagram } from './routes/test-instagram.js';
import { DatabaseService } from './services/database.js';
import { ViewsSyncCronService } from './services/views-sync-cron.js';
import * as fs from 'fs';
import * as path from 'path';

const config = getConfig();
const db = new DatabaseService();
const viewsSyncCron = new ViewsSyncCronService();

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

  logger.info('Server initialization complete');
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop the views sync cron job
  viewsSyncCron.stop();

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

// Run startup and then start server
startup().then(() => {
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

      // Test Instagram credentials endpoint
      if (url.pathname === '/api/test-instagram' && request.method === 'GET') {
        return handleTestInstagram();
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
}).catch((err) => {
  logger.error('Failed to start server', {
    error: err instanceof Error ? err.message : 'Unknown error',
  });
  process.exit(1);
});
