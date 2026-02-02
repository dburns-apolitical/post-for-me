export interface PostReelRequest {
    caption?: string;
    hookText?: string;
    hashtags?: string[];
}

export interface PostReelResponse {
    success: boolean;
    postId: string;
    videoUsed: string;
    message?: string;
}

export interface VideoFile {
    name: string;
    path: string;
    url: string;
    createdAt: Date;
}

export interface InstagramPost {
    id: string;
    status: string;
    containerId: string;
}

export interface Config {
    port: number;
    nodeEnv: string;
    gcs: {
        projectId: string;
        bucketName: string;
        keyFilePath: string;
    };
    instagram: {
        accessToken: string;
        userId: string;
    };
    tempDir: string;
    databaseUrl: string;
    dashboard: {
        password: string;
        neonAuthUrl?: string;
    };
}

// Database types
export type PostStatus = 'pending' | 'success' | 'failed';

export interface DbCaption {
    id: number;
    text: string;
    created_at: Date;
}

export interface DbHashtag {
    id: number;
    text: string;
    created_at: Date;
}

export interface DbHook {
    id: number;
    text: string;
    created_at: Date;
}

export interface DbHashtagCombination {
    id: number;
    hashtag1_id: number;
    hashtag2_id: number | null;
    hashtag3_id: number | null;
    hashtag4_id: number | null;
    hashtag5_id: number | null;
    created_at: Date;
}

export interface DbVideo {
    id: number;
    title: string;
    created_at: Date;
}

export interface DbPost {
    id: number;
    video_id: number;
    hook_id: number;
    caption_id: number;
    hashtag_combination_id: number;
    instagram_post_id: string | null;
    views: number | null;
    status: PostStatus;
    created_at: Date;
    updated_at: Date;
}

// Dashboard Stats Types
export interface PostWithDetails {
    id: number;
    instagram_post_id: string | null;
    views: number | null;
    status: PostStatus;
    created_at: Date;
    updated_at: Date;
    video: {
        id: number;
        title: string;
    };
    hook: {
        id: number;
        text: string;
    };
    caption: {
        id: number;
        text: string;
    };
    hashtags: string[];
}

export interface RankedItem {
    id: number;
    text: string;
    postCount: number;
    totalViews: number;
    avgViews: number;
}

export interface ViewsMetrics {
    allTime: number;
    last28Days: number;
    previous28Days: number;
    deltaPercent: number | null;
}

export interface DashboardStats {
    topPosts: PostWithDetails[];
    mostRecentPost: PostWithDetails | null;
    viewsMetrics: ViewsMetrics;
    topCaptions: RankedItem[];
    topHooks: RankedItem[];
    topHashtagCombinations: RankedItem[];
    topVideos: RankedItem[];
}
