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
    /** Hosted Whop checkouts and signed billing webhooks. */
    WHOP_API_KEY?: string;
    WHOP_COMPANY_ID?: string;
    WHOP_WEBHOOK_SECRET?: string;
    WHOP_SPONSOR_PRODUCT_ID?: string;
    WHOP_NEWSLETTER_PLAN_ID?: string;
    WHOP_NEWSLETTER_PRODUCT_ID?: string;
    MCP_WRITE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    MEMBER_MCP_WRITE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    /** Public member MCP (/api/mcp/member): reads per client IP. */
    MEMBER_MCP_READ_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    [name: string]: unknown;
  };
}
