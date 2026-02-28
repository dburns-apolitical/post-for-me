import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { InstagramClientService } from '../services/instagram-client.js';
import { DatabaseService } from '../services/database.js';

export async function handleTestInstagram(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    try {
        const db = new DatabaseService();
        const url = new URL(request.url);
        const accountIdParam = url.searchParams.get('accountId');

        let accounts;
        if (accountIdParam) {
            const account = await db.getAccount(parseInt(accountIdParam, 10));
            accounts = account ? [account] : [];
        } else {
            accounts = await db.getAccounts();
        }

        const results = [];
        let allSuccess = true;

        for (const account of accounts) {
            try {
                const instagramClient = new InstagramClientService(account.ig_access_token, account.ig_user_id);
                const accountInfo = await instagramClient.getAccountInfo();
                results.push({
                    id: account.id,
                    name: account.name,
                    username: accountInfo.username,
                    account_type: accountInfo.account_type,
                    media_count: accountInfo.media_count,
                    success: true,
                });
            } catch (error) {
                allSuccess = false;
                results.push({
                    id: account.id,
                    name: account.name,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        return Response.json({ success: allSuccess, accounts: results });
    } catch (error) {
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to verify Instagram credentials' },
            { status: 500 }
        );
    }
}
