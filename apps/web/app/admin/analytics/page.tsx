"use client";

import { useState } from "react";
import { StatusBar } from "@/components/admin/status-bar";
import { ConsumptionCharts } from "./components/ConsumptionCharts";
import { SystemHealthMetrics } from "./components/SystemHealthMetrics";
import { DPAExportModal } from "./components/DPAExportModal";

/* ─────────────────────────────────────────────────────────
   Analytics Page — fourth tab of the LGU Admin Portal.

   Structure:
   1. StatusBar
   2. Toolbar: reporting period selector + DPA export action
   3. Section A — Product & Nutrition Analytics  (ConsumptionCharts)
   4. Section B — Merchant & System Performance  (SystemHealthMetrics)

   Every figure on this page is fetched from the API through authFetch, using
   the same admin session as the beneficiaries and merchants pages. Nothing is
   hardcoded, and widgets whose endpoint does not exist yet say so instead of
   showing a number.
   ───────────────────────────────────────────────────────── */

const PERIOD_OPTIONS = [
  { days: 7, label: "7 DAYS" },
  { days: 30, label: "30 DAYS" },
  { days: 90, label: "90 DAYS" },
] as const;

const DEFAULT_PERIOD_DAYS = 30;

function SectionHeading({ title }: { title: string }) {
  return <h2 className="text-lg font-bold text-brand-darkTeal">{title}</h2>;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <>
      <div className="space-y-5 animate-fade-in">
        <StatusBar />

        {/* ── Toolbar: reporting period + export ── */}
        <div className="bg-bg-card/80 backdrop-blur-sm rounded-2xl border border-border-input/30 px-6 py-4 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-sageBg flex items-center justify-center text-brand-darkTeal flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 19V5M4 19h16" />
                <rect x="7" y="11" width="3" height="5" rx="1" />
                <rect x="12.5" y="7" width="3" height="9" rx="1" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-brand-darkTeal text-sm leading-tight">Nutrition & System Analytics</p>
              <p className="text-brand-darkTeal/55 text-xs mt-0.5 leading-tight">
                Aggregated programme data — no beneficiary identity is loaded on this page
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div
              className="flex items-center gap-1 bg-brand-peachBg/40 rounded-full p-1"
              role="group"
              aria-label="Reporting period"
            >
              {PERIOD_OPTIONS.map((option) => {
                const isActive = option.days === days;
                return (
                  <button
                    key={option.days}
                    type="button"
                    onClick={() => setDays(option.days)}
                    aria-pressed={isActive}
                    className={`
                      px-4 py-2 rounded-full text-[11px] font-bold tracking-wider
                      transition-all duration-200 cursor-pointer select-none
                      ${isActive
                        ? "bg-route-active-bg text-route-active-text shadow-sm"
                        : "text-brand-darkTeal/70 hover:text-brand-darkTeal hover:bg-brand-sageBg/40"
                      }
                    `}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-coral text-white text-xs font-bold tracking-wide hover:bg-brand-coralHover transition-all duration-200 cursor-pointer shadow-sm"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
              </svg>
              DPA Export
            </button>
          </div>
        </div>

        {/* ── Section A ── */}
        <section className="space-y-4">
          <SectionHeading title="Product & Nutrition Analytics" />
          <ConsumptionCharts days={days} />
        </section>

        {/* ── Section B ── */}
        <section className="space-y-4">
          <SectionHeading title="Merchant & System Performance" />
          <SystemHealthMetrics days={days} />
        </section>
      </div>

      {/* Modal rendered outside the animated wrapper to avoid a stacking-context trap */}
      <DPAExportModal open={exportOpen} days={days} onClose={() => setExportOpen(false)} />
    </>
  );
}
