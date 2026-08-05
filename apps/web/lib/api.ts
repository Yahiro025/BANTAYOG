import { createBrowserClient } from "@supabase/ssr";
import { clearPinHash } from "@/stores/pin-store";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
);

// A wrapper around the native fetch API that automatically retrieves the
// current Supabase auth session token and attaches it to the request's
// Authorization header as a Bearer token.
// Priority order:
// 1. Merchant localStorage token (set on merchant-login), checked for expiry
// 2. Supabase browser session (set on admin login via Supabase Auth UI)
// The merchant token always wins over the Supabase session to prevent
// admin sessions from leaking into merchant-only endpoints (e.g. /api/vision).
export const MERCHANT_TOKEN_KEY = "bantayog_merchant_access_token";
export const MERCHANT_REFRESH_TOKEN_KEY = "bantayog_merchant_refresh_token";

// Returns true if the stored merchant token has expired.
function isMerchantTokenExpired(): boolean {
  if (typeof window === "undefined") return false;
  const expiresAt = window.localStorage.getItem(MERCHANT_TOKEN_KEY + "_expires");
  if (!expiresAt) return false; // No expiry stored — assume valid
  // expiresAt is a Unix timestamp (seconds)
  return Date.now() / 1000 > Number(expiresAt) - 30; // 30s buffer
}

// Clears the stored merchant token (call on logout or expiry).
export function clearMerchantToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(MERCHANT_TOKEN_KEY);
  window.localStorage.removeItem(MERCHANT_TOKEN_KEY + "_expires");
  window.localStorage.removeItem(MERCHANT_REFRESH_TOKEN_KEY);
  clearPinHash();
}

async function refreshMerchantToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const refreshToken = window.localStorage.getItem(MERCHANT_REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  try {
    const res = await fetch("/api/auth/merchant-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (res.ok) {
      const data = await res.json();
      const newAccessToken = data.session?.accessToken;
      const expiresAt = data.session?.expiresAt;
      if (newAccessToken) {
        window.localStorage.setItem(MERCHANT_TOKEN_KEY, newAccessToken);
        // Only set expiry if the server provided one
        if (expiresAt) {
          window.localStorage.setItem(MERCHANT_TOKEN_KEY + "_expires", String(expiresAt));
        } else {
          window.localStorage.removeItem(MERCHANT_TOKEN_KEY + "_expires");
        }
        return newAccessToken;
      }
    }
    // If refresh failed, clear tokens so user is prompted to log in again
    clearMerchantToken();
    return null;
  } catch {
    clearMerchantToken();
    return null;
  }
}

function isAdminEndpoint(url: string): boolean {
  // Strip query parameters
  const pathname = url.split("?", 1)[0];

  // Explicitly merchant-only routes
  if (pathname.startsWith("/api/merchants/me")) return false;
  if (pathname.startsWith("/api/vision")) return false;

  // These paths require LGU Admin (sessionToken)
  return (
    pathname.startsWith("/api/beneficiaries") ||
    pathname.startsWith("/api/merchants") ||
    pathname.startsWith("/api/analytics") ||
    pathname.startsWith("/api/chain") ||
    pathname.startsWith("/api/transactions") ||
    pathname.startsWith("/api/products")
  );
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let merchantToken = null;
  if (typeof window !== "undefined") {
    merchantToken = localStorage.getItem(MERCHANT_TOKEN_KEY);
    
    // Auto-refresh merchant token if expired
    if (merchantToken && isMerchantTokenExpired()) {
      const refreshed = await refreshMerchantToken();
      merchantToken = refreshed; // null if refresh failed
    }
  }

  const isAdmin = isAdminEndpoint(url);
  let sessionToken = null;

  // We only fetch the sessionToken if it's an admin endpoint, 
  // or if there is no merchant token.
  if (isAdmin || !merchantToken) {
    try {
      const { data } = await supabase.auth.getSession();
      sessionToken = data.session?.access_token ?? null;
    } catch (err) {
      console.error("Error retrieving Supabase session:", err);
    }
  }

  // Strict enforcement:
  // - Admin endpoints MUST use sessionToken (even if null)
  // - Merchant endpoints use merchantToken, or fallback to sessionToken
  const token = isAdmin ? sessionToken : (merchantToken ?? sessionToken);

  const headers = {
    ...options.headers,
  } as Record<string, string>;

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  return response;
}
