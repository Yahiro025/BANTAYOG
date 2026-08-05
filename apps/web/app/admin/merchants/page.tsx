"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { authFetch } from "@/lib/api";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { StatusBar } from "@/components/admin/status-bar";
import { TransactionsModal } from "@/components/admin/transactions-modal";
import { AdminPasswordModal } from "@/components/admin/admin-password-modal";
import { MetricCardSkeleton, RegistryPanelSkeleton } from "@/components/admin/skeleton";

/* ─────────────────────────────────────────────────────────
   Merchants Page — mock 10.png. Read-only merchant directory.

   Structure:
   1. StatusBar (same as beneficiaries page)
   2. Four metric cards (same shell — from API)
   3. TanStack Table — "Merchant Directory"
      Columns: Name of the Store | Store Owner | Phone Number | Status | Action
      Status pill: ACTIVE (coral outline) / INACTIVE (teal outline)
   4. Dot-indicator pagination
   ───────────────────────────────────────────────────────── */

interface MerchantRow {
  id: string;
  storeName: string;
  ownerName: string;
  mobileNumberE164: string;
  /** "APPROVED" maps to "ACTIVE", anything else to "INACTIVE" */
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
}

interface Metrics {
  totalBeneficiaries: number;
  criticalUnits: number;
  allocatedPhpc: string;
  verifiedMerchants: number;
}

const PAGE_SIZE = 5;

