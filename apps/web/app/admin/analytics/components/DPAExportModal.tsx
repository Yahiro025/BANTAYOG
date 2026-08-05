"use client";

import { useState } from "react";
import {
  DpaExportCsvHeaders,
  DpaExportJsonResponseDto,
  DpaExportRequestDto,
  type DpaExportFormat,
} from "@bantayog/schema/analytics";
import { authFetch } from "@/lib/api";

/* ─────────────────────────────────────────────────────────
   DPA-Compliant Export — district-level aggregates only.

   The server is responsible for stripping personal data before it responds.
   This modal only VERIFIES the shape it receives and refuses the download when
   the payload steps outside the anonymised contract. It deliberately does not
   filter or redact anything: client-side filtering is not a substitute for
   server-side stripping, and a payload containing PII is a backend bug that has
   to be reported, not quietly cleaned up.
   ───────────────────────────────────────────────────────── */

interface DPAExportModalProps {
  open: boolean;
  /** Reporting window in days, shared with the rest of the analytics page. */
  days: number;
  onClose: () => void;
}

type MessageTone = "pending" | "error" | "success";

/** True when the CSV header line matches the anonymised contract exactly. */
function hasAllowedCsvHeader(csv: string): boolean {
  const firstLine = csv.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]?.trim();
  return firstLine === DpaExportCsvHeaders.join(",");
}

function downloadFile(content: string, filename: string, type: string) {
  const objectUrl = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function DPAExportModal({ open, days, onClose }: DPAExportModalProps) {
  const [format, setFormat] = useState<DpaExportFormat>("csv");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<MessageTone>("pending");

  if (!open) return null;

  const report = (text: string, messageTone: MessageTone) => {
    setMessage(text);
    setTone(messageTone);
  };

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);

    try {
      const request = DpaExportRequestDto.safeParse({ format, days });
      if (!request.success) {
        report("That export request is not valid.", "error");
        return;
      }

      const response = await authFetch("/api/analytics/dpa-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
      });

      if (response.status === 404 || response.status === 501) {
        report("Not yet available — the export route is not implemented yet.", "pending");
        return;
      }

      if (!response.ok) {
        report("The server could not prepare this export. Nothing was downloaded.", "error");
        return;
      }

      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();

      if (request.data.format === "json") {
        if (contentType !== "application/json") {
          report("The server returned the wrong format. Nothing was downloaded.", "error");
          return;
        }

        const parsed = DpaExportJsonResponseDto.safeParse(await response.json());
        if (!parsed.success) {
          report(
            "Export refused: the payload contains fields outside the anonymised contract. Report this as a backend bug.",
            "error",
          );
          return;
        }

        downloadFile(
          JSON.stringify(parsed.data, null, 2),
          `bantayog-anonymised-consumption-${days}d.json`,
          "application/json",
        );
      } else {
        if (contentType !== "text/csv") {
          report("The server returned the wrong format. Nothing was downloaded.", "error");
          return;
        }

        const csv = await response.text();
        if (!hasAllowedCsvHeader(csv)) {
          report(
            "Export refused: the CSV header does not match the anonymised contract. Report this as a backend bug.",
            "error",
          );
          return;
        }

        downloadFile(csv, `bantayog-anonymised-consumption-${days}d.csv`, "text/csv");
      }

      report("Export downloaded. It holds district-level aggregates only.", "success");
    } catch {
      report("The export service could not be reached. Check the connection.", "error");
    } finally {
      setBusy(false);
    }
  };

  const toneClass =
    tone === "success"
      ? "border-green-300 bg-green-50 text-green-800"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-brand-sageBorder/50 bg-brand-sageBg/25 text-brand-darkTeal";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "rgba(3,62,57,0.25)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dpa-export-title"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header (dark teal) ── */}
        <div className="rounded-t-[1.75rem] bg-brand-darkTeal px-8 pt-7 pb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest">Anonymised data</p>
              <h2 id="dpa-export-title" className="text-white font-black text-3xl mt-1 leading-tight">
                DPA Export
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 cursor-pointer flex-shrink-0"
              aria-label="Close DPA export dialog"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <p className="text-white/70 text-xs leading-relaxed mt-3">
            District-level consumption aggregates for the selected period, produced by a server-side anonymised query.
          </p>
        </div>

        {/* ── Body (white) ── */}
        <div className="rounded-b-[1.75rem] bg-white px-8 pt-6 pb-7 space-y-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal/40 mb-2">File format</p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Export file format">
              {(["csv", "json"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFormat(option)}
                  aria-pressed={format === option}
                  className={`
                    rounded-full border px-4 py-2.5 text-xs font-bold uppercase tracking-wider
                    transition-all duration-200 cursor-pointer
                    ${format === option
                      ? "border-brand-activeTeal bg-brand-sageBg/40 text-brand-activeTeal"
                      : "border-brand-sageBorder/60 text-brand-darkTeal/60 hover:bg-brand-peachBg/40"
                    }
                  `}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-brand-sageBorder/50 bg-brand-peachBg/30 px-4 py-3 space-y-1.5">
            <p className="text-xs font-bold text-brand-darkTeal">Period: last {days} days</p>
            <p className="text-[11px] text-brand-darkTeal/60 leading-relaxed">
              Columns: {DpaExportCsvHeaders.join(", ")}.
            </p>
            <p className="text-[11px] text-brand-darkTeal/60 leading-relaxed">
              No name, coordinate, or ungrouped age is part of this contract. A payload outside it is refused, not
              cleaned up.
            </p>
          </div>

          {message && (
            <div className={`rounded-xl border px-4 py-3 text-xs font-semibold leading-relaxed ${toneClass}`} role="status">
              {message}
            </div>
          )}

          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="w-full rounded-full bg-button-coral text-white font-bold text-sm py-3.5 hover:opacity-90 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Preparing export…" : "Download export"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full bg-button-cancel-bg text-button-coral font-bold text-sm py-3.5 hover:bg-brand-peachBg/50 transition-all duration-200 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
