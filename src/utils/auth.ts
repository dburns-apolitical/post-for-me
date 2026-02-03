import { jwtVerify, createRemoteJWKSet } from 'jose';
import { neon } from '@neondatabase/serverless';
import { getConfig } from '../config/index.js';
import { logger } from './logger.js';

export interface AuthResult {
    authenticated: boolean;
    isAdmin: boolean;
    method?: 'password' | 'bearer';
    userId?: string;
    error?: string;
}

// Cache the JWKS to avoid fetching on every request
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(jwksUrl: string) {
    if (!jwksCache) {
        jwksCache = createRemoteJWKSet(new URL(jwksUrl));
    }
    return jwksCache;
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
                isAdmin: false,
                error: 'Dashboard authentication not configured',
            };
        }

        if (passwordHeader === config.dashboard.password) {
            // Password auth implies admin access (server-side secret)
            return {
                authenticated: true,
                isAdmin: true,
                method: 'password',
            };
        }

        return {
            authenticated: false,
            isAdmin: false,
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
                isAdmin: false,
                error: 'Missing token',
            };
        }

        // Validate JWT token
        const result = await validateBearerToken(token);
        if (result.valid && result.userId) {
            // Check if user has admin role in neon_auth.users
            const isAdmin = await checkUserIsAdmin(result.userId);
            return {
                authenticated: true,
                isAdmin,
                method: 'bearer',
                userId: result.userId,
            };
        }

        return {
            authenticated: false,
            isAdmin: false,
            error: result.error || 'Invalid or expired token',
        };
    }

    return {
        authenticated: false,
        isAdmin: false,
        error: 'No authentication provided. Use X-Dashboard-Password header or Authorization: Bearer <token>',
    };
}

interface TokenValidationResult {
    valid: boolean;
    userId?: string;
    error?: string;
}

/**
 * Validate a Bearer token (JWT) using Neon Auth JWKS
 * 
 * Cryptographically verifies the JWT signature using Neon's public keys.
 */
async function validateBearerToken(token: string): Promise<TokenValidationResult> {
    const config = getConfig();

    logger.debug('Validating bearer token', {
        tokenLength: token.length,
        tokenPreview: token.substring(0, 20) + '...',
    });

    // Get JWKS URL - use configured URL or derive from Neon Auth URL
    let jwksUrl = config.dashboard.neonJwksUrl;

    if (!jwksUrl && config.dashboard.neonAuthUrl) {
        // Derive JWKS URL from Neon Auth URL
        // e.g., https://ep-xxx.neonauth.eu-west-2.aws.neon.tech/neondb/auth 
        // -> https://ep-xxx.neonauth.eu-west-2.aws.neon.tech/.well-known/jwks.json
        try {
            const authUrl = new URL(config.dashboard.neonAuthUrl);
            jwksUrl = `${authUrl.origin}/.well-known/jwks.json`;
        } catch {
            logger.error('Invalid NEON_AUTH_URL format');
            return { valid: false, error: 'Invalid auth configuration' };
        }
    }

    if (!jwksUrl) {
        // Fallback to basic validation if no JWKS URL configured
        logger.warn('No JWKS URL configured, falling back to basic JWT validation');
        return validateTokenBasic(token);
    }

    try {
        logger.debug('Verifying JWT with JWKS', { jwksUrl });

        const jwks = getJWKS(jwksUrl);
        const { payload } = await jwtVerify(token, jwks);

        logger.debug('JWT verified successfully', {
            sub: payload.sub,
            exp: payload.exp,
            iat: payload.iat,
        });

        return { valid: true, userId: payload.sub };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Provide more specific error messages
        if (errorMessage.includes('expired')) {
            logger.warn('JWT has expired', { error: errorMessage });
            return { valid: false, error: 'Token has expired' };
        }

        if (errorMessage.includes('signature')) {
            logger.warn('JWT signature verification failed', { error: errorMessage });
            return { valid: false, error: 'Invalid token signature' };
        }

        logger.error('JWT verification failed', { error: errorMessage });
        return { valid: false, error: 'Token verification failed' };
    }
}

/**
 * Basic JWT validation without cryptographic verification
 * Used as fallback when JWKS is not configured
 */
function validateTokenBasic(token: string): TokenValidationResult {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            logger.debug('Token is not a valid JWT structure', { partsCount: parts.length });
            return { valid: false, error: 'Invalid token format' };
        }

        // Decode payload and check expiration
        const payload = JSON.parse(atob(parts[1]));

        logger.debug('JWT payload decoded (basic validation)', {
            hasExp: !!payload.exp,
            exp: payload.exp,
            currentTime: Math.floor(Date.now() / 1000),
        });

        // Check if token has expired
        if (payload.exp && payload.exp < Date.now() / 1000) {
            logger.warn('Token has expired', {
                exp: payload.exp,
                expDate: new Date(payload.exp * 1000).toISOString(),
                currentTime: new Date().toISOString(),
            });
            return { valid: false, error: 'Token has expired' };
        }

        logger.warn('JWT validated without cryptographic verification. Configure NEON_JWKS_URL for secure validation.');
        return { valid: true, userId: payload.sub };
    } catch (error) {
        logger.debug('Failed to decode JWT', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return { valid: false, error: 'Invalid token format' };
    }
}

/**
 * Check if user has admin role in the neon_auth.users table
 */
async function checkUserIsAdmin(userId: string): Promise<boolean> {
    const config = getConfig();

    try {
        const sql = neon(config.databaseUrl);
        const result = await sql`
            SELECT role FROM neon_auth.user WHERE id = ${userId}
        ` as { role: string | null }[];

        if (result.length === 0) {
            logger.warn('User not found in neon_auth.user', { userId });
            return false;
        }

        const isAdmin = result[0].role === 'admin';
        logger.debug('User admin check', { userId, role: result[0].role, isAdmin });
        return isAdmin;
    } catch (error) {
        logger.error('Failed to check user admin status', {
            userId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
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

/**
 * Create a forbidden response (authenticated but not authorized)
 */
export function forbiddenResponse(error: string): Response {
    return Response.json(
        {
            success: false,
            error: 'Forbidden',
            message: error,
        },
        { status: 403 }
    );
}
