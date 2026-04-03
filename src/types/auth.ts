/**
 * KnowAI SSO Authentication Types
 */

/** User profile from KnowAI */
export interface AuthUser {
    id: string;
    name: string;
    avatar: string;
    balance: number;
}

/** Auth state for the React hook */
export interface AuthState {
    user: AuthUser | null;
    isLoading: boolean;
    isLoggedIn: boolean;
}

/** Token response from /api/x/token */
export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: AuthUser;
}

/** User info response from /api/x/me */
export interface MeResponse {
    user_id: string;
    name: string;
    avatar: string;
    balance: number;
}
