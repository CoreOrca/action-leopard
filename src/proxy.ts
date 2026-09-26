import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, gateEnabled, hasAccessCookie } from "@/lib/access-gate";

function isOpenPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/api/access" ||
    pathname.startsWith("/auth/confirm") ||
    pathname.startsWith("/api/stripe/webhook")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    gateEnabled() &&
    !isOpenPath(pathname) &&
    !hasAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value)
  ) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = pathname.startsWith("/studio") || pathname.startsWith("/api");
  const isAuthApi = pathname.startsWith("/api/auth");
  const isAccessApi = pathname === "/api/access";
  // Stripe calls this with a signature, not a session cookie.
  const isStripeWebhook = pathname.startsWith("/api/stripe/webhook");

  if (!user && isProtected && !isAuthApi && !isStripeWebhook && !isAccessApi) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const unlocked =
    !gateEnabled() || hasAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value);

  if (user && unlocked && (pathname === "/login" || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/studio";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
