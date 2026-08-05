"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authFetch } from "@/lib/api";

/* ─────────────────────────────────────────────────────────
   MerchantRegistrationForm — mock 2.png (right card)
   Fields: Name of the Store, Name of the Owner,
   Phone Number (PH flag + "+63" prefix),
   Wallet Address (Stellar EVM 0x… — Freighter address),
   Create Password, Confirm Password.
   Submit → POST /api/merchants/register
   Success → calls onSuccess() to show verified toast.
   ───────────────────────────────────────────────────────── */

const formSchema = z
  .object({
    storeName: z.string().min(1, "Store name is required").max(200),
    ownerName: z.string().min(1, "Owner name is required").max(200),
    /* Phone: local digits only; we prepend +63 before submission */
    phoneLocal: z
      .string()
      .min(9, "Enter a valid Philippine phone number")
      .max(11)
      .regex(/^\d+$/, "Phone must be digits only"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof formSchema>;

interface MerchantRegistrationFormProps {
  onSuccess: () => void;
}

export function MerchantRegistrationForm({
  onSuccess,
}: MerchantRegistrationFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      storeName: "",
      ownerName: "",
      phoneLocal: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setApiError(null);

    /* Build E.164 phone number */
    const mobileNumberE164 = "+63" + values.phoneLocal.replace(/^0/, "");

    const payload = {
      storeName: values.storeName.trim(),
      ownerName: values.ownerName.trim(),
      mobileNumberE164,
      password: values.password,
    };

    try {
      const res = await authFetch("/api/merchants/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setApiError(body?.message ?? "Registration failed. Please try again.");
        return;
      }

      onSuccess();
      reset();
      setApiError(null);
    } catch {
      setApiError("Network error. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full border-2 rounded-xl px-4 py-3 text-sm text-brand-darkTeal placeholder:text-brand-darkTeal/30 outline-none transition-colors ${
      hasError
        ? "border-red-400"
        : "border-border-input focus:border-brand-activeTeal"
    }`;

  const labelClass =
    "block text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal mb-2";

  return (
    <div className="bg-bg-card rounded-2xl p-7 border border-border-input/30 shadow-sm h-full">
      {/* Card heading */}
      <div className="flex items-center gap-3 pb-4 border-b border-brand-sageBorder/20 mb-6">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-darkTeal/60 flex-shrink-0">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <h2 className="font-bold text-brand-darkTeal text-base">
          Register Merchant Unit
        </h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {/* Name of the Store */}
        <div>
          <label className={labelClass}>Name of the Store</label>
          <input
            type="text"
            placeholder="e.g., Aling Nena's Store"
            {...register("storeName")}
            className={inputClass(!!errors.storeName)}
          />
          {errors.storeName && (
            <p className="text-xs text-red-500 font-semibold mt-1">{errors.storeName.message}</p>
          )}
        </div>

        {/* Name of the Owner */}
        <div>
          <label className={labelClass}>Name of the Owner</label>
          <input
            type="text"
            placeholder="e.g., Trisha Ramiles"
            {...register("ownerName")}
            className={inputClass(!!errors.ownerName)}
          />
          {errors.ownerName && (
            <p className="text-xs text-red-500 font-semibold mt-1">{errors.ownerName.message}</p>
          )}
        </div>

        {/* Phone Number — PH flag + +63 prefix */}
        <div>
          <label className={labelClass}>Phone Number</label>
          <div className={`flex border-2 rounded-xl overflow-hidden transition-colors ${errors.phoneLocal ? "border-red-400" : "border-border-input focus-within:border-brand-activeTeal"}`}>
            {/* Flag + country code prefix pill */}
            <div className="flex items-center gap-2 px-3 py-3 bg-brand-peachBg/50 border-r border-border-input/40 flex-shrink-0">
              {/* PH flag emoji */}
              <span className="text-base">🇵🇭</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-darkTeal/40">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span className="text-sm font-bold text-brand-darkTeal">+63</span>
            </div>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="9171234567"
              {...register("phoneLocal")}
              className="flex-1 px-4 py-3 text-sm text-brand-darkTeal placeholder:text-brand-darkTeal/30 outline-none bg-transparent"
            />
          </div>
          {errors.phoneLocal && (
            <p className="text-xs text-red-500 font-semibold mt-1">{errors.phoneLocal.message}</p>
          )}
        </div>

        {/* Create Password + Confirm Password */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Create Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                {...register("password")}
                className={inputClass(!!errors.password) + " pr-10"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-darkTeal/30 hover:text-brand-darkTeal transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-red-500 font-semibold mt-1">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                {...register("confirmPassword")}
                className={inputClass(!!errors.confirmPassword) + " pr-10"}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-darkTeal/30 hover:text-brand-darkTeal transition-colors cursor-pointer"
              >
                {showConfirm ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-xs text-red-500 font-semibold mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>
        </div>

        {/* API error */}
        {apiError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 font-semibold">
            {apiError}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2.5 bg-brand-darkTeal hover:bg-brand-activeTeal text-white font-bold text-sm py-4 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer mt-2"
        >
          {submitting ? (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
          Onboard
        </button>
      </form>
    </div>
  );
}
