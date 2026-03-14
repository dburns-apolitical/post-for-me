import { describe, test, expect } from 'bun:test';
import { maskToken, maskCredentials } from '../../src/utils/mask';

describe('maskToken', () => {
    test('should mask long tokens showing first 4 and last 4 chars', () => {
        expect(maskToken('abcdefghijklmnop')).toBe('abcd...mnop');
    });

    test('should return **** for short tokens', () => {
        expect(maskToken('short')).toBe('****');
    });

    test('should return **** for 8-char tokens', () => {
        expect(maskToken('12345678')).toBe('****');
    });

    test('should mask 9-char token', () => {
        expect(maskToken('123456789')).toBe('1234...6789');
    });
});

describe('maskCredentials', () => {
    test('should mask all string values in credentials object', () => {
        const creds = { ig_access_token: 'abcdefghijklmnop', ig_user_id: '1234567890' };
        const masked = maskCredentials(creds);

        expect(masked.ig_access_token).toBe('abcd...mnop');
        expect(masked.ig_user_id).toBe('1234...7890');
    });

    test('should leave non-string values unchanged', () => {
        const creds = { token: 'abcdefghijklmnop', count: 42 };
        const masked = maskCredentials(creds);

        expect(masked.token).toBe('abcd...mnop');
        expect(masked.count).toBe(42);
    });
});
