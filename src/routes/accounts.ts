import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { maskToken, maskCredentials } from '../utils/mask.js';
import { z } from 'zod';

const createAccountSchema = z.object({
    name: z.string().min(1, 'Name cannot be empty').max(200, 'Name too long'),
    gcs_bucket_name: z.string().min(1, 'GCS bucket name is required'),
});

const updateAccountSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    gcs_bucket_name: z.string().min(1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

const assignContentSchema = z.object({
    captionIds: z.array(z.number().int().min(1)).optional(),
    hookIds: z.array(z.number().int().min(1)).optional(),
    hashtagCombinationIds: z.array(z.number().int().min(1)).optional(),
});

export async function handleAccounts(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        if (request.method === 'GET') {
            const accounts = await db.getAccounts();
            const accountsWithCreds = await Promise.all(
                accounts.map(async (a) => {
                    const credentials = await db.getCredentialsByAccountId(a.id);
                    return {
                        ...a,
                        ig_access_token: maskToken(a.ig_access_token),
                        credentials: credentials.map(c => ({
                            ...c,
                            credentials: maskCredentials(c.credentials as unknown as Record<string, unknown>),
                        })),
                    };
                })
            );
            return Response.json({
                success: true,
                accounts: accountsWithCreds,
            });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createAccountSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            try {
                const account = await db.createAccount(
                    parsed.data.name,
                    '',
                    '',
                    parsed.data.gcs_bucket_name
                );
                return Response.json({
                    success: true,
                    account: { ...account, ig_access_token: maskToken(account.ig_access_token), credentials: [] },
                }, { status: 201 });
            } catch (error: any) {
                if (error?.code === '23505' || error?.message?.includes('unique')) {
                    return Response.json(
                        { success: false, error: 'An account with this name already exists' },
                        { status: 409 }
                    );
                }
                throw error;
            }
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling accounts request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process accounts request' },
            { status: 500 }
        );
    }
}

export async function handleAccountById(request: Request, id: number): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        if (request.method === 'PATCH') {
            const body = await request.json();
            const parsed = updateAccountSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
                    { status: 400 }
                );
            }
            const account = await db.updateAccount(id, parsed.data);
            if (!account) {
                return Response.json(
                    { success: false, error: 'Account not found' },
                    { status: 404 }
                );
            }
            const credentials = await db.getCredentialsByAccountId(id);
            return Response.json({
                success: true,
                account: {
                    ...account,
                    ig_access_token: maskToken(account.ig_access_token),
                    credentials: credentials.map(c => ({
                        ...c,
                        credentials: maskCredentials(c.credentials as unknown as Record<string, unknown>),
                    })),
                },
            });
        }

        if (request.method === 'DELETE') {
            const result = await db.deleteAccount(id);
            if (result.error) {
                return Response.json(
                    { success: false, error: result.error },
                    { status: 409 }
                );
            }
            if (!result.deleted) {
                return Response.json(
                    { success: false, error: 'Account not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling account by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process account request' },
            { status: 500 }
        );
    }
}

export async function handleAccountContent(request: Request, accountId: number, contentType: string, contentId?: number): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();

    try {
        const account = await db.getAccount(accountId);
        if (!account) {
            return Response.json(
                { success: false, error: 'Account not found' },
                { status: 404 }
            );
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = assignContentSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }

            if (contentType === 'captions' && parsed.data.captionIds) {
                await db.assignCaptionsToAccount(accountId, parsed.data.captionIds);
            } else if (contentType === 'hooks' && parsed.data.hookIds) {
                await db.assignHooksToAccount(accountId, parsed.data.hookIds);
            } else if (contentType === 'hashtag-combinations' && parsed.data.hashtagCombinationIds) {
                await db.assignHashtagCombinationsToAccount(accountId, parsed.data.hashtagCombinationIds);
            } else {
                return Response.json(
                    { success: false, error: `Missing ${contentType} IDs in request body` },
                    { status: 400 }
                );
            }

            return Response.json({ success: true });
        }

        if (request.method === 'DELETE' && contentId !== undefined) {
            let removed = false;
            if (contentType === 'captions') {
                removed = await db.removeCaptionFromAccount(accountId, contentId);
            } else if (contentType === 'hooks') {
                removed = await db.removeHookFromAccount(accountId, contentId);
            } else if (contentType === 'hashtag-combinations') {
                removed = await db.removeHashtagCombinationFromAccount(accountId, contentId);
            }

            if (!removed) {
                return Response.json(
                    { success: false, error: 'Assignment not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling account content request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process account content request' },
            { status: 500 }
        );
    }
}
