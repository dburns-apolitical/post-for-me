export interface PostReelRequest {
    caption?: string;
    hookText?: string;
    hashtags?: string[];
    shareToFeed?: boolean;
    accountId: number;
}

export interface PostReelResponse {
    success: boolean;
    postId: number;
    message?: string;
}

export interface PostStatusResponse {
    success: boolean;
    post?: {
        id: number;
        status: PostStatus;
        created_at: Date;
        updated_at: Date;
        instagram_post_id: string | null;
        views: number | null;
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
    };
    error?: string;
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
    };
    tempDir: string;
    databaseUrl: string;
    dashboard: {
        password: string;
        neonAuthUrl?: string;
        neonJwksUrl?: string;
    };
    anthropic: {
        apiKey: string;
    };
}

// Database types
export type PostStatus = 'pending' | 'success' | 'failed';

export interface DbCaption {
    id: number;
    text: string;
    enabled: boolean;
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
    enabled: boolean;
    created_at: Date;
}

export interface ContentAccount {
    id: number;
    name: string;
}

export interface DbCaptionWithAccounts extends DbCaption {
    accounts: ContentAccount[];
}

export interface DbHookWithAccounts extends DbHook {
    accounts: ContentAccount[];
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

export interface DbAccount {
    id: number;
    name: string;
    ig_access_token: string;
    ig_user_id: string;
    gcs_bucket_name: string;
    created_at: Date;
}

export type Platform = 'instagram_direct' | 'upload_post';

export interface InstagramDirectCredentials {
    ig_access_token: string;
    ig_user_id: string;
}

export interface UploadPostCredentials {
    api_key: string;
    user: string;
    instagram: boolean;
    youtube: boolean;
    tiktok: boolean;
    twitter: boolean;
}

export interface DbCredential {
    id: number;
    account_id: number;
    platform: Platform;
    credentials: InstagramDirectCredentials | UploadPostCredentials;
    created_at: Date;
}

export interface DbPost {
    id: number;
    video_id: number;
    hook_id: number;
    caption_id: number;
    hashtag_combination_id: number;
    account_id: number;
    shared_to_feed: boolean;
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
    account_name: string;
}

export interface RecentPost {
    account_name: string;
    video_title: string;
    status: PostStatus;
    created_at: string;
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

export interface PostCountMetrics {
    allTime: number;
    last28Days: number;
    last7Days: number;
}

export interface DashboardStats {
    topPosts: PostWithDetails[];
    viewsMetrics: ViewsMetrics;
    postCountMetrics: PostCountMetrics;
    topCaptions: RankedItem[];
    topHooks: RankedItem[];
    topHashtagCombinations: RankedItem[];
    topVideos: RankedItem[];
    userLeaderboard: UserLeaderboardEntry[];
    userViewsPerVideo: UserViewsEntry[];
    latestEvaluation: AgentEvaluation | null;
}

export interface UserLeaderboardEntry {
    name: string;
    posts: number;
}

export interface UserViewsEntry {
    name: string;
    viewsPerVideo: number;
}

export interface AgentEvaluation {
    id: number;
    response: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    triggered_by: string;
    created_at: Date;
}

export interface DailyViewsEntry {
    day: string;
    views: number;
    postCount: number;
}

export interface ViewsHistoryResponse {
    success: boolean;
    dailyViews: DailyViewsEntry[];
    last28DaysTotal: number;
    previous28DaysTotal: number;
    deltaPercent: number | null;
}
