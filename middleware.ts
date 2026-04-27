import { NextResponse, type NextRequest } from "next/server";

// Lightweight edge-runtime auth gate. We only check for the presence of a
// session cookie here — actual session verification happens in the
// `(app)/[tenantSlug]/layout.tsx` (and `(admin)/layout.tsx`) via `auth()`,
// which can hit Postgres. Splitting concerns this way keeps middleware
// dependency-free of Prisma (which can't run on edge).

const PUBLIC_PATHS = new Set<string>([
  "/",
  "/login",
  "/signup",
  "/verify-request",
]);

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/_next/",
  "/favicon.ico",
];

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => request.cookies.get(name));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = hasSessionCookie(request);

  if (isPublic(pathname)) {
    // If a signed-in user lands on /login or /signup, send them through the
    // post-auth dispatcher so they don't get stuck on auth pages.
    if (signedIn && (pathname === "/login" || pathname === "/signup")) {
      const url = request.nextUrl.clone();
      url.pathname = "/post-auth";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
