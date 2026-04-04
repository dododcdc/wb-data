export interface CurrentUser {
    id: number;
    username: string;
    displayName: string;
    systemRole: string;
}

export interface ProjectGroupContextItem {
    id: number;
    name: string;
    description: string;
    role: string;
}

export interface LoginRequest {
    username: string;
    password: string;
}

export interface LoginResponse {
    accessToken: string;
    tokenType: string;
    expiresAt: string;
    user: CurrentUser;
}

export interface AuthContextResponse {
    user: CurrentUser;
    systemAdmin: boolean;
    currentGroup: ProjectGroupContextItem | null;
    accessibleGroups: ProjectGroupContextItem[];
    permissions: string[];
}
