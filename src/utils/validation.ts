import { z } from 'zod';

export const postReelSchema = z.object({
    caption: z.string().min(1, 'Caption cannot be empty').max(2200, 'Caption too long').optional(),
    hookText: z.string().min(1, 'Hook text cannot be empty').max(500, 'Hook text too long').optional(),
    hashtags: z.array(z.string().regex(/^[a-zA-Z0-9_]+$/, 'Invalid hashtag format'))
        .min(1, 'At least one hashtag required if provided')
        .max(30, 'Maximum 30 hashtags allowed')
        .optional(),
    shareToFeed: z.boolean().optional(),
    accountId: z.number().int().min(1).max(2).optional(),
    videoTitle: z.string().min(1, 'Video title cannot be empty').max(500, 'Video title too long').optional(),
});

export type PostReelInput = z.infer<typeof postReelSchema>;

export function validatePostReelRequest(data: unknown) {
    return postReelSchema.safeParse(data);
}
