"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  AnalyticsScanOutcomesDto,
  AnalyticsTierSpendDto,
  AnalyticsTopProductsResponseDto,
  type AnalyticsScanOutcomes,
  type AnalyticsTierSpend,
  type AnalyticsTopProductsResponse,
} from "@bantayog/schema/analytics";
import { authFetch } from "@/lib/api";
import { PanelCardSkeleton } from "@/components/admin/skeleton";

/* ─────────────────────────────────────────────────────────
   Section A — Product & Nutrition Analytics.

   Every number on this surface comes from the API. There is no sample
   series, no placeholder bar, and no fallback constant anywhere in this
   file: a widget either renders server data, a skeleton, or an explicit
   "not available" state.

   The three widgets read server-owned aggregates/counters. A widget either
   renders verified server data, a skeleton, or an explicit unavailable state
   when its backing metric store has no value.
   ───────────────────────────────────────────────────────── */

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "pending"; message: string }
  | { status: "error"; message: string };

/**
 * Fetches and validates one analytics payload.
 *
 * A 404/501 is treated as "route not built yet" rather than an error, because
 * the Hono API answers unknown paths with 404. A schema mismatch is surfaced as
 * an error instead of being rendered, so an unexpected payload can never be
 * drawn as if it were verified data.
 */
async function requestJson<T>(path: string, schema: z.ZodType<T>): Promise<LoadState<T>> {
  try {
    const response = await authFetch(path);

    if (!response.ok) {
      if (process.env.NODE_ENV !== "production") {
        const body = await response.text().catch(() => "");
        const prefix = `[analytics] ${path} → HTTP ${response.status}`;
        if (response.status === 404 || response.status === 501) {
          console.warn(prefix, body.slice(0, 300));
        } else {
          console.error(prefix, body.slice(0, 300));
        }
      }

      if (response.status === 404 || response.status === 501) {
        return {
          status: "pending",
          message: `Not yet available — the analytics route is not implemented yet (HTTP ${response.status}).`,
        };
      }

      return {
        status: "error",
        message: `This analytics data could not be loaded (HTTP ${response.status}). Try again later.`,
      };
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: "error", message: "The server returned an unexpected analytics payload." };
    }

    return { status: "ready", data: parsed.data };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[analytics] ${path} request failed before a response was received.`, error);
    }
    return { status: "error", message: "The analytics service could not be reached. Check the connection." };
  }
}

function formatPhpc(amount: number): string {
  return `${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} PHPC`;
}

/* ── Widget shell (mirrors the card anatomy used by the other admin pages) ── */
function WidgetCard({
  title,
  subtitle,
  icon,
  children,
  loading = false,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <article className="bg-bg-card/80 backdrop-blur-sm rounded-2xl border border-border-input/30 p-6 shadow-sm">
      {loading ? (
        <PanelCardSkeleton ariaLabel="Loading analytics data" />
      ) : (
        <>
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-brand-sageBg flex items-center justify-center text-brand-darkTeal flex-shrink-0">
              {icon}
            </div>
            <div>
              <h3 className="text-sm font-bold text-brand-darkTeal leading-tight">{title}</h3>
              <p className="text-xs text-brand-darkTeal/55 mt-0.5 leading-tight">{subtitle}</p>
            </div>
          </div>
          {children}
        </>
      )}
    </article>
  );
}

function EmptyState({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-brand-sageBorder/40 bg-brand-peachBg/30 px-4 py-6 text-center">
      <p className="text-xs font-semibold text-brand-darkTeal/70 leading-relaxed">{message}</p>
      {detail && <p className="text-[11px] text-brand-darkTeal/50 mt-1.5 leading-relaxed">{detail}</p>}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
      <p className="text-xs font-semibold text-red-700 leading-relaxed">{message}</p>
    </div>
  );
}

/* ── Widget 1: top nutrient-dense items ── */
function ProductRanking({ products }: { products: AnalyticsTopProductsResponse }) {
  if (products.length === 0) {
    return <EmptyState message="No product purchases were recorded for this period." />;
  }

  const maxCount = Math.max(...products.map((product) => product.purchaseCount), 1);

  return (
    <ol className="space-y-3.5" aria-label="Top nutrient-dense items">
      {products.map((product) => (
        <li key={`${product.productName}-${product.category}`} className="space-y-1.5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-brand-darkTeal truncate">{product.productName}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-darkTeal/40">
                {product.foodGroup} · {product.category}
              </p>
            </div>
            <span className="text-xs font-bold text-brand-activeTeal flex-shrink-0">
              {product.purchaseCount.toLocaleString("en-PH")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-brand-sageBg/40 overflow-hidden" aria-hidden="true">
            <div
              className="h-full rounded-full bg-brand-activeTeal transition-all duration-200"
              style={{ width: `${(product.purchaseCount / maxCount) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Widget 2: approved vs. rejected scans ── */
function ScanOutcomes({ outcomes }: { outcomes: AnalyticsScanOutcomes }) {
  const total = outcomes.approvedCount + outcomes.rejectedCount;

  if (total === 0) {
    return (
      <EmptyState
        message="No approved or rejected scan verdicts were recorded for this period."
        detail="The server-backed scan counters are currently zero."
      />
    );
  }

  const approvedPercent = (outcomes.approvedCount / total) * 100;

  return (
    <div className="space-y-5">
      <div
        className="flex h-4 overflow-hidden rounded-full bg-brand-peachBg"
        role="img"
        aria-label={`${outcomes.approvedCount} approved and ${outcomes.rejectedCount} rejected scans`}
      >
        <div className="bg-brand-activeTeal transition-all duration-200" style={{ width: `${approvedPercent}%` }} />
        <div className="bg-brand-coral transition-all duration-200" style={{ width: `${100 - approvedPercent}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-brand-sageBg/30 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal/40">Approved</p>
          <p className="text-2xl font-black text-brand-activeTeal mt-1 leading-tight">
            {outcomes.approvedCount.toLocaleString("en-PH")}
          </p>
        </div>
        <div className="rounded-xl bg-brand-coral/10 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal/40">Rejected</p>
          <p className="text-2xl font-black text-brand-coral mt-1 leading-tight">
            {outcomes.rejectedCount.toLocaleString("en-PH")}
          </p>
        </div>
      </div>

      {outcomes.rejectionReasons.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal/40 mb-2">
            Rejection reasons
          </p>
          <ul className="space-y-2">
            {outcomes.rejectionReasons.map((reason) => (
              <li key={reason.reason} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-brand-darkTeal/70">{reason.reason}</span>
                <span className="font-bold text-brand-darkTeal">{reason.count.toLocaleString("en-PH")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── Widget 3: Tier 1 vs. Tier 2 spend ──
   Grant amounts are enforced server-side at allocation time. This only charts
   the allocated and spent values the API returns; it never recomputes them. */
function TierSpend({ spend }: { spend: AnalyticsTierSpend }) {
  const tiers = [
    { key: "tier1" as const, label: "Tier 1 · Critical (1K-day window)", bar: "bg-brand-coral", text: "text-brand-coral" },
    { key: "tier2" as const, label: "Tier 2 · Standard", bar: "bg-brand-activeTeal", text: "text-brand-activeTeal" },
  ];

  const maxAmount = Math.max(
    spend.tier1.allocated,
    spend.tier1.spent,
    spend.tier2.allocated,
    spend.tier2.spent,
    1,
  );

  return (
    <div className="space-y-5">
      {tiers.map((tier) => {
        const bucket = spend[tier.key];
        return (
          <div key={tier.key} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className={`text-xs font-bold ${tier.text}`}>{tier.label}</p>
              <p className="text-[10px] font-semibold text-brand-darkTeal/50 flex-shrink-0">
                {bucket.beneficiaryCount.toLocaleString("en-PH")} beneficiaries
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-16 text-[10px] font-semibold uppercase tracking-wider text-brand-darkTeal/40">
                  Allocated
                </span>
                <div className="h-2.5 flex-1 rounded-full bg-brand-sageBg/40 overflow-hidden" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${tier.bar} transition-all duration-200`}
                    style={{ width: `${(bucket.allocated / maxAmount) * 100}%` }}
                  />
                </div>
                <span className="w-28 text-right text-[10px] font-bold text-brand-darkTeal">
                  {formatPhpc(bucket.allocated)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-16 text-[10px] font-semibold uppercase tracking-wider text-brand-darkTeal/40">
                  Spent
                </span>
                <div className="h-2.5 flex-1 rounded-full bg-brand-sageBg/40 overflow-hidden" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-brand-darkTeal transition-all duration-200"
                    style={{ width: `${(bucket.spent / maxAmount) * 100}%` }}
                  />
                </div>
                <span className="w-28 text-right text-[10px] font-bold text-brand-darkTeal">
                  {formatPhpc(bucket.spent)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ConsumptionCharts({ days }: { days: number }) {
  const [topProducts, setTopProducts] = useState<LoadState<AnalyticsTopProductsResponse>>({ status: "loading" });
  const [scanOutcomes, setScanOutcomes] = useState<LoadState<AnalyticsScanOutcomes>>({ status: "loading" });
  const [tierSpend, setTierSpend] = useState<LoadState<AnalyticsTierSpend>>({ status: "loading" });

  const loadSectionA = useCallback(async () => {
    setTopProducts({ status: "loading" });
    setScanOutcomes({ status: "loading" });
    setTierSpend({ status: "loading" });

    const [topProductsResult, scanOutcomesResult, tierSpendResult] = await Promise.all([
      // Read-only aggregate from the admin analytics API.
      requestJson(
        `/api/analytics/top-products?days=${encodeURIComponent(String(days))}`,
        AnalyticsTopProductsResponseDto,
      ),
      // Read-only scan outcome counters from the admin analytics API.
      requestJson("/api/analytics/scan-outcomes", AnalyticsScanOutcomesDto),
      // Read-only tier spend aggregate from the admin analytics API.
      requestJson("/api/analytics/tier-spend", AnalyticsTierSpendDto),
    ]);

    setTopProducts(topProductsResult);
    setScanOutcomes(scanOutcomesResult);
    setTierSpend(tierSpendResult);
  }, [days]);

  useEffect(() => {
    void loadSectionA();
  }, [loadSectionA]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <WidgetCard
        loading={topProducts.status === "loading"}
        title="Top Nutrient-Dense Items"
        subtitle={`Purchases aggregated over the last ${days} days`}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21c4.5-3.2 7-6.5 7-10a7 7 0 0 0-14 0c0 3.5 2.5 6.8 7 10Z" />
            <path d="M12 8v6M9 11h6" />
          </svg>
        }
      >
        {topProducts.status === "ready" && <ProductRanking products={topProducts.data} />}
        {topProducts.status === "pending" && (
          <EmptyState
            message={topProducts.message}
            detail="No ranking is shown until the server returns aggregated purchase data."
          />
        )}
        {topProducts.status === "error" && <ErrorState message={topProducts.message} />}
      </WidgetCard>

      <WidgetCard
        loading={scanOutcomes.status === "loading"}
        title="Approved vs. Rejected Scans"
        subtitle="Vision verdict counts only — no confidence score exists"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="m8 12 2.5 2.5L16 9" />
          </svg>
        }
      >
        {scanOutcomes.status === "ready" && <ScanOutcomes outcomes={scanOutcomes.data} />}
        {scanOutcomes.status === "pending" && (
          <EmptyState
            message="Not yet available — pending scan-event logging."
            detail="The vision service does not persist individual approved or rejected verdicts yet, so there is no data to chart."
          />
        )}
        {scanOutcomes.status === "error" && <ErrorState message={scanOutcomes.message} />}
      </WidgetCard>

      <WidgetCard
        loading={tierSpend.status === "loading"}
        title="Tier 1 vs. Tier 2 Spend"
        subtitle="Allocated against spent, as reported by the server"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19V5M4 19h16" />
            <path d="m7 15 3-4 3 2 5-7" />
          </svg>
        }
      >
        {tierSpend.status === "ready" && <TierSpend spend={tierSpend.data} />}
        {tierSpend.status === "pending" && (
          <EmptyState
            message={tierSpend.message}
            detail="Grant amounts are owned by the server, so no tier chart is drawn until it responds."
          />
        )}
        {tierSpend.status === "error" && <ErrorState message={tierSpend.message} />}
      </WidgetCard>
    </div>
  );
}
