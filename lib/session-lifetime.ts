/**
 * Better Auth session lifetime.
 *
 * These were previously unset, so Better Auth 1.7.4 used its own defaults:
 * `expiresIn` of 7 days and `updateAge` of 1 day. The session cookie Max-Age
 * follows `expiresIn`. None of those is a 35-minute lifetime.
 *
 * `cookieCache.maxAge` (5 minutes) is only the signed `session_data` cookie
 * that answers `/api/auth/get-session`. Mutations call `getSession` with
 * `disableCookieCache`, so the cache expiring does not sign anyone out.
 * A production deploy does not rotate `BETTER_AUTH_SECRET`; that value is a
 * Worker secret, and `BETTER_AUTH_URL` stays `https://halalfood.world`.
 *
 * A session that disappears with no message is the UI: a 401 used to redirect
 * to login, or swap in the signed-out screen, without saying the session ended.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
