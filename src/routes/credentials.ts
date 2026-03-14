import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { maskCredentials } from '../utils/mask.js';
import { z } from 'zod';
import type { Platform, InstagramDirectCredentials, UploadPostCredentials } from '../types/index.js';

const platformValues: [Platform, ...Platform[]] = ['instagram_direct', 'upload_post'];

const instagramDirectCredentialsSchema = z.object({
    ig_access_token: z.string().min(1, 'Instagram access token is required'),
    ig_user_id: z.string().min(1, 'Instagram user ID is required'),
});

const uploadPostCredentialsSchema = z.object({
    api_key: z.string().min(1, 'Upload-Post API key is required'),
    user: z.string().min(1, 'Upload-Post user is required'),
});

const createCredentialSchema = z.object({
    platform: z.enum(platformValues),
    credentials: z.record(z.unknown()),
}).refine(
    (data) => {
        if (data.platform === 'instagram_direct') {
            return instagramDirectCredentialsSchema.safeParse(data.credentials).success;
        }
        if (data.platform === 'upload_post') {
            return uploadPostCredentialsSchema.safeParse(data.credentials).success;
        }
        return false;
    },
    { message: 'Invalid credentials for the specified platform' }
);

const updateCredentialSchema = z.object({
    credentials: z.record(z.unknown()),
});

export async function handleAccountCredentials(request: Request, accountId: number): Promise<Response> {
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

        if (request.method === 'GET') {
            const credentials = await db.getCredentialsByAccountId(accountId);
            return Response.json({
                success: true,
                credentials: credentials.map(c => ({
                    ...c,
                    credentials: maskCredentials(c.credentials as unknown as Record<string, unknown>),
                })),
            });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createCredentialSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }

            const credential = await db.createCredential(
                accountId,
                parsed.data.platform,
                parsed.data.credentials as unknown as (InstagramDirectCredentials | UploadPostCredentials)
            );
            return Response.json({
                success: true,
                credential: {
                    ...credential,
                    credentials: maskCredentials(credential.credentials as unknown as Record<string, unknown>),
                },
            }, { status: 201 });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling account credentials request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process credentials request' },
            { status: 500 }
        );
    }
}

export async function handleCredentialById(request: Request, credentialId: number): Promise<Response> {
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
            const parsed = updateCredentialSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
                    { status: 400 }
                );
            }

            const existing = await db.getCredential(credentialId);
            if (!existing) {
                return Response.json(
                    { success: false, error: 'Credential not found' },
                    { status: 404 }
                );
            }

            // Validate credentials shape based on platform
            if (existing.platform === 'instagram_direct') {
                const platformValidation = instagramDirectCredentialsSchema.safeParse(parsed.data.credentials);
                if (!platformValidation.success) {
                    return Response.json(
                        { success: false, error: platformValidation.error.errors[0].message },
                        { status: 400 }
                    );
                }
            } else if (existing.platform === 'upload_post') {
                const platformValidation = uploadPostCredentialsSchema.safeParse(parsed.data.credentials);
                if (!platformValidation.success) {
                    return Response.json(
                        { success: false, error: platformValidation.error.errors[0].message },
                        { status: 400 }
                    );
                }
            }

            const credential = await db.updateCredential(credentialId, parsed.data.credentials as unknown as (InstagramDirectCredentials | UploadPostCredentials));
            if (!credential) {
                return Response.json(
                    { success: false, error: 'Credential not found' },
                    { status: 404 }
                );
            }
            return Response.json({
                success: true,
                credential: {
                    ...credential,
                    credentials: maskCredentials(credential.credentials as unknown as Record<string, unknown>),
                },
            });
        }

        if (request.method === 'DELETE') {
            const deleted = await db.deleteCredential(credentialId);
            if (!deleted) {
                return Response.json(
                    { success: false, error: 'Credential not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling credential by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: 'Failed to process credential request' },
            { status: 500 }
        );
    }
}
