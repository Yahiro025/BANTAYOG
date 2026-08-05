"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  AnalyticsChainBalanceDto,
  AnalyticsSecurityEventsDto,
  AnalyticsVisionPerformanceDto,
  PaginatedAnalyticsMerchantSummaryDto,
  PaginatedAnalyticsTransactionSummaryDto,
  type AnalyticsChainBalance,
  type AnalyticsMerchantSummary,
  type AnalyticsSecurityEvents,
  type AnalyticsTransactionSummary,
  type AnalyticsVisionPerformance,
} from "@bantayog/schema/analytics";
import { authFetch } from "@/lib/api";
import { PanelCardSkeleton } from "@/components/admin/skeleton";

/* ─────────────────────────────────────────────────────────
   Section B — Merchant & System Performance.

   All widgets read privacy-safe projections or server-owned Redis counters.
   Missing optional metrics resolve to their true zero state rather than
   showing fabricated values.

   The aggregation here is display-only (sums and counts for charting). No
   eligibility, tier, balance, or settlement decision is made client-side.
   ───────────────────────────────────────────────────────── */

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "pending"; message: string }
  | { status: "error"; message: string };

type DailyVolume = { date: string; amountCents: bigint; transactionCount: number };

const PAGE_SIZE = 100;
/** Hard ceiling so a wrong `count` can never spin the browser. */
const MAX_PAGES = 50;
/** Redis counters are cheap to read, so they refresh far more often than the rest. */
const SECURITY_POLL_MS = 45_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
        message: `This system data could not be loaded (HTTP ${response.status}). Try again later.`,
      };
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      /* A strict-schema failure also covers the privacy case: if the server ever
         adds an identity field to a summary row, the payload is rejected here
         instead of being rendered. */
      return { status: "error", message: "The server returned an unexpected or unsafe payload." };
    }

    return { status: "ready", data: parsed.data };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[analytics] ${path} request failed before a response was received.`, error);
    }
    return { status: "error", message: "The API could not be reached. Check the connection." };
  }
}

/** Walks every page of a paginated endpoint, refusing to truncate silently. */
async function requestAllPages<T>(
  buildPath: (page: number) => string,
  schema: z.ZodType<{ data: T[]; count: number }>,
): Promise<LoadState<T[]>> {
  const rows: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await requestJson(buildPath(page), schema);
    if (result.status !== "ready") return result;

    rows.push(...result.data.data);

    if (result.data.data.length === 0 || rows.length >= result.data.count) {
      return { status: "ready", data: rows };
    }
  }

  return {
    status: "error",
    message: "There are too many records to summarise in the browser. A server-side aggregate is required.",
  };
}

/* ── Exact money helpers: PHP has 2 decimals, so totals accumulate as integer
      centavos in bigint. No float ever touches a credit total. ── */

function decimalToCents(amount: number): bigint {
  const [whole, fraction = ""] = amount.toFixed(2).split(".");
  const negative = whole.startsWith("-");
  const unsignedWhole = negative ? whole.slice(1) : whole;
  const cents = BigInt(unsignedWhole) * 100n + BigInt(fraction);
  return negative ? -cents : cents;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${groupThousands(whole)}.${fraction} PHPC`;
}

/** Formats the decimal string that `/api/chain/balance` returns, without parsing it to a float. */
function formatDecimalString(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const negative = whole.startsWith("-");
  const unsignedWhole = (negative ? whole.slice(1) : whole) || "0";
  const trimmed = fraction.slice(0, 2).padEnd(2, "0");
  return `${negative ? "-" : ""}${groupThousands(unsignedWhole)}.${trimmed} PHPC`;
}

/* ── Widget shell ── */
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
        <PanelCardSkeleton ariaLabel="Loading system data" />
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

