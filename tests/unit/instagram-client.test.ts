import { describe, test, expect } from 'bun:test';
import { InstagramClientService } from '../../src/services/instagram-client';

describe('InstagramClientService', () => {
    test('should instantiate without errors', () => {
        expect(() => {
            const service = new InstagramClientService('test-token', 'test-user-id');
        }).not.toThrow();
    });
});
