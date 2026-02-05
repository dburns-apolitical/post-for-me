import { describe, test, expect } from 'bun:test';
import { InstagramClientService } from '../../src/services/instagram-client';

describe('InstagramClientService', () => {
    test('should instantiate without errors', () => {
        expect(() => {
            const service = new InstagramClientService();
        }).not.toThrow();
    });

    test('should throw when getting credentials for invalid account', () => {
        const service = new InstagramClientService();
        expect(() => {
            (service as any).getCredentials(999);
        }).toThrow('No credentials found for account ID 999');
    });

    test('should return credentials for valid account IDs', () => {
        const service = new InstagramClientService();
        expect(() => {
            (service as any).getCredentials(1);
        }).not.toThrow();
        expect(() => {
            (service as any).getCredentials(2);
        }).not.toThrow();
    });
});