function MetricTile({
  label,
  value,
  caption,
  tone = "sage",
  valueClass = "text-brand-darkTeal",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "sage" | "peach" | "coral";
  valueClass?: string;
}) {
  const toneClass =
    tone === "coral" ? "bg-brand-coral/10" : tone === "peach" ? "bg-brand-peachBg/50" : "bg-brand-sageBg/30";

  return (
    <div className={`rounded-xl px-4 py-3 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal/40 leading-tight">{label}</p>
      <p className={`text-xl font-black mt-1 leading-tight ${valueClass}`}>{value}</p>
      {caption && <p className="text-[10px] font-semibold text-brand-darkTeal/40 mt-1 leading-tight">{caption}</p>}
    </div>
  );
}

/* ── Widget: AI vision performance (pending backend telemetry) ── */
function VisionPerformance({ performance }: { performance: LoadState<AnalyticsVisionPerformance> }) {
  if (performance.status === "loading") return null;
  if (performance.status === "error") return <ErrorState message={performance.message} />;
  if (performance.status === "pending") {
    return (
      <EmptyState
        message="Not yet available — pending vision telemetry."
        detail="Scan latency and success rate are not persisted yet. No confidence-score chart is shown, because the Gemini response has no confidence field."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <MetricTile
        label="Average latency"
        value={`${performance.data.avgLatencyMs.toLocaleString("en-PH", { maximumFractionDigits: 0 })} ms`}
      />
      <MetricTile
        label="Success rate"
        value={`${(performance.data.successRate * 100).toFixed(1)}%`}
        tone="peach"
        valueClass="text-brand-activeTeal"
      />
    </div>
  );
}

/* ── Widget: settlement throughput (existing endpoints) ── */
function SettlementChart({ volumes }: { volumes: DailyVolume[] }) {
  const maxAmount = volumes.reduce((max, volume) => (volume.amountCents > max ? volume.amountCents : max), 1n);

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1.5 h-32 border-b border-brand-sageBorder/40 pb-1">
        {volumes.map((volume) => {
          const heightPercent = Number((volume.amountCents * 100n) / maxAmount);
          return (
            <div
              key={volume.date}
              className="flex-1 min-w-0 h-full flex flex-col justify-end"
              title={`${volume.date}: ${formatCents(volume.amountCents)} across ${volume.transactionCount} settlement(s)`}
            >
              <div
                className="w-full rounded-t-lg bg-brand-activeTeal transition-all duration-200"
                style={{ height: `${Math.max(heightPercent, 2)}%` }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-[10px] font-semibold text-brand-darkTeal/40">
        {volumes.length.toLocaleString("en-PH")} day(s) with on-chain settlement · bar height follows PHPC volume
      </p>
    </div>
  );
}

function SettlementThroughput({
  transactions,
  chainBalance,
  days,
}: {
  transactions: LoadState<AnalyticsTransactionSummary[]>;
  chainBalance: LoadState<AnalyticsChainBalance>;
  days: number;
}) {
  const volumes = useMemo<DailyVolume[]>(() => {
    if (transactions.status !== "ready") return [];

    const cutoff = Date.now() - days * DAY_MS;
    const byDate = new Map<string, DailyVolume>();

    for (const transaction of transactions.data) {
      /* `onchain_tx_hash` is what marks a row as actually settled on Polygon Amoy. */
      if (!transaction.onchainTxHash) continue;

      const createdAt = Date.parse(transaction.createdAt);
      if (!Number.isFinite(createdAt) || createdAt < cutoff) continue;

      const date = transaction.createdAt.slice(0, 10);
      const current = byDate.get(date) ?? { date, amountCents: 0n, transactionCount: 0 };
      current.amountCents += decimalToCents(transaction.totalCreditDeducted);
      current.transactionCount += 1;
      byDate.set(date, current);
    }

    return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
  }, [days, transactions]);

  if (transactions.status === "loading" || chainBalance.status === "loading") return null;
  if (transactions.status === "error") return <ErrorState message={transactions.message} />;
  if (chainBalance.status === "error") return <ErrorState message={chainBalance.message} />;
  if (transactions.status === "pending") return <EmptyState message={transactions.message} />;
  if (chainBalance.status === "pending") return <EmptyState message={chainBalance.message} />;

  const totalCents = volumes.reduce((sum, volume) => sum + volume.amountCents, 0n);
  const settledCount = volumes.reduce((sum, volume) => sum + volume.transactionCount, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="Settled volume"
          value={settledCount > 0 ? formatCents(totalCents) : "None"}
          caption={`last ${days} days`}
        />
        <MetricTile
          label="On-chain records"
          value={settledCount.toLocaleString("en-PH")}
          tone="peach"
          valueClass="text-brand-activeTeal"
          caption="confirmed with a tx hash"
        />
      </div>

      <MetricTile
        label="LGU treasury balance"
        value={formatDecimalString(chainBalance.data.formatted)}
        caption="read from Polygon Amoy"
      />

      {volumes.length > 0 ? (
        <SettlementChart volumes={volumes} />
      ) : (
        <EmptyState
          message="No transaction has been settled on-chain in this period."
          detail="Off-chain confirmed sales are reconciled to Polygon Amoy by the reconcile job and at merchant cash-out."
        />
      )}
    </div>
  );
}

/* ── Widget: active sari-sari stores (existing endpoints) ── */
function ActiveStores({
  merchants,
  transactions,
}: {
  merchants: LoadState<AnalyticsMerchantSummary[]>;
  transactions: LoadState<AnalyticsTransactionSummary[]>;
}) {
  if (merchants.status === "loading" || transactions.status === "loading") return null;
  if (merchants.status === "error") return <ErrorState message={merchants.message} />;
  if (transactions.status === "error") return <ErrorState message={transactions.message} />;
  if (merchants.status === "pending") return <EmptyState message={merchants.message} />;
  if (transactions.status === "pending") return <EmptyState message={transactions.message} />;

  const activeMerchantIds = new Set(
    merchants.data.filter((merchant) => merchant.status === "APPROVED").map((merchant) => merchant.id),
  );

  /* Average volume per store needs the join against transactions; it cannot be
     derived from the merchant list alone. */
  const joinedCount = transactions.data.filter((transaction) => activeMerchantIds.has(transaction.merchantId)).length;
  const averagePerStore = activeMerchantIds.size > 0 ? joinedCount / activeMerchantIds.size : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="Active stores"
          value={activeMerchantIds.size.toLocaleString("en-PH")}
          valueClass="text-brand-activeTeal"
          caption="APPROVED in the directory"
        />
        <MetricTile
          label="Average volume"
          value={averagePerStore === null ? "—" : averagePerStore.toFixed(1)}
          tone="peach"
          caption="confirmed sales per store"
        />
      </div>
      <p className="text-[11px] text-brand-darkTeal/55 leading-relaxed">
        Store identities stay on the server: this widget reads only merchant IDs and statuses.
      </p>
    </div>
  );
}

/* ── Widget: PIN lockout & security alerts (pending backend proxy) ── */
function SecurityEvents({ events }: { events: LoadState<AnalyticsSecurityEvents> }) {
  if (events.status === "loading") return null;
  if (events.status === "error") return <ErrorState message={events.message} />;
  if (events.status === "pending") {
    return (
      <EmptyState
        message="Not yet available — pending security-event proxy."
        detail="PIN attempt and lockout counters live in the Upstash Redis sliding windows and are not exposed by an endpoint yet."
      />
    );
  }

  if (events.data.pinAttempts === 0 && events.data.lockouts === 0) {
    return <EmptyState message="No PIN security event in the current observation window." />;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <MetricTile label="PIN attempts" value={events.data.pinAttempts.toLocaleString("en-PH")} />
      <MetricTile
        label="Lockouts"
        value={events.data.lockouts.toLocaleString("en-PH")}
        tone="coral"
        valueClass="text-brand-coral"
      />
    </div>
  );
}

export function SystemHealthMetrics({ days }: { days: number }) {
  const [transactions, setTransactions] = useState<LoadState<AnalyticsTransactionSummary[]>>({ status: "loading" });
  const [merchants, setMerchants] = useState<LoadState<AnalyticsMerchantSummary[]>>({ status: "loading" });
  const [chainBalance, setChainBalance] = useState<LoadState<AnalyticsChainBalance>>({ status: "loading" });
  const [visionPerformance, setVisionPerformance] = useState<LoadState<AnalyticsVisionPerformance>>({ status: "loading" });
  const [securityEvents, setSecurityEvents] = useState<LoadState<AnalyticsSecurityEvents>>({ status: "loading" });

  const loadExistingEndpoints = useCallback(async () => {
    setTransactions({ status: "loading" });
    setMerchants({ status: "loading" });
    setChainBalance({ status: "loading" });

    const [transactionResult, merchantResult, balanceResult] = await Promise.all([
      requestAllPages(
        (page) => `/api/transactions?summary=1&status=CONFIRMED&page=${page}&limit=${PAGE_SIZE}`,
        PaginatedAnalyticsTransactionSummaryDto,
      ),
      requestAllPages(
        (page) => `/api/merchants?summary=1&page=${page}&limit=${PAGE_SIZE}`,
        PaginatedAnalyticsMerchantSummaryDto,
      ),
      requestJson("/api/chain/balance", AnalyticsChainBalanceDto),
    ]);

    setTransactions(transactionResult);
    setMerchants(merchantResult);
    setChainBalance(balanceResult);
  }, []);

  const loadVisionPerformance = useCallback(async () => {
    setVisionPerformance(await requestJson("/api/analytics/vision-performance", AnalyticsVisionPerformanceDto));
  }, []);

  const loadSecurityEvents = useCallback(async () => {
    setSecurityEvents(await requestJson("/api/analytics/security-events", AnalyticsSecurityEventsDto));
  }, []);

  useEffect(() => {
    void loadExistingEndpoints();
  }, [loadExistingEndpoints]);

  useEffect(() => {
    void loadVisionPerformance();
  }, [loadVisionPerformance]);

  useEffect(() => {
    void loadSecurityEvents();
    const intervalId = window.setInterval(() => {
      void loadSecurityEvents();
    }, SECURITY_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadSecurityEvents]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <WidgetCard
        loading={visionPerformance.status === "loading"}
        title="AI Vision Performance"
        subtitle="Latency and success rate only"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        }
      >
        <VisionPerformance performance={visionPerformance} />
      </WidgetCard>

      <WidgetCard
        loading={transactions.status === "loading" || chainBalance.status === "loading"}
        title="Settlement Throughput"
        subtitle={`Daily PHPC settled on Polygon Amoy, last ${days} days`}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1" y="4" width="22" height="16" rx="2" />
            <path d="M1 10h22" />
          </svg>
        }
      >
        <SettlementThroughput transactions={transactions} chainBalance={chainBalance} days={days} />
      </WidgetCard>

      <WidgetCard
        loading={merchants.status === "loading" || transactions.status === "loading"}
        title="Active Sari-Sari Stores"
        subtitle="Approved merchants joined to confirmed sales"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <path d="M3 6h18M9 22v-6h6v6" />
          </svg>
        }
      >
        <ActiveStores merchants={merchants} transactions={transactions} />
      </WidgetCard>

      <WidgetCard
        loading={securityEvents.status === "loading"}
        title="PIN Lockout & Security Alerts"
        subtitle="Redis counters, refreshed every 45 seconds"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
          </svg>
        }
      >
        <SecurityEvents events={securityEvents} />
      </WidgetCard>
    </div>
  );
}
