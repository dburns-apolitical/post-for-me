import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { DatabaseService } from '../services/database.js';
import { z } from 'zod';

const createCaptionSchema = z.object({
    text: z.string().min(1, 'Caption text cannot be empty').max(2200, 'Caption text too long'),
});

const updateCaptionSchema = z.object({
    enabled: z.boolean(),
});

export async function handleCaptions(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized captions request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin captions request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    const db = new DatabaseService();
    const url = new URL(request.url);

    try {
        if (request.method === 'GET') {
            const showAll = url.searchParams.get('all') === 'true';
            const captions = await db.getAllCaptions(!showAll);
            return Response.json({ success: true, captions });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const parsed = createCaptionSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const caption = await db.createCaption(parsed.data.text);
            if (!caption) {
                return Response.json(
                    { success: false, error: 'A caption with this text already exists' },
                    { status: 409 }
                );
            }
            return Response.json({ success: true, caption }, { status: 201 });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling captions request', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process captions request' },
            { status: 500 }
        );
    }
}

export async function handleCaptionById(request: Request, id: number): Promise<Response> {
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
            const parsed = updateCaptionSchema.safeParse(body);
            if (!parsed.success) {
                return Response.json(
                    { success: false, error: parsed.error.errors[0].message },
                    { status: 400 }
                );
            }
            const caption = await db.updateCaptionEnabled(id, parsed.data.enabled);
            if (!caption) {
                return Response.json(
                    { success: false, error: 'Caption not found' },
                    { status: 404 }
                );
            }
            return Response.json({ success: true, caption });
        }

        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        logger.error('Error handling caption by ID request', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to process caption request' },
            { status: 500 }
        );
    }
}
