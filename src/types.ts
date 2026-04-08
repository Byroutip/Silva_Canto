export type DriveFile = {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    thumbnailLink?: string;
    iconLink?: string;
    webViewLink?: string;
};

export type AuthSession = {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    scope?: string;
    tokenType?: string;
    idToken?: string;
};

export type BreadcrumbItem = {
    id: string;
    name: string;
};