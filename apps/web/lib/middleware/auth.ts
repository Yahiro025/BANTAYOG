// Auth Middleware for Next.js API Routes
// Provides helpers to validate Supabase sessions from the Authorization header
// and enforce role-based access control.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@bantayog/db";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { type NextRequest, NextResponse } from "next/server";

// Types

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "merchant" | "beneficiary";
}

// Helpers

export function createAuthClient(jwt: string): SupabaseClient<Database> {
  return createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// Extract and verify the JWT from the Authorization header.
// Returns the authenticated user or null.
export async function getAuthUser(
  request: NextRequest,
): Promise<AuthUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) return null;

  try {
    const client = createAuthClient(jwt);
    const { data, error } = await client.auth.getUser();

    if (error || !data.user) return null;

    const role =
      (data.user.app_metadata?.role as string) ??
      (data.user.user_metadata?.role as string) ??
      "beneficiary";

    return {
      id: data.user.id,
      email: data.user.email ?? "",
      role: role as AuthUser["role"],
    };
  } catch {
    return null;
  }
}

// Require authentication. Returns 401 if not authenticated.
export async function requireAuth(
  request: NextRequest,
): Promise<AuthUser | NextResponse> {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { message: "Unauthorized. Please log in." },
      { status: 401 },
    );
  }
  return user;
}

// Require admin role. Returns 403 if not admin.
export async function requireAdmin(
  request: NextRequest,
): Promise<AuthUser | NextResponse> {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  if (user.role !== "admin") {
    return NextResponse.json(
      { message: "Forbidden. Admin access required." },
      { status: 403 },
    );
  }
  return user;
}

// Require merchant or admin role.
export async function requireMerchantOrAdmin(
  request: NextRequest,
): Promise<AuthUser | NextResponse> {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  if (user.role !== "merchant" && user.role !== "admin") {
    return NextResponse.json(
      { message: "Forbidden. Merchant access required." },
      { status: 403 },
    );
  }
  return user;
}
