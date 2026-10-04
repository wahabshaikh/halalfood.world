declare module "cloudflare:workers" {
  export const env: {
    HALAL_EVIDENCE_R2?: unknown;
    DB?: unknown;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    GOOGLE_SEARCH_DAILY_CAP?: string;
    GOOGLE_DETAILS_DAILY_CAP?: string;
    GOOGLE_SEARCH_ANON?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    GOOGLE_SEARCH_USER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    [name: string]: unknown;
  };
}
