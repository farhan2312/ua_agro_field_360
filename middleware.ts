import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

const PUBLIC_PATHS = new Set(["/login", "/register"]);
const CHANGE_PW = "/change-password";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const isPublic = PUBLIC_PATHS.has(pathname);

  // Not signed in and requesting a protected page → send to login.
  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Signed in but on an auth page → send to the app.
  if (session && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = session.mustChangePassword ? CHANGE_PW : "/analytics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Signed in and must reset password → force the change-password page.
  if (session && session.mustChangePassword && pathname !== CHANGE_PW) {
    const url = req.nextUrl.clone();
    url.pathname = CHANGE_PW;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
