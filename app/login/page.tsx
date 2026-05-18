"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";

/**
 * Sanitize the `next` URL param. Only accept same-site absolute paths to
 * prevent an open-redirect via `?next=https://evil.com`. A protocol-
 * relative URL (`//evil.com`) is also a same-site path syntactically, so
 * reject those too.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }
      // Hard navigation (not router.push) so the browser fully commits the
      // Set-Cookie from the response before the next request hits middleware.
      // Client-side routing had a race window where the cookie wasn't yet
      // visible to the middleware re-check, leaving the form stuck in
      // "Signing in…" with no way out other than a manual refresh.
      window.location.href = next;
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
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
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
            Password
          </span>
          <Link
            href="/forgot-password"
            className="font-sans text-[11px] text-white/50 hover:text-red-400 hover:underline underline-offset-2 transition-colors"
          >
            Forgot?
          </Link>
        </div>
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {loading ? "Signing in…" : "Sign in & Commit"}
      </button>

      <p className="font-sans text-sm text-white/55 text-center">
        No account?{" "}
        <Link
          href="/signup"
          className="text-white hover:text-red-400 underline underline-offset-4 transition-colors"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
