"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/stores/auth-context";

/* ─────────────────────────────────────────────────────────
   AdminHeaderNav — persistent top bar across all /admin/* routes
   Logo + "Prototype" badge + university subtext on the left.
   Registration | Beneficiaries | Merchants | Analytics links on the right.
   Active route highlighted with a pill background.
   ───────────────────────────────────────────────────────── */

const navLinks = [
  { href: "/admin/register", label: "REGISTRATION" },
  { href: "/admin/beneficiaries", label: "BENEFICIARIES" },
  { href: "/admin/merchants", label: "MERCHANTS" },
  { href: "/admin/analytics", label: "ANALYTICS" },
] as const;

export function AdminHeaderNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  const handleSignOut = () => {
    logout();
    router.push("/login");
    setShowSignOutModal(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/15 bg-gradient-to-r from-admin-header-start to-admin-header-end">
      <div className="max-w-[1280px] mx-auto px-6 h-[72px] flex items-center justify-between gap-4">

        {/* ── Left: Logo + wordmark + badge + subtext ── */}
        <Link href="/admin/beneficiaries" className="flex flex-row items-center gap-3 flex-nowrap select-none">
          {/* Logo emblem */}
          <Image
            src="/adminAssets/logo.png"
            alt="Bantayog"
            width={40}
            height={40}
            className="h-10 w-10 object-contain shrink-0 brightness-0 invert"
            priority
          />

          {/* Text column: row 1 (wordmark + badge) / row 2 (subtitle) */}
          <div className="flex flex-col justify-center gap-0.5 flex-nowrap shrink-0">
            {/* Row 1: wordmark + badge side by side */}
            <div className="flex flex-row items-center gap-2 flex-nowrap">
              <Image
                src="/adminAssets/title2.png"
                alt="Bantayog"
                width={140}
                height={28}
                className="h-7 w-auto object-contain shrink-0 brightness-0 invert"
                priority
              />
              {/* "Prototype" badge */}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-white border border-white/25 leading-none">
                Prototype
              </span>
            </div>
            {/* Row 2: university subtitle */}
            <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-white leading-none">
              Polytechnic University of the Philippines
            </span>
          </div>
        </Link>

        {/* ── Right: Navigation links + Sign Out ── */}
        <nav className="flex items-center gap-1">
          {navLinks.map(({ href, label }) => {
            const isActive = pathname === href ||
              (href === "/admin/beneficiaries" && pathname === "/admin");

            return (
              <Link
                key={href}
                href={href}
                className={`
                  px-4 py-2 rounded-full text-[11px] font-bold tracking-wider
                  transition-all duration-200 select-none
                  ${isActive
                    ? "bg-admin-header-active-bg text-admin-header-active-text shadow-sm"
                    : "text-white/90 hover:text-white hover:bg-white/10"
                  }
                `}
              >
                {label}
              </Link>
            );
          })}

          {/* Sign Out icon button */}
          <button
            onClick={() => setShowSignOutModal(true)}
            className="ml-2 w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-all duration-200 select-none cursor-pointer"
            aria-label="Sign Out"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </nav>
      </div>

      {/* Thin separator line below header */}
      <div className="h-[3px] bg-gradient-to-r from-brand-sageBorder/20 via-brand-sageBorder/50 to-brand-sageBorder/20" />

      {/* ═══════════════════════════════════════
         Sign Out Confirmation Modal
         ═══════════════════════════════════════ */}
      {showSignOutModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
          style={{ backgroundColor: "rgba(3,62,57,0.25)" }}
          onClick={() => setShowSignOutModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon + Title */}
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-brand-coral/10 flex items-center justify-center text-brand-coral flex-shrink-0">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-brand-darkTeal">Sign Out</h2>
            </div>

            {/* Body text */}
            <p className="text-sm text-brand-darkTeal/70 leading-relaxed mb-6 ml-[52px]">
              Are you sure you want to sign out? You will be redirected to the login page.
            </p>

            {/* Actions */}
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowSignOutModal(false)}
                className="px-5 py-2.5 rounded-full text-xs font-bold text-brand-darkTeal/70 hover:text-brand-darkTeal hover:bg-brand-sageBg/40 transition-all duration-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                className="px-5 py-2.5 rounded-full text-xs font-bold text-white bg-brand-coral hover:bg-brand-coralHover transition-all duration-200 cursor-pointer shadow-sm"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
