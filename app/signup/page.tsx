"use client";

import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";

function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Signup failed");
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
          Almost there.
        </h1>
        <p className="font-sans text-sm text-white/65 leading-relaxed">
          We sent a verification link to{" "}
          <strong className="text-white font-mono text-[13px]">{email}</strong>. Click it to
          activate your account, then sign in.
        </p>
        <Link
          href="/login"
          className="font-sans inline-block mt-2 text-sm text-white hover:text-red-400 underline underline-offset-4 transition-colors"
        >
          Go to sign in →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Password
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="font-sans text-[11px] text-white/40 mt-1.5 block">Minimum 8 characters.</span>
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
        {loading ? "Creating…" : "Create Account & Commit"}
      </button>

      <p className="font-sans text-sm text-white/55 text-center">
        Have an account?{" "}
        <Link
          href="/login"
          className="text-white hover:text-red-400 underline underline-offset-4 transition-colors"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
