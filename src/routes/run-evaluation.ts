import { logger } from '../utils/logger.js';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../utils/auth.js';
import { runEvaluation } from '../services/agent.js';

export async function handleRunEvaluation(request: Request): Promise<Response> {
    const authResult = await validateAuth(request);
    if (!authResult.authenticated) {
        logger.warn('Unauthorized run-evaluation request', { error: authResult.error });
        return unauthorizedResponse(authResult.error || 'Unauthorized');
    }
    if (!authResult.isAdmin) {
        logger.warn('Non-admin run-evaluation request', { userId: authResult.userId });
        return forbiddenResponse('Admin access required');
    }

    logger.info('Manual agent evaluation triggered', { method: authResult.method });

    try {
        const evaluation = await runEvaluation('manual');

        return Response.json({
            success: true,
            evaluation: {
                id: evaluation.id,
                response: evaluation.response,
                model: evaluation.model,
                input_tokens: evaluation.input_tokens,
                output_tokens: evaluation.output_tokens,
                triggered_by: evaluation.triggered_by,
                created_at: evaluation.created_at,
            },
        });
    } catch (error) {
        logger.error('Manual agent evaluation failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run evaluation',
            },
            { status: 500 }
        );
    }
}
