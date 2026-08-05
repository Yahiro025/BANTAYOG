"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/api";
import { TransactionsTableSkeleton } from "@/components/admin/skeleton";

interface TransactionItem {
  category: string;
  name: string;
  quantity: number;
  unitPricePhp: number;
  creditCost: number;
  imageUrl?: string;
}

interface Transaction {
  id: string;
  createdAt: string;
  totalCreditDeducted: number;
  items: TransactionItem[];
  beneficiary?: {
    childName: string;
    guardianName: string;
    cardSerial: string;
  };
  merchant?: {
    storeName: string;
    ownerName: string;
    mobileNumberE164: string;
  };
}

interface TransactionsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  merchantId?: string;
  beneficiaryId?: string;
}

const LIMIT = 5;

export function TransactionsModal({
  open,
  onClose,
  title,
  subtitle,
  merchantId,
  beneficiaryId,
}: TransactionsModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (currentPage: number) => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/transactions?limit=${LIMIT}&page=${currentPage}`;
      if (merchantId) url += `&merchantId=${merchantId}`;
      if (beneficiaryId) url += `&beneficiaryId=${beneficiaryId}`;

      const res = await authFetch(url);
      if (!res.ok) {
        throw new Error("Failed to load transaction history");
      }
      const result = await res.json();
      setTransactions(result.data || []);
      setTotalCount(result.count || 0);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [merchantId, beneficiaryId]);

  useEffect(() => {
    if (open) {
      setPage(1);
      fetchTransactions(1);
    }
  }, [open, fetchTransactions]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchTransactions(newPage);
  };

  if (!open) return null;

  const totalPages = Math.ceil(totalCount / LIMIT);
  const startIdx = (page - 1) * LIMIT + 1;
  const endIdx = Math.min(page * LIMIT, totalCount);

  // Helper to render beautiful product SVGs based on name
  const renderProductIcon = (name: string) => {
    const strokeColor = "#034C52";
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes("rice")) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="1.5">
          <path d="M6 3h12l3 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10l3-7z" />
          <path d="M12 3v20M3 10h18" strokeOpacity="0.2" />
        </svg>
      );
    }
    if (lowerName.includes("egg")) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="1.5">
          <ellipse cx="12" cy="12" rx="7" ry="9" />
          <path d="M12 3v18M5 12h14" strokeOpacity="0.2" />
        </svg>
      );
    }
    if (lowerName.includes("oil")) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="1.5">
          <path d="M8 2h8v3H8zM6 5h12v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5z" />
          <path d="M10 10h4v6h-4z" />
        </svg>
      );
    }
    if (lowerName.includes("milk")) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="1.5">
          <path d="M9 2h6v3H9zM7 5h10v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5z" />
          <circle cx="12" cy="13" r="2.5" />
        </svg>
      );
    }
    if (lowerName.includes("tuna") || lowerName.includes("fish")) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="1.5">
          <path d="M2 12s3-4 8-4 8 4 8 4-3 4-8 4-8-4-8-4z" />
          <path d="M22 8l-3 4 3 4V8z" />
        </svg>
      );
    }
    // Generic fallback icon
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="1.5">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6M9 13h6M9 17h3" strokeOpacity="0.5" />
      </svg>
    );
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      const formattedDate = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const formattedTime = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      return { date: formattedDate, time: formattedTime };
    } catch {
      return { date: isoStr, time: "" };
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal card - wide screen layout matching mockup */}
      <div className="relative w-[92vw] max-w-[1200px] h-[85vh] bg-white rounded-[2rem] shadow-xl overflow-hidden flex flex-col animate-scale-in border border-brand-sageBorder/50">
        
        {/* Header */}
        <div className="px-10 pt-8 pb-5 flex justify-between items-start">
          <div>
            <h3 className="font-body text-[22px] font-bold text-brand-darkTeal">
              Transaction History - {title}
            </h3>
            <p className="text-[13px] font-semibold text-brand-darkTeal/60 mt-1.5 font-body flex items-center gap-1.5">
              {subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors text-brand-darkTeal/70 cursor-pointer flex-shrink-0"
            aria-label="Close modal"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-10 pb-6 flex flex-col">
          {loading ? (
            <div className="flex-1 py-2">
              <TransactionsTableSkeleton />
            </div>
          ) : error ? (
            <div className="text-center py-12 flex-1 flex items-center justify-center">
              <p className="text-red-500 font-medium text-sm font-body">{error}</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16 text-brand-darkTeal/40 text-sm font-medium font-body flex-1 flex items-center justify-center">
              No transactions recorded.
            </div>
          ) : (
            <div className="w-full flex-1 flex flex-col">
              
              {/* Header Titles - Light Grey background pill spanning entire width */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3.5 bg-[#ECEFF1] rounded-xl text-[11px] font-bold text-brand-darkTeal/60 uppercase tracking-wider font-body mb-2 flex-shrink-0">
                <div className="col-span-2">Date & Time</div>
                <div className="col-span-3">{merchantId ? "Beneficiary" : "Merchant"}</div>
                <div className="col-span-4">Product</div>
                <div className="col-span-1 text-center">Quantity</div>
                <div className="col-span-2 text-right">Price (PHPC)</div>
              </div>

              {/* Transactions List */}
              <div className="divide-y divide-gray-200 flex-1">
                {transactions.map((tx) => {
                  const { date, time } = formatDate(tx.createdAt);
                  return (
                    <div key={tx.id} className="py-5">
                      <div className="grid grid-cols-12 gap-4 items-start">
                        
                        {/* Date & Time */}
                        <div className="col-span-2 text-xs font-semibold text-brand-darkTeal leading-relaxed font-body">
                          <p className="font-bold text-brand-darkTeal">{date}</p>
                          <p className="text-brand-activeTeal font-medium text-[11px] mt-0.5">{time}</p>
                        </div>

                        {/* Beneficiary/Merchant */}
                        <div className="col-span-3 font-body">
                          {merchantId ? (
                            tx.beneficiary ? (
                              <div>
                                <p className="text-xs font-bold text-brand-darkTeal">
                                  {tx.beneficiary.childName}
                                </p>
                                <p className="text-[10px] font-semibold text-brand-darkTeal/50 font-mono mt-0.5">
                                  {tx.beneficiary.cardSerial}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )
                          ) : (
                            tx.merchant ? (
                              <div>
                                <p className="text-xs font-bold text-brand-darkTeal">
                                  {tx.merchant.storeName}
                                </p>
                                <p className="text-[10px] font-semibold text-brand-darkTeal/50 mt-0.5">
                                  {tx.merchant.ownerName}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )
                          )}
                        </div>

                        {/* Products block */}
                        <div className="col-span-7 space-y-5">
                          {tx.items.map((item, idx) => {
                            return (
                              <div key={idx} className="grid grid-cols-7 gap-4 items-center">
                                {/* Product Info */}
                                <div className="col-span-4 flex items-center gap-4.5 font-body">
                                  <div className="w-12 h-12 rounded-xl bg-brand-peachBg/40 border border-brand-sageBorder/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                    {item.imageUrl ? (
                                      <img
                                        src={item.imageUrl}
                                        alt={item.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      renderProductIcon(item.name)
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-bold text-brand-darkTeal truncate">
                                      {item.name}
                                    </p>
                                    <p className="text-[10.5px] text-brand-darkTeal/50 mt-0.5 truncate font-medium">
                                      {item.category?.replace("_", " ")}
                                    </p>
                                  </div>
                                </div>

                                {/* Quantity */}
                                <div className="col-span-1 text-center text-[13px] font-bold text-brand-darkTeal font-body">
                                  {item.quantity}
                                </div>

                                {/* Price */}
                                <div className="col-span-2 text-right text-[13px] font-bold text-brand-darkTeal font-body">
                                  {item.creditCost.toLocaleString()} PHPC
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Subtotal row */}
                      <div className="flex justify-end pr-0 mt-3 font-body">
                        <p className="text-xs font-bold text-brand-darkTeal/50 uppercase tracking-wider">
                          Subtotal: <span className="text-brand-darkTeal font-extrabold text-[14px] ml-1">{tx.totalCreditDeducted.toLocaleString()} PHPC</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Pagination */}
        {!loading && !error && totalCount > 0 && (
          <div className="px-10 py-5 border-t border-gray-100 flex items-center justify-between bg-brand-peachBg/10 font-body flex-shrink-0">
            <span className="text-[11px] font-semibold text-brand-darkTeal/40">
              Showing {startIdx} to {endIdx} of {totalCount} transactions
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-brand-sageBorder/50 text-brand-darkTeal hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {Array.from({ length: totalPages }).map((_, idx) => {
                const pNum = idx + 1;
                const isSelected = pNum === page;
                return (
                  <button
                    key={pNum}
                    onClick={() => handlePageChange(pNum)}
                    className={`w-7 h-7 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? "bg-brand-darkTeal text-white shadow-sm"
                        : "text-brand-darkTeal/60 hover:bg-white hover:text-brand-darkTeal border border-transparent hover:border-brand-sageBorder/50"
                    }`}
                  >
                    {pNum}
                  </button>
                );
              })}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-brand-sageBorder/50 text-brand-darkTeal hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

