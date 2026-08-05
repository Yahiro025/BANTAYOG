"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { useAuth } from "@/stores/auth-context";
import { AdminHeaderNav } from "@/components/admin/header-nav";
import { PanelCardSkeleton } from "@/components/admin/skeleton";

/* ── Supabase browser client ── */
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
);

/* ── Timeout for Supabase session check (prevents infinite hang when offline) ── */
const SESSION_CHECK_TIMEOUT_MS = 3000;

/* ─────────────────────────────────────────────────────────
   Admin Layout — replaces the old sidebar layout.
   Renders the persistent top header nav bar (matching mocks
   2.png, 6.png, 10.png) then a peach canvas background
   containing {children}, and a slim footer.
   Includes client-side auth guard: redirects to /login if
   no active Supabase session is found.
   Dev bypass: checks auth context first — if user is already
   authenticated via dev bypass, skips the Supabase session check.
   ───────────────────────────────────────────────────────── */

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [checking, setChecking] = useState(true);
  const checkedRef = useRef(false);

  useEffect(() => {
    /* Avoid running twice in Strict Mode */
    if (checkedRef.current) return;
    checkedRef.current = true;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const checkSession = async () => {
      /* ── Dev bypass: if auth context already says authenticated, skip Supabase check ── */
      if (authState.status === "authenticated") {
        if (!cancelled) setChecking(false);
        return;
      }

      /* ── Timeout guard — don't let Supabase hang forever ── */
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        /* Supabase unreachable — let the user through */
        setChecking(false);
      }, SESSION_CHECK_TIMEOUT_MS);

      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        clearTimeout(timeoutId);

        if (!data.session) {
          router.replace("/login");
          return;
        }
      } catch {
        /* Supabase unreachable — let the user through; API routes will 404 anyway */
      } finally {
        if (!cancelled) {
          clearTimeout(timeoutId);
          setChecking(false);
        }
      }
    };

    checkSession();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [router, authState.status]);

  // The /admin/login route (legacy path) renders standalone
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  // Show a shape-only skeleton while checking the session.
  if (checking) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: "var(--color-canvas)" }}
      >
        <PanelCardSkeleton
          className="w-full max-w-sm rounded-2xl border border-brand-sageBorder/30 bg-bg-card/80 p-6 shadow-sm"
          ariaLabel="Verifying session"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--color-canvas)" }}>
      {/* Persistent top header nav */}
      <AdminHeaderNav />

      {/* Main canvas area */}
      <main className="flex-1 w-full">
        <div className="max-w-[1280px] mx-auto px-6 py-6">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-5 border-t border-white/15 bg-admin-footer">
        <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-white/90">
          © 2026 BANTAYOG. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
