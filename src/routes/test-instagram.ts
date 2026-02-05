import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { InstagramClientService } from '../services/instagram-client.js';
import { DatabaseService } from '../services/database.js';

export async function handleTestInstagram(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized test-instagram request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin test-instagram request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    try {
        const instagramClient = new InstagramClientService();
        const db = new DatabaseService();
        const accounts = await db.getAccounts();

        const results = [];
        let allSuccess = true;

        for (const account of accounts) {
            try {
                const accountInfo = await instagramClient.getAccountInfo(account.id);
                logger.info('Instagram credentials test successful', {
                    accountId: account.id,
                    accountName: account.name,
                    username: accountInfo.username,
                });
                results.push({
                    id: account.id,
                    name: account.name,
                    username: accountInfo.username,
                    account_type: accountInfo.account_type,
                    media_count: accountInfo.media_count,
                    success: true,
                });
            } catch (error) {
                logger.error('Instagram credentials test failed for account', {
                    accountId: account.id,
                    accountName: account.name,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                allSuccess = false;
                results.push({
                    id: account.id,
                    name: account.name,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        return Response.json({
            success: allSuccess,
            accounts: results,
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
