import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type MiddlewareSupabaseConfig = {
  url: string;
  anonKey: string;
};

/**
 * Resolve the public Supabase settings used by the Edge middleware.
 *
 * Do not provide fake credentials here. A fake URL/key still makes the
 * middleware call Supabase and can turn a missing local `.env.local` into a
 * network/runtime failure. The caller decides whether the missing config is
 * safe to tolerate based on the request host and environment.
 */
export function getMiddlewareSupabaseConfig(
  env: Record<string, string | undefined> = process.env,
): MiddlewareSupabaseConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

function missingSupabaseConfigResponse(): NextResponse {
  return new NextResponse("Supabase authentication is not configured.", { status: 500 });
}

function unavailableSupabaseResponse(): NextResponse {
  return new NextResponse("Supabase authentication is temporarily unavailable.", { status: 503 });
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostname = request.headers.get("host") || "";

  const pathname = url.pathname;

  const isMerchantDomain = hostname.includes("merchant-bantayog") || hostname.includes("merchant");
  const isBalanceDomain = hostname.includes("credits-balance-bantayog") || hostname.includes("balance");
  
  const isLocalhost = hostname.includes("localhost") || hostname.includes("127.0.0.1") || hostname.includes("0.0.0.0");

  // Group our UI routes
  const adminRoutes = ["/admin", "/login"];
  const merchantRoutes = ["/merchant-login", "/dashboard", "/cart", "/checkout"];
  const balanceRoutes = ["/balance"];

  const matchesAny = (path: string, routes: string[]) => 
    routes.some(r => path === r || path.startsWith(`${r}/`));

  // 1. Strict Subdomain Sandboxing
  if (isMerchantDomain) {
    if (pathname === "/") {
      url.pathname = "/merchant-login";
      return NextResponse.redirect(url);
    }
    if (!isLocalhost && (matchesAny(pathname, adminRoutes) || matchesAny(pathname, balanceRoutes))) {
      return new NextResponse("Not Found - This route is not available on the Merchant domain.", { status: 404 });
    }
  } else if (isBalanceDomain) {
    if (pathname === "/") {
      url.pathname = "/balance";
      return NextResponse.redirect(url);
    }
    if (!isLocalhost && (matchesAny(pathname, adminRoutes) || matchesAny(pathname, merchantRoutes))) {
      return new NextResponse("Not Found - This route is not available on the Balance domain.", { status: 404 });
    }
  } else {
    // Admin / Default Domain (including localhost)
    if (pathname === "/") {
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (!isLocalhost && (matchesAny(pathname, merchantRoutes) || matchesAny(pathname, balanceRoutes))) {
      return new NextResponse("Not Found - This route is not available on the Admin domain.", { status: 404 });
    }
  }

  // 2. Supabase Auth logic
  let response = NextResponse.next({ request: { headers: request.headers } });
  const supabaseConfig = getMiddlewareSupabaseConfig();

  if (!supabaseConfig) {
    // Local development can still render the login page and use the existing
    // dev/session bypass in the admin layout. Never bypass an admin request on
    // a non-local host when the auth configuration is missing.
    if (pathname.startsWith("/admin") && !isLocalhost) {
      return missingSupabaseConfigResponse();
    }
    return response;
  }

  let user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null = null;

  try {
    const supabase = createServerClient(
      supabaseConfig.url,
      supabaseConfig.anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(
            cookiesToSet: {
              name: string;
              value: string;
              options?: Record<string, unknown>;
            }[],
          ) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({
              request: { headers: request.headers },
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]),
            );
          },
        },
      },
    );

    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    // Do not expose Supabase errors or secrets. A local app should still be
    // able to render while the developer fixes connectivity/configuration;
    // deployed admin traffic fails closed instead of bypassing auth.
    if (pathname.startsWith("/admin") && !isLocalhost) {
      return unavailableSupabaseResponse();
    }
    return response;
  }

  if (pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const role = user.app_metadata?.role ?? user.user_metadata?.role;
    if (role !== "admin") {
      return new NextResponse("Not Found", { status: 404 });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Match all request paths except:
// - _next/static (static files)
// - _next/image (image optimization files)
// - favicon.ico (favicon file)
// - public assets (images, svg, etc.)
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
