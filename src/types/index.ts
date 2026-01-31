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

export interface BufferPost {
    id: string;
    status: string;
    scheduledAt?: string;
}

export interface Config {
    port: number;
    nodeEnv: string;
    gcs: {
        projectId: string;
        bucketName: string;
        keyFilePath: string;
    };
    buffer: {
        accessToken: string;
        profileId: string;
    };
    tempDir: string;
    historyFilePath: string;
}
