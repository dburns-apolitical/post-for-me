import { logger } from '../utils/logger.js';
import { InstagramClientService } from '../services/instagram-client.js';

export async function handleTestInstagram(): Promise<Response> {
  try {
    const instagramClient = new InstagramClientService();
    const accountInfo = await instagramClient.getAccountInfo();

    logger.info('Instagram credentials test successful', {
      username: accountInfo.username,
    });

    return Response.json({
      success: true,
      account: accountInfo,
    });
  } catch (error) {
    logger.error('Instagram credentials test failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to verify Instagram credentials',
      },
      { status: 500 }
    );
  }
}
