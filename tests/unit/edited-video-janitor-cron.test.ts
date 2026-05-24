import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { DbAccount } from '../../src/types/index';

// --- Mock DatabaseService ---
const mockGetAccounts = mock((): Promise<DbAccount[]> => Promise.resolve([]));

mock.module('../../src/services/database', () => ({
    DatabaseService: class {
        getAccounts = mockGetAccounts;
    },
}));

// --- Mock VideoSelectorService ---
const mockListEditedVideos = mock(
    (): Promise<Array<{ name: string; timeCreated: Date }>> => Promise.resolve([]),
);
const mockDeleteEditedVideo = mock((_url: string): Promise<void> => Promise.resolve());

mock.module('../../src/services/video-selector', () => ({
    VideoSelectorService: class {
        constructor(public bucketName: string) {}
        listEditedVideos = mockListEditedVideos;
        deleteEditedVideo = mockDeleteEditedVideo;
    },
}));

// Import AFTER mocks
import { EditedVideoJanitorCronService } from '../../src/services/edited-video-janitor-cron';

function account(overrides: Partial<DbAccount> = {}): DbAccount {
    return {
        id: 1,
        name: 'Test Account',
        ig_access_token: '',
        ig_user_id: '',
        gcs_bucket_name: 'bucket-a',
        created_at: new Date(),
        ...overrides,
    };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('EditedVideoJanitorCronService', () => {
    let service: EditedVideoJanitorCronService;

    beforeEach(() => {
        mockGetAccounts.mockClear();
        mockListEditedVideos.mockClear();
        mockDeleteEditedVideo.mockClear();
        service = new EditedVideoJanitorCronService();
    });

    test('returns zero counts when there are no accounts', async () => {
        mockGetAccounts.mockResolvedValueOnce([]);

        const result = await service.tick();

        expect(result).toEqual({ scannedBuckets: 0, scannedObjects: 0, deleted: 0, errors: 0 });
        expect(mockListEditedVideos).not.toHaveBeenCalled();
        expect(mockDeleteEditedVideo).not.toHaveBeenCalled();
    });

    test('skips accounts whose gcs_bucket_name is empty', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            account({ id: 1, gcs_bucket_name: '' }),
            account({ id: 2, gcs_bucket_name: 'bucket-a' }),
        ]);
        mockListEditedVideos.mockResolvedValueOnce([]);

        const result = await service.tick();

        expect(result.scannedBuckets).toBe(1);
        expect(mockListEditedVideos).toHaveBeenCalledTimes(1);
    });

    test('iterates each distinct bucket name once even if multiple accounts share it', async () => {
        mockGetAccounts.mockResolvedValueOnce([
            account({ id: 1, gcs_bucket_name: 'shared' }),
            account({ id: 2, gcs_bucket_name: 'shared' }),
            account({ id: 3, gcs_bucket_name: 'other' }),
        ]);
        mockListEditedVideos.mockResolvedValue([]);

        const result = await service.tick();

        expect(result.scannedBuckets).toBe(2);
        expect(mockListEditedVideos).toHaveBeenCalledTimes(2);
    });

    test('deletes only edited objects older than 24h', async () => {
        const now = Date.now();
        mockGetAccounts.mockResolvedValueOnce([account({ gcs_bucket_name: 'bucket-a' })]);
        mockListEditedVideos.mockResolvedValueOnce([
            { name: 'edited/fresh.mp4', timeCreated: new Date(now - 1 * HOUR) },        // young → keep
            { name: 'edited/borderline.mp4', timeCreated: new Date(now - 23 * HOUR) },  // young → keep
            { name: 'edited/stale.mp4', timeCreated: new Date(now - 25 * HOUR) },       // old → delete
            { name: 'edited/ancient.mp4', timeCreated: new Date(now - 10 * DAY) },      // old → delete
        ]);

        const result = await service.tick();

        expect(result).toEqual({ scannedBuckets: 1, scannedObjects: 4, deleted: 2, errors: 0 });
        expect(mockDeleteEditedVideo).toHaveBeenCalledTimes(2);
        expect(mockDeleteEditedVideo).toHaveBeenCalledWith(
            'https://storage.googleapis.com/bucket-a/edited/stale.mp4',
        );
        expect(mockDeleteEditedVideo).toHaveBeenCalledWith(
            'https://storage.googleapis.com/bucket-a/edited/ancient.mp4',
        );
    });

    test('list failure for one bucket counts as 1 error and does not block other buckets', async () => {
        const now = Date.now();
        mockGetAccounts.mockResolvedValueOnce([
            account({ id: 1, gcs_bucket_name: 'broken' }),
            account({ id: 2, gcs_bucket_name: 'healthy' }),
        ]);
        mockListEditedVideos
            .mockRejectedValueOnce(new Error('GCS down'))
            .mockResolvedValueOnce([
                { name: 'edited/x.mp4', timeCreated: new Date(now - 48 * HOUR) },
            ]);

        const result = await service.tick();

        expect(result.scannedBuckets).toBe(2);
        expect(result.errors).toBe(1);
        expect(result.deleted).toBe(1);
        expect(mockDeleteEditedVideo).toHaveBeenCalledWith(
            'https://storage.googleapis.com/healthy/edited/x.mp4',
        );
    });

    test('isRunning guard prevents overlapping ticks', async () => {
        mockGetAccounts.mockResolvedValue([]);

        const [r1, r2] = await Promise.all([service.tick(), service.tick()]);

        expect(mockGetAccounts).toHaveBeenCalledTimes(1);
        const zero = { scannedBuckets: 0, scannedObjects: 0, deleted: 0, errors: 0 };
        expect([r1, r2]).toContainEqual(zero);
    });

    test('top-level getAccounts failure is swallowed and surfaced as result of zeros', async () => {
        mockGetAccounts.mockRejectedValueOnce(new Error('DB unreachable'));

        // Tick must not throw — the cron loop is fire-and-forget at the timer.
        const result = await service.tick();

        expect(result.scannedBuckets).toBe(0);
        expect(mockListEditedVideos).not.toHaveBeenCalled();
    });
});
