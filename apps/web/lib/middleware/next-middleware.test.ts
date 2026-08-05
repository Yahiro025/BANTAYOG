import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const supabaseMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: supabaseMocks.createServerClient,
}));

import { getMiddlewareSupabaseConfig, middleware } from "../../middleware";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function request(path: string, host: string): NextRequest {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("top-level Next middleware Supabase configuration", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    supabaseMocks.createServerClient.mockReset();
    supabaseMocks.getUser.mockReset();
  });

  afterEach(() => {
    restoreEnv("NEXT_PUBLIC_SUPABASE_URL", originalUrl);
    restoreEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", originalAnonKey);
  });

  it("returns null instead of inventing credentials when either public value is missing", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

    expect(getMiddlewareSupabaseConfig()).toBeNull();
  });

  it("does not throw for a localhost request when Supabase is not configured", async () => {
    const response = await middleware(request("/login", "localhost:3000"));

    expect(response.status).toBe(200);
    expect(supabaseMocks.createServerClient).not.toHaveBeenCalled();
  });

  it("fails closed for a non-local admin request when Supabase is not configured", async () => {
    const response = await middleware(request("/admin/analytics", "admin.bantayog.example"));

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("not configured");
    expect(supabaseMocks.createServerClient).not.toHaveBeenCalled();
  });

  it("keeps the configured Supabase admin role check unchanged", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    supabaseMocks.createServerClient.mockReturnValue({
      auth: { getUser: supabaseMocks.getUser },
    });
    supabaseMocks.getUser.mockResolvedValue({
      data: {
        user: {
          app_metadata: { role: "admin" },
          user_metadata: {},
        },
      },
    });

    const response = await middleware(request("/admin/analytics", "admin.bantayog.example"));

    expect(response.status).toBe(200);
    expect(supabaseMocks.createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });
});