function describeListFailure(resource: string, result: PromiseSettledResult<Response>): string {
  if (result.status === "rejected") {
    return `${resource} could not be loaded because the API request failed before a response was received.`;
  }

  if (result.value.status === 401) {
    return `${resource} could not be loaded (HTTP 401). Sign in with an LGU admin account.`;
  }

  if (result.value.status === 403) {
    return `${resource} could not be loaded (HTTP 403). The current session is not an LGU admin.`;
  }

  if (result.value.status === 502) {
    return `${resource} could not be loaded (HTTP 502). Start the local API with pnpm dev.`;
  }

  return `${resource} could not be loaded (HTTP ${result.value.status}).`;
}

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [lguBalance, setLguBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  /* Modal state */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDetails, setModalDetails] = useState({
    title: "",
    subtitle: "",
    merchantId: "",
  });

  const [sudoModal, setSudoModal] = useState<{
    open: boolean;
    merchantId: string;
    status: "APPROVED" | "SUSPENDED";
    storeName: string;
  }>({ open: false, merchantId: "", status: "APPROVED", storeName: "" });

  /* Dropdown state */
  const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

  useEffect(() => {
    const handleGlobalClick = () => {
      setOpenMenuRowId(null);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  /* ── Data fetching ── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [merchantRes, metricsRes, balRes] = await Promise.allSettled([
        authFetch("/api/merchants"),
        authFetch("/api/beneficiaries/metrics"),
        authFetch("/api/chain/balance"),
      ]);

      if (merchantRes.status === "fulfilled" && merchantRes.value.ok) {
        const data = await merchantRes.value.json();
        const rows = Array.isArray(data) ? data : (data?.merchants ?? data?.data);
        if (Array.isArray(rows)) {
          setMerchants(rows);
        } else {
          setLoadError("Merchant registry returned an unexpected payload.");
        }
      } else {
        setLoadError(describeListFailure("Merchant registry", merchantRes));
      }

      if (metricsRes.status === "fulfilled" && metricsRes.value.ok) {
        const m = await metricsRes.value.json();
        setMetrics(m);
      }

      if (balRes.status === "fulfilled" && balRes.value.ok) {
        const b = await balRes.value.json();
        const parsed = parseFloat(b?.formatted ?? b?.balance ?? "0");
        setLguBalance(isNaN(parsed) ? 0 : parsed);
      }
    } catch (error) {
      console.error("[admin/merchants] Failed to load registry data.", error);
      setLoadError("Merchant registry could not be loaded. Check the local API server and your admin session.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ── Change Merchant Status ── */
  const handleStatusChange = (merchantId: string, status: "APPROVED" | "SUSPENDED") => {
    const m = merchants.find(x => x.id === merchantId);
    if (!m) return;
    setSudoModal({
      open: true,
      merchantId,
      status,
      storeName: m.storeName
    });
  };

  const executeStatusChange = async (password: string) => {
    try {
      const { merchantId, status } = sudoModal;
      const res = await authFetch(`/api/merchants/${merchantId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, password }),
      });
      if (res.ok) {
        setMerchants((prev) =>
          prev.map((m) => (m.id === merchantId ? { ...m, status } : m))
        );
        return true;
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body?.message ?? "Failed to update merchant status.");
        return false;
      }
    } catch {
      alert("Failed to update status due to network error.");
      return false;
    }
  };

  /* ── TanStack Table columns ── */
  const columns = useMemo<ColumnDef<MerchantRow>[]>(
    () => [
      {
        id: "storeName",
        accessorKey: "storeName",
        header: "NAME OF THE STORE",
        cell: ({ getValue }) => (
          <span className="font-bold text-brand-darkTeal text-sm">{String(getValue())}</span>
        ),
      },
      {
        id: "ownerName",
        accessorKey: "ownerName",
        header: "STORE OWNER",
        cell: ({ getValue }) => (
          <span className="text-brand-darkTeal/60 text-sm">{String(getValue())}</span>
        ),
      },
      {
        id: "mobileNumberE164",
        accessorKey: "mobileNumberE164",
        header: "PHONE NUMBER",
        cell: ({ getValue }) => {
          /* Format E.164 +639171234567 → XXXX-XXXX-XXX style */
          const raw = String(getValue());
          const local = raw.startsWith("+63") ? raw.slice(3) : raw;
          const fmt = local.replace(/(\d{4})(\d{4})(\d+)/, "$1 - $2 - $3");
          return (
            <span className="font-semibold text-brand-darkTeal text-sm tracking-wide">
              {fmt || raw}
            </span>
          );
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "STATUS",
        cell: ({ getValue }) => {
          const raw = getValue() as MerchantRow["status"];
          const isActive = raw === "APPROVED";
          return (
            <span
              className={`
                inline-flex items-center px-4 py-1.5 rounded-full text-xs font-bold
                border select-none tracking-wide
                ${isActive
                  ? "border-brand-coral text-brand-coral bg-brand-coral/5"
                  : "border-brand-activeTeal text-brand-activeTeal bg-brand-activeTeal/5"
                }
              `}
            >
              {isActive ? "ACTIVE" : "INACTIVE"}
            </span>
          );
        },
      },
      {
        id: "action",
        header: "ACTION",
        enableSorting: false,
        cell: ({ row }) => {
          const m = row.original;
          const isDropdownOpen = openMenuRowId === m.id;
          const formattedPhone = m.mobileNumberE164.startsWith("+63") ? m.mobileNumberE164.slice(3).replace(/(\d{4})(\d{4})(\d+)/, "$1 - $2 - $3") : m.mobileNumberE164;
          return (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setModalDetails({
                    title: m.storeName,
                    subtitle: `Owner's Name: ${m.ownerName} | Phone: ${formattedPhone}`,
                    merchantId: m.id,
                  });
                  setModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-brand-darkTeal/50 text-brand-darkTeal text-xs font-semibold hover:bg-brand-darkTeal hover:text-white transition-all cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                View Transactions
              </button>

              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuRowId(isDropdownOpen ? null : m.id);
                  }}
                  className="w-8 h-8 rounded-full border border-brand-sageBorder/40 hover:bg-brand-peachBg/30 flex items-center justify-center text-brand-darkTeal/60 hover:text-brand-darkTeal transition-all cursor-pointer font-bold text-xs"
                >
                  •••
                </button>
                
                {isDropdownOpen && (
                  <div className="absolute right-0 mt-1 z-10 w-28 bg-white border border-brand-sageBorder/30 rounded-xl shadow-lg py-1 animate-scale-in">
                    <button
                      onClick={() => handleStatusChange(m.id, "APPROVED")}
                      className="w-full text-left px-4 py-2 text-xs font-semibold text-brand-darkTeal hover:bg-brand-peachBg/40"
                    >
                      Set Active
                    </button>
                    <button
                      onClick={() => handleStatusChange(m.id, "SUSPENDED")}
                      className="w-full text-left px-4 py-2 text-xs font-semibold text-red-600 hover:bg-brand-peachBg/40"
                    >
                      Set Inactive
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        },
      },
    ],
    [openMenuRowId]
  );

  /* ── TanStack Table instance ── */
  const table = useReactTable({
    data: merchants,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <>
      <div className="space-y-5 animate-fade-in">
      {/* Status bar */}
      <StatusBar />

      {/* ── Metric cards — same shell as beneficiaries page ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          loading={loading}
          label="BENEFICIARIES ONBOARDED"
          value={metrics?.totalBeneficiaries ?? "—"}
          subtext="Live registry count"
          subtextColor="text-green-600"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand-darkTeal/40">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            </svg>
          }
        />
        <MetricCard
          loading={loading}
          label="CRITICAL 1000-DAY UNITS"
          value={metrics?.criticalUnits ?? "—"}
          subtext="Requires urgent intervention"
          subtextColor="text-brand-coral/70"
          valueColor="text-brand-coral"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand-coral/40">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          }
        />
        <MetricCard
          loading={loading}
          label="LGU TREASURY (MOCK PHPC)"
          value={
            lguBalance !== null
              ? `${lguBalance.toLocaleString("en-PH", { maximumFractionDigits: 0 })} PHPC`
              : "—"
          }
          subtext="On-chain Subsidy Fund Pool"
          subtextColor="text-brand-darkTeal/40"
          valueLarge
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand-darkTeal/40">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          }
        />
        <MetricCard
          loading={loading}
          label="VERIFIED MERCHANTS"
          value={metrics ? `${metrics.verifiedMerchants} Stores` : "—"}
          subtext="Secured via Stellar Testnet"
          subtextColor="text-brand-darkTeal/40"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand-darkTeal/40">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" />
            </svg>
          }
        />
      </div>

      {/* ── Merchant Directory table ── */}
      <div className="bg-white rounded-2xl border border-brand-sageBorder/30 shadow-sm overflow-hidden">
        {loading ? (
          <RegistryPanelSkeleton
            columns={columns.length}
            pillColumns={[3, 4]}
            rowClassName="px-6 py-4"
            tableMinWidthClassName="min-w-[640px]"
            ariaLabel="Loading merchant registry"
          />
        ) : (
          <>
        {/* Table header row */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-sageBorder/20">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-darkTeal/50">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <h2 className="font-bold text-brand-darkTeal text-sm">Merchant Directory</h2>
          </div>
          {/* Search */}
          <div className="relative w-64">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-darkTeal/30" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search name or ID..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border-2 border-brand-sageBorder/50 rounded-full text-brand-darkTeal placeholder:text-brand-darkTeal/30 outline-none focus:border-brand-activeTeal transition-colors bg-brand-peachBg/30"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="bg-brand-peachBg/40 border-b border-brand-sageBorder/20">
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                      className={`
                        px-6 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-brand-darkTeal/50
                        ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-brand-darkTeal transition-colors" : ""}
                      `}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc" && <span className="text-brand-activeTeal">▲</span>}
                        {header.column.getIsSorted() === "desc" && <span className="text-brand-activeTeal">▼</span>}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-brand-sageBorder/10">
              {loadError ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-4" role="alert">
                      <p className="max-w-xl text-sm text-red-700 font-semibold">{loadError}</p>
                      <button
                        type="button"
                        onClick={() => void fetchAll()}
                        className="rounded-full bg-brand-coral px-5 py-2.5 text-xs font-bold text-white transition-all duration-200 hover:bg-brand-coralHover cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-12 text-center">
                    <p className="text-sm text-brand-darkTeal/40 font-semibold">
                      {globalFilter ? `No results for "${globalFilter}"` : "No merchants registered yet."}
                    </p>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-brand-peachBg/20 transition-colors">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-6 py-4 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        </>
        )}

        {/* ── Dot-indicator pagination — matching mock 10.png ── */}
        {!loading && pageCount > 1 && (
          <div className="flex items-center justify-center gap-3 py-5 border-t border-brand-sageBorder/10">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="w-8 h-8 rounded-full border border-brand-sageBorder/40 flex items-center justify-center text-brand-darkTeal/50 hover:text-brand-darkTeal hover:bg-brand-peachBg transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Previous page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                onClick={() => table.setPageIndex(i)}
                className={`
                  rounded-full transition-all duration-200 cursor-pointer
                  ${i === pageIndex
                    ? "w-4 h-4 bg-brand-darkTeal"
                    : "w-2.5 h-2.5 bg-brand-sageBorder/50 hover:bg-brand-sageBorder"
                  }
                `}
                aria-label={`Go to page ${i + 1}`}
              />
            ))}
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="w-8 h-8 rounded-full border border-brand-sageBorder/40 flex items-center justify-center text-brand-darkTeal/50 hover:text-brand-darkTeal hover:bg-brand-peachBg transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Next page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      </div>

      {/* ── Modals (rendered outside animation wrapper to avoid stacking context trap) ── */}
      <TransactionsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalDetails.title}
        subtitle={modalDetails.subtitle}
        merchantId={modalDetails.merchantId}
      />
      <AdminPasswordModal
        open={sudoModal.open}
        onClose={() => setSudoModal((s) => ({ ...s, open: false }))}
        onConfirm={executeStatusChange}
        title="Verify Admin Action"
        description={`Please enter your admin password to change ${sudoModal.storeName}'s status to ${sudoModal.status === "APPROVED" ? "ACTIVE" : "INACTIVE"}.`}
      />
    </>
  );
}

/* ── Metric Card (identical to beneficiaries page) ── */
function MetricCard({
  label,
  value,
  subtext,
  subtextColor = "text-brand-darkTeal/40",
  icon,
  valueColor = "text-brand-darkTeal",
  valueLarge = false,
  loading = false,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  subtextColor?: string;
  icon?: React.ReactNode;
  valueColor?: string;
  valueLarge?: boolean;
  loading?: boolean;
}) {
  if (loading) return <MetricCardSkeleton />;

  return (
    <div className="bg-white rounded-2xl border border-brand-sageBorder/30 px-5 py-4 shadow-sm flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <p className="text-[9px] font-bold uppercase tracking-widest text-brand-darkTeal/40 leading-tight">
          {label}
        </p>
        {icon}
      </div>
      <p className={`font-black leading-tight ${valueColor} ${valueLarge ? "text-2xl" : "text-3xl"}`}>
        {value}
      </p>
      {subtext && (
        <p className={`text-[10px] font-semibold leading-tight ${subtextColor}`}>
          {subtext}
        </p>
      )}
    </div>
  );
}
