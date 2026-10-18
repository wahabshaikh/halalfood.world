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
    /** Places search and Scout geocoding. Unset: neither calls Google. */
    GOOGLE_PLACES_API_KEY?: string;
    GOOGLE_MAPS_API_KEY?: string;
    /** Halal Food Scout's bearer secret for /api/mcp. Unset or under 32 characters: the endpoint is off. */
    MCP_ADMIN_SECRET?: string;
    MCP_WRITE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    [name: string]: unknown;
  };
}
