import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import type { AgentEvaluation } from '../types/index.js';

export async function handleEvaluations(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized evaluations request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin evaluations request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const config = getConfig();
        const sql = neon(config.databaseUrl);

        const url = new URL(request.url);
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;

        const evaluations = await sql`
            SELECT id, response, model, input_tokens, output_tokens, triggered_by, created_at
            FROM agent_evaluations
            ORDER BY created_at DESC
            LIMIT ${limit}
        ` as AgentEvaluation[];

        return Response.json({
            success: true,
            evaluations,
        });
    } catch (error) {
        logger.error('Error fetching evaluations', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch evaluations',
            },
            { status: 500 }
        );
    }
}
