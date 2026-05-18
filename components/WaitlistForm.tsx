"use client";

import { useState } from "react";

const EXPERIENCE_LEVELS = [
  "Beginner (< 1 year)",
  "Intermediate (1–3 years)",
  "Advanced (3+ years)",
  "Professional / institutional",
];

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [whyInterested, setWhyInterested] = useState("");
  const [tradingExperience, setTradingExperience] = useState(EXPERIENCE_LEVELS[1]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          fullName,
          whyInterested,
          tradingExperience,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Submission failed. Please try again.");
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
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-400/15" />
          <h3 className="text-xl font-bold tracking-tight text-white">You&apos;re on the waitlist.</h3>
        </div>
        <p className="text-sm text-white/70 leading-relaxed">
          Thanks for applying. We review every signup individually — when your
          invitation is ready, you&apos;ll get an email at{" "}
          <strong className="text-white font-mono text-[13px]">{email}</strong>{" "}
          with a one-time link to set your password and sign in.
        </p>
        <p className="text-sm text-white/55">
          In the meantime, you can read our public explainers on{" "}
          <a href="/learn/0dte-options" className="text-white underline underline-offset-4 hover:text-red-400">0DTE options</a>,{" "}
          <a href="/learn/max-pain" className="text-white underline underline-offset-4 hover:text-red-400">Max Pain</a>, and{" "}
          <a href="/learn/gamma-exposure" className="text-white underline underline-offset-4 hover:text-red-400">Gamma Exposure</a>.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-white/15 bg-white/[0.02] p-6 space-y-4"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
            Join the Waitlist
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
        </div>
        <p className="font-sans text-sm text-white/55">
          Invite-only. We review every application. Tell us a bit about yourself.
        </p>
      </div>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Full name
        </span>
        <input
          type="text"
          required
          autoComplete="name"
          placeholder="Jane Doe"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
        />
      </label>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
        />
      </label>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Trading experience
        </span>
        <select
          required
          value={tradingExperience}
          onChange={(e) => setTradingExperience(e.target.value)}
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors"
        >
          {EXPERIENCE_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl} className="bg-zinc-900">
              {lvl}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          Why are you interested?
        </span>
        <textarea
          required
          rows={3}
          minLength={10}
          maxLength={2000}
          placeholder="What do you trade? What would you use this for?"
          value={whyInterested}
          onChange={(e) => setWhyInterested(e.target.value)}
          className="font-sans mt-1.5 block w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm placeholder-white/25 focus:border-red-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-colors resize-y"
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
        {loading ? "Submitting…" : "Request an Invitation"}
      </button>

      <p className="text-[11px] text-white/40 text-center">
        We respect your inbox. One email when your application is in, one when
        you&apos;re invited. No marketing blast.
      </p>
    </form>
  );
}
