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

async function refreshMerchantToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/merchant-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!res.ok) return null;

    const body = await res.json().catch(() => null);
    const newAccessToken = body?.session?.accessToken;
    const newRefreshToken = body?.session?.refreshToken;
    const expiresAt = body?.session?.expiresAt;

    if (newAccessToken) {
      window.localStorage.setItem(MERCHANT_TOKEN_KEY, newAccessToken);
      if (newRefreshToken) {
        window.localStorage.setItem(MERCHANT_REFRESH_TOKEN_KEY, newRefreshToken);
      }
      if (expiresAt) {
        window.localStorage.setItem(MERCHANT_TOKEN_KEY + "_expires", String(expiresAt));
      }
      return newAccessToken;
    }
  } catch (err) {
    console.error("Failed to refresh merchant token:", err);
  }
  return null;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token: string | null = null;

  // 1. Always check the merchant localStorage token first.
  //    Merchants log in via /api/auth/merchant-login which stores the token here.
  //    This applies to ALL merchant-facing endpoints (vision, transactions, products, etc.)
  if (typeof window !== "undefined") {
    const storedToken = window.localStorage.getItem(MERCHANT_TOKEN_KEY);
    const refreshToken = window.localStorage.getItem(MERCHANT_REFRESH_TOKEN_KEY);

    if (storedToken && !isMerchantTokenExpired()) {
      token = storedToken;
    } else if (storedToken && isMerchantTokenExpired() && refreshToken) {
      const refreshedToken = await refreshMerchantToken(refreshToken);
      if (refreshedToken) {
        token = refreshedToken;
      } else {
        clearMerchantToken();
      }
    } else if (storedToken && isMerchantTokenExpired() && !refreshToken) {
      clearMerchantToken();
    }
  }

  // 2. If no merchant token, fall back to a Supabase browser session (admin login).
  if (!token) {
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
    } catch (err) {
      console.error("Error retrieving Supabase session:", err);
    }
  }

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

  // If we get 401 and have no way to refresh, the token truly expired.
  // The error message in the caller will tell the user to log in again.
  return response;
}
