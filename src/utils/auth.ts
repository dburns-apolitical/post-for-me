import { getConfig } from '../config/index.js';
import { logger } from './logger.js';

export interface AuthResult {
    authenticated: boolean;
    method?: 'password' | 'bearer';
    error?: string;
}

/**
 * Validate request authentication using either password header or Bearer token
 * 
 * Supports two auth methods:
 * 1. Password auth: X-Dashboard-Password header matching DASHBOARD_PASSWORD env var
 * 2. Bearer token: Authorization header with Bearer token (for Neon Auth JWT integration)
 */
export async function validateAuth(request: Request): Promise<AuthResult> {
    const config = getConfig();

    // Check for password auth first (simplest method)
    const passwordHeader = request.headers.get('X-Dashboard-Password');
    if (passwordHeader) {
        if (!config.dashboard.password) {
            logger.warn('Dashboard password not configured');
            return {
                authenticated: false,
                error: 'Dashboard authentication not configured',
            };
        }

        if (passwordHeader === config.dashboard.password) {
            return {
                authenticated: true,
                method: 'password',
            };
        }

        return {
            authenticated: false,
            error: 'Invalid password',
        };
    }

    // Check for Bearer token auth
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);

        if (!token) {
            return {
                authenticated: false,
                error: 'Missing token',
            };
        }

        // Validate JWT token
        const isValid = await validateBearerToken(token);
        if (isValid) {
            return {
                authenticated: true,
                method: 'bearer',
            };
        }

        return {
            authenticated: false,
            error: 'Invalid or expired token',
        };
    }

    return {
        authenticated: false,
        error: 'No authentication provided. Use X-Dashboard-Password header or Authorization: Bearer <token>',
    };
}

/**
 * Validate a Bearer token (JWT)
 * 
 * If NEON_AUTH_URL is configured, validates against Neon Auth.
 * Otherwise, attempts basic JWT validation.
 */
async function validateBearerToken(token: string): Promise<boolean> {
    const config = getConfig();

    // If Neon Auth URL is configured, validate against it
    if (config.dashboard.neonAuthUrl) {
        try {
            const response = await fetch(`${config.dashboard.neonAuthUrl}/api/auth/session`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.ok) {
                const session = await response.json() as { user?: { id?: string } } | null;
                // Check if session has a valid user
                return !!session?.user?.id;
            }

            return false;
        } catch (error) {
            logger.error('Failed to validate token with Neon Auth', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return false;
        }
    }

    // Basic JWT structure validation (without cryptographic verification)
    // This is a fallback when Neon Auth URL is not configured
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return false;
        }

        // Decode payload and check expiration
        const payload = JSON.parse(atob(parts[1]));

        // Check if token has expired
        if (payload.exp && payload.exp < Date.now() / 1000) {
            logger.debug('Token has expired');
            return false;
        }

        // Token structure is valid (but not cryptographically verified)
        // For production use, configure NEON_AUTH_URL for proper validation
        logger.warn('JWT validated without cryptographic verification. Configure NEON_AUTH_URL for secure validation.');
        return true;
    } catch {
        return false;
    }
}

/**
 * Create an unauthorized response
 */
export function unauthorizedResponse(error: string): Response {
    return Response.json(
        {
            success: false,
            error: 'Unauthorized',
            message: error,
        },
        { status: 401 }
    );
}
