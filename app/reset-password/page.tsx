"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Token presence is the bare-minimum precondition. Validity (still active,
  // not expired) is checked server-side on submit.
  if (!token) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-rose-400 uppercase">
            Invalid Link
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-rose-500/60 via-rose-500/20 to-transparent" />
        </div>
        <h1 className="text-3xl italic leading-tight text-white">
          Missing reset token.
        </h1>
        <p className="font-sans text-sm text-white/65 leading-relaxed">
          This page should be opened from the link in your password-reset email.
        </p>
        <Link
          href="/forgot-password"
          className="font-sans inline-block mt-2 text-sm text-white hover:text-red-400 underline underline-offset-4 transition-colors"
        >
          Request a new link →
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Reset failed");
        setLoading(false);
        return;
      }
      setDone(true);
      // Brief celebration moment, then push to login.
      setTimeout(() => router.push("/login"), 1800);
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
            Password Updated
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-emerald-500/60 via-emerald-500/20 to-transparent" />
        </div>
        <h1 className="text-3xl italic leading-tight text-white">
          You&apos;re all set.
        </h1>
        <p className="font-sans text-sm text-white/65 leading-relaxed">
          Sign in with your new password. Redirecting…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5 mb-2">
        <h1 className="text-3xl italic leading-tight text-white">
          Set a new password.
        </h1>
        <p className="font-sans text-sm text-white/55">
          Choose something strong — at least 8 characters.
        </p>
      </div>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          New password
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          placeholder="At least 8 characters"
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Confirm password
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Re-enter the password"
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
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
        {loading ? "Updating…" : "Set New Password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
