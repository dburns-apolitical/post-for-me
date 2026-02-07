import { describe, test, expect } from 'bun:test';
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
