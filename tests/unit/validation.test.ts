import { describe, test, expect } from 'bun:test';
import { validatePostReelRequest } from '../../src/utils/validation';

describe('Validation', () => {
    describe('validatePostReelRequest', () => {
        test('should pass with valid input', () => {
            const input = {
                caption: 'This is a test caption',
                hookText: 'Hook text here',
                hashtags: ['test', 'reel', 'content'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.caption).toBe(input.caption);
                expect(result.data.hookText).toBe(input.hookText);
                expect(result.data.hashtags).toEqual(input.hashtags);
            }
        });

        test('should fail when caption is empty', () => {
            const input = {
                caption: '',
                hookText: 'Hook text',
                hashtags: ['test'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail when caption is too long', () => {
            const input = {
                caption: 'a'.repeat(2201),
                hookText: 'Hook text',
                hashtags: ['test'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail when hookText is empty', () => {
            const input = {
                caption: 'Caption',
                hookText: '',
                hashtags: ['test'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail when hookText is too long', () => {
            const input = {
                caption: 'Caption',
                hookText: 'a'.repeat(501),
                hashtags: ['test'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should pass when hookText is at max length', () => {
            const input = {
                caption: 'Caption',
                hookText: 'a'.repeat(500),
                hashtags: ['test'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
        });

        test('should fail when hashtags array is empty', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: [],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail when hashtag has invalid characters', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test', 'invalid-hashtag!'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail when too many hashtags', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: Array.from({ length: 31 }, (_, i) => `tag${i}`),
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should pass when optional fields are missing', () => {
            // All fields are now optional - validation passes, auto-selection happens in route
            const input = {
                caption: 'Caption',
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
        });

        test('should pass with empty request body', () => {
            // All fields are optional - validation passes with empty object
            const input = {};

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
        });

        test('should pass with valid accountId', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test'],
                accountId: 1,
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.accountId).toBe(1);
            }
        });

        test('should pass with accountId 2', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test'],
                accountId: 2,
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.accountId).toBe(2);
            }
        });

        test('should fail with accountId 0', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test'],
                accountId: 0,
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail with accountId 3', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test'],
                accountId: 3,
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should fail with non-integer accountId', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test'],
                accountId: 1.5,
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(false);
        });

        test('should pass when accountId is not provided', () => {
            const input = {
                caption: 'Caption',
                hookText: 'Hook',
                hashtags: ['test'],
            };

            const result = validatePostReelRequest(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.accountId).toBeUndefined();
            }
        });
    });
});
