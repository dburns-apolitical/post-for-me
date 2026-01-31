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
    historyFilePath: string;
}
