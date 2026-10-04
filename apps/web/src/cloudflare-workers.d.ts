declare module "cloudflare:workers" {
  export const env: {
    HALAL_EVIDENCE_R2?: unknown;
    DB?: unknown;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    [name: string]: unknown;
  };
}
