import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AuthResult } from '../../src/utils/auth';

describe('AuthResult type', () => {
    test('should have userName property', () => {
        const result: AuthResult = {
            authenticated: true,
            isAdmin: true,
            method: 'bearer',
            userId: '70668aac-f6e0-4b40-b1f7-b7b4e0a72613',
            userName: 'Molars',
        };

        expect(result.userName).toBe('Molars');
    });

    test('should allow userName to be undefined', () => {
        const result: AuthResult = {
            authenticated: true,
            isAdmin: true,
            method: 'password',
        };

        expect(result.userName).toBeUndefined();
    });
});

// Mock neon before importing auth
const mockSql = mock(() => Promise.resolve([{ role: 'admin' }]));
mock.module('@neondatabase/serverless', () => ({
    neon: () => mockSql,
}));

// Mock jose
mock.module('jose', () => ({
    jwtVerify: mock(() => Promise.resolve({
        payload: {
            sub: '70668aac-f6e0-4b40-b1f7-b7b4e0a72613',
            name: 'Molars',
            exp: Math.floor(Date.now() / 1000) + 3600,
        },
    })),
    createRemoteJWKSet: mock(() => ({})),
}));

import { validateAuth } from '../../src/utils/auth';

describe('validateAuth', () => {
    test('should return userName from JWT payload for bearer auth', async () => {
        const request = new Request('http://localhost/api/test', {
            headers: {
                'Authorization': 'Bearer valid-jwt-token',
            },
        });

        const result = await validateAuth(request);

        expect(result.authenticated).toBe(true);
        expect(result.method).toBe('bearer');
        expect(result.userId).toBe('70668aac-f6e0-4b40-b1f7-b7b4e0a72613');
        expect(result.userName).toBe('Molars');
    });

    test('should not have userName for password auth', async () => {
        const request = new Request('http://localhost/api/test', {
            headers: {
                'X-Dashboard-Password': process.env.DASHBOARD_PASSWORD || 'test-password',
            },
        });

        const result = await validateAuth(request);

        expect(result.authenticated).toBe(true);
        expect(result.method).toBe('password');
        expect(result.userName).toBeUndefined();
    });
});
