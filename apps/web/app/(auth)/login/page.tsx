"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createBrowserClient } from "@supabase/ssr";
import { useAuth } from "@/stores/auth-context";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

/* ── Supabase browser client ── */
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
);

/* ── Zod schema ── */
const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { setUsername, authenticate } = useAuth();

  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    setAuthError("");

    const email = values.email.trim();
    const password = values.password;

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("invalid") || msg.includes("credentials") || msg.includes("email not confirmed")) {
          setAuthError("Invalid email or password. Please check your credentials and try again.");
        } else if (msg.includes("too many")) {
          setAuthError("Too many login attempts. Please wait a moment before trying again.");
        } else {
          setAuthError(`Authentication failed: ${error.message}`);
        }
        setLoading(false);
        return;
      }
    } catch {
      setAuthError("Network error. Please check your connection and try again.");
      setLoading(false);
      return;
    }

    setUsername(email);
    authenticate();
    router.push("/admin/register");
  };

  return (
    <div className="w-full min-h-screen flex flex-col font-body" style={{ backgroundColor: "#FFD2C4" }}>
      {/* ═══════════════════════════════════
          MAIN CONTENT — Two-column layout
          ═══════════════════════════════════ */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 items-center px-8 py-10 lg:px-16 lg:py-12 gap-10 lg:gap-0">

        {/* ─── LEFT COLUMN ─── */}
        <div className="flex flex-col items-start gap-y-6 sm:gap-y-10 animate-fade-in">

          {/* Branding block — tightly grouped */}
          <div className="flex flex-col items-start gap-y-3 sm:gap-y-4">

            {/* DOH Badge */}
            <div
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 select-none"
              style={{ border: "1px solid rgba(3,62,57,0.25)", backgroundColor: "rgba(255,255,255,0.35)" }}
            >
              <svg
                className="w-3.5 h-3.5 flex-shrink-0 text-[#003E39]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span
                className="text-[10px] font-bold uppercase tracking-widest text-[#003E39]"
              >
                DOH Supported Social Initiative
              </span>
            </div>

            {/* BANTAYOG Logo / Title — cropped to remove transparent padding baked into the PNG */}
            <div className="w-full overflow-hidden" style={{ aspectRatio: '1920 / 338' }}>
              <Image
                src="/adminAssets/title.png"
                alt="BANTAYOG"
                width={1920}
                height={1080}
                className="w-full h-auto"
                style={{ marginTop: '-18.9%' }}
                priority
              />
            </div>

            {/* Hero Paragraph */}
            <p
              className="text-sm sm:text-base leading-relaxed max-w-2xl font-medium text-[#003E39]"
            >
              Breaking the cycle of childhood stunting at the grassroots level.
              Bantayog leverages smart digital cards and automated AI receipt
              tracking to ensure that community health subsidies are spent
              exclusively on nutrient-dense foods—safeguarding a child&apos;s
              critical early development while instantly settling balances with
              local micro-merchants.
            </p>

          </div>{/* / Branding block */}

          {/* Feature Highlight Cards */}
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg">

            {/* Card 1 — LGU Beneficiary Registry */}
            <div
              className="flex flex-col items-start p-5 rounded-xl flex-1 bg-white"
              style={{ boxShadow: "0 2px 16px rgba(3,62,57,0.08)" }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 flex-shrink-0 bg-[#E3F0F2] text-[#003E39]"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3 className="font-bold text-sm mb-1.5 text-[#003E39]">
                LGU Beneficiary Registry
              </h3>
              <p className="text-xs leading-relaxed text-[rgba(3,62,57,0.7)]">
                Onboard mother-child units, track stunting metrics, and issue unique secure QR passes.
              </p>
            </div>

            {/* Card 2 — AI Merchant Verification */}
            <div
              className="flex flex-col items-start p-5 rounded-xl flex-1 bg-white"
              style={{ boxShadow: "0 2px 16px rgba(3,62,57,0.08)" }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 flex-shrink-0 bg-[#FBE9E8] text-[#C27668]"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </div>
              <h3 className="font-bold text-sm mb-1.5 text-[#003E39]">
                AI Merchant Verification
              </h3>
              <p className="text-xs leading-relaxed text-[rgba(3,62,57,0.7)]">
                Merchants scan QR cards, capture checkout photos, and filter nutritional products instantly.
              </p>
            </div>
          </div>
        </div>

        {/* ─── RIGHT COLUMN — Login Card ─── */}
        <div className="flex items-center justify-end animate-slide-in-right">
          <div
            className="w-full max-w-[480px] rounded-[2rem] p-10 md:p-12"
            style={{
              backgroundColor: "#FDF2EE",
              boxShadow: "0 24px 64px rgba(3,62,57,0.14), 0 4px 16px rgba(0,0,0,0.06)",
            }}
          >
            {/* Card Header */}
            <div className="text-center mb-7">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#003E39]">
                Gateway Portal Access
              </h1>
              <p className="text-xs mt-2 font-medium uppercase tracking-wider text-[rgba(3,62,57,0.55)]">
                Select your portal pathway and authenticate
              </p>
            </div>

            {/* LGU Portal Indicator Bar */}
            <div
              className="w-full rounded-md px-4 h-12 flex items-center gap-2.5 mb-7 select-none bg-[#003E39]"
            >
              <svg
                className="w-5 h-5 flex-shrink-0 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                <path d="M9 22v-4h6v4" />
                <path d="M8 6h2" />
                <path d="M14 6h2" />
                <path d="M8 10h2" />
                <path d="M14 10h2" />
              </svg>
              <span className="text-white font-bold text-sm tracking-wide">LGU Portal</span>
            </div>

            {/* Auth Error Banner */}
            {authError && (
              <div
                className="mb-6 p-3.5 rounded-xl text-xs font-semibold leading-relaxed animate-fade-in bg-red-50 border border-red-200 text-red-700"
              >
                ⚠ {authError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Email Field */}
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-[10px] font-bold uppercase tracking-wider mb-2 text-[#003E39]"
                >
                  Username / Email ID
                </label>
                <input
                  id="login-email"
                  type="text"
                  placeholder="juandelacruz@bantayog.gov.ph"
                  autoComplete="email"
                  {...register("email")}
                  className="w-full h-14 rounded-xl bg-white px-4 text-lg outline-none transition-all duration-200"
                  style={{
                    border: errors.email
                      ? "1.5px solid #DC2626"
                      : "1.5px solid #F18F76",
                    color: "#003E39",
                    boxShadow: errors.email
                      ? "0 0 0 3px rgba(220,38,38,0.08)"
                      : "none",
                  }}
                  onFocus={(e) => {
                    if (!errors.email) {
                      e.target.style.border = "1.5px solid #003E39";
                      e.target.style.boxShadow = "0 0 0 3px rgba(3,62,57,0.08)";
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.email) {
                      e.target.style.border = "1.5px solid #F18F76";
                      e.target.style.boxShadow = "none";
                    }
                  }}
                />
                {errors.email && (
                  <p className="text-xs font-semibold mt-1.5 ml-1 text-red-600">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-[10px] font-bold uppercase tracking-wider mb-2 text-[#003E39]"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...register("password")}
                  className="w-full h-14 rounded-xl bg-white px-4 text-lg outline-none transition-all duration-200"
                  style={{
                    border: errors.password
                      ? "1.5px solid #DC2626"
                      : "1.5px solid #F18F76",
                    color: "#003E39",
                    boxShadow: errors.password
                      ? "0 0 0 3px rgba(220,38,38,0.08)"
                      : "none",
                  }}
                  onFocus={(e) => {
                    if (!errors.password) {
                      e.target.style.border = "1.5px solid #003E39";
                      e.target.style.boxShadow = "0 0 0 3px rgba(3,62,57,0.08)";
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.password) {
                      e.target.style.border = "1.5px solid #F18F76";
                      e.target.style.boxShadow = "none";
                    }
                  }}
                />
                {errors.password && (
                  <p className="text-xs font-semibold mt-1.5 ml-1 text-red-600">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* CTA Button */}
              <button
                id="login-submit"
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-xl font-bold text-lg uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mt-2 bg-[#F18F76] hover:bg-[#e8795f] text-[#003E39]"
                style={{
                  boxShadow: "0 4px 20px rgba(241,143,118,0.4)",
                }}
              >
                {loading ? (
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <>
                    <span>AUTHENTICATE AND ENTER</span>
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* ═══════════════════════════════════
          FOOTER BAR
          ═══════════════════════════════════ */}
      <footer
        className="h-14 flex items-center justify-center w-full flex-shrink-0 bg-admin-footer"
      >
        <p className="text-[10px] sm:text-xs font-medium text-white/90">
          © 2026 BANTAYOG. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
