import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { z } from 'zod';

const createHookSchema = z.object({
    text: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long'),
});

const updateHookSchema = z.object({
    enabled: z.boolean(),
});

export async function handleHooks(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized hooks request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin hooks request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();
    const url = new URL(request.url);

    try {
        if (request.method === 'GET') {
            const showAll = url.searchParams.get('all') === 'true';
            const hooks = await db.getAllHooks(!showAll);
            return Response.json({ success: true, hooks });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createHookSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const hook = await db.createHook(parsed.data.text);
            if (!hook) {
                return Response.json(
                    { success: false, error: 'A hook with this text already exists' },
                    { status: 409 }
                );
            }
            return Response.json({ success: true, hook }, { status: 201 });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling hooks request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process hooks request' },
            { status: 500 }
        );
    }
}

export async function handleHookById(request: Request, id: number): Promise<Response> {
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
            const parsed = updateHookSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const hook = await db.updateHookEnabled(id, parsed.data.enabled);
            if (!hook) {
                return Response.json(
                    { success: false, error: 'Hook not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true, hook });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling hook by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process hook request' },
            { status: 500 }
        );
    }
}
