"use client";

import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Request failed");
        setLoading(false);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-emerald-400 uppercase">
            Check Your Inbox
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-emerald-500/60 via-emerald-500/20 to-transparent" />
        </div>
        <h1 className="text-3xl italic leading-tight text-white">
          Link sent.
        </h1>
        <p className="font-sans text-sm text-white/65 leading-relaxed">
          If an account exists for{" "}
          <strong className="text-white font-mono text-[13px]">{email}</strong>, a password-reset
          link is on its way. The link expires in 1 hour.
        </p>
        <Link
          href="/login"
          className="font-sans inline-block mt-2 text-sm text-white hover:text-red-400 underline underline-offset-4 transition-colors"
        >
          Back to sign in →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5 mb-2">
        <h1 className="text-3xl italic leading-tight text-white">
          Forgot password?
        </h1>
        <p className="font-sans text-sm text-white/55">
          Enter your email and we&apos;ll send you a link to reset it.
        </p>
      </div>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {error && (
        <div className="font-sans rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="font-sans w-full rounded-md bg-red-600 hover:bg-red-500 active:bg-red-700 text-white py-3 text-[11px] font-bold uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-red-900/30"
      >
        {loading ? "Sending…" : "Send Reset Link"}
      </button>

      <p className="font-sans text-sm text-white/55 text-center">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-white hover:text-red-400 underline underline-offset-4 transition-colors"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
