import { defineConfig } from '@/libs/next/proxy/define-config';

const { middleware } = defineConfig();

// required to be literal
export const config = {
  matcher: [
    // NOTE: `/api`, `/trpc`, `/webapi` are intentionally NOT matched. The
    // middleware is a no-op for them — `defaultMiddleware` short-circuits the
    // rewrite half via `backendApiEndpoints`, and they're all public routes, so
    // the better-auth session lookup is skipped. Auth lives in the route
    // handlers (`checkAuth`, trpc `protectedProcedure`), which return JSON 401s
    // rather than the HTML redirect-to-signin. Skipping the matcher avoids a
    // needless middleware invocation on the hottest backend traffic. (/oidc and
    // /oauth stay matched below — their middleware pass is still load-bearing.)
    // include the /
    '/',
    // Native workspace URLs use a 3–32 character lowercase slug. Keep backend
    // and internal template roots out of this dynamic matcher. Membership is
    // still resolved by the SPA and enforced independently by every API.
    '/:workspaceSlug((?!api(?:/|$)|trpc(?:/|$)|webapi(?:/|$)|market(?:/|$)|spa(?:/|$))[a-z0-9][a-z0-9-]{1,30}[a-z0-9])/:path*',
    '/acceptance',
    '/acceptance(.*)',
    '/apps',
    '/apps(.*)',
    '/community',
    '/community(.*)',
    '/dashboard',
    '/dashboard(.*)',
    '/labs',
    '/eval',
    '/eval(.*)',
    /** Shared-agent pages need the same SPA rewrite as the other client routes. */
    '/a',
    '/a/(.*)',
    '/agent',
    '/agent(.*)',
    '/group',
    '/group(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/image',
    '/video',
    '/resource',
    '/resource(.*)',
    '/profile(.*)',
    '/projects',
    '/project',
    '/project/(.*)',
    '/page',
    '/page(.*)',
    '/tasks',
    '/tasks(.*)',
    '/task',
    '/task(.*)',
    '/goals',
    '/goals(.*)',
    '/goal',
    '/goal(.*)',
    '/me',
    '/me(.*)',
    '/share(.*)',

    '/onboarding',
    '/onboarding(.*)',

    '/signup(.*)',
    '/signin(.*)',
    '/verify-email(.*)',
    '/verify-im(.*)',
    // Retired report links: the Workbench redirects them into Acceptance.
    '/verify',
    '/verify/(.*)',
    '/reset-password(.*)',
    '/auth-error(.*)',
    '/oauth(.*)',
    '/oidc(.*)',
    '/market-auth-callback(.*)',
  ],
};

export default middleware;
