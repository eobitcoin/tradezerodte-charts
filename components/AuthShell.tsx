import Link from "next/link";

const DECLARATION = [
  "I objectively identify my edges.",
  "I predefine the risk of every trade.",
  "I completely accept the risk, or I'm willing to let go of the trade.",
  "I act on my edges without reservation or hesitation.",
  "I pay myself as the market makes money available to me.",
  "I continually monitor my susceptibility for making errors.",
  "I understand the absolute necessity of these principles of consistent success and, therefore, I never violate them.",
];

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex-1 grid grid-cols-1 lg:grid-cols-[fit-content(640px)_minmax(0,560px)] min-h-screen bg-black text-white font-serif">
      {/* Mobile-only background: full-bleed video covers the screen, with a
          dark scrim overlay so the declaration + form stay readable on top.
          Hidden at lg+ where the dedicated left column takes over. */}
      <video
        src="/assets/aslan.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden
        className="lg:hidden fixed inset-0 w-full h-full object-cover z-0"
      />
      <div
        aria-hidden
        className="lg:hidden fixed inset-0 bg-gradient-to-b from-black/60 via-black/75 to-black/85 z-0"
      />

      {/* LEFT — framed video at native vertical size, with wordmark overlaid inside the frame.
          Inner flex uses `justify-end` so any slack in the column shifts to the
          OUTER left rather than between the video and the form. Padding tight
          to maximize video height. */}
      <aside className="hidden lg:flex flex-col pl-2 pr-2 py-3 bg-black border-r border-white/[0.06] relative overflow-hidden">
        {/* Soft red glow behind the video */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(45% 45% at 50% 55%, rgba(220,38,38,0.10) 0%, rgba(0,0,0,0) 70%)",
          }}
        />

        <div className="relative z-10 flex-1 min-h-0 flex items-center justify-start">
          <div className="relative p-1.5 border border-red-500/40 rounded-sm shadow-[0_0_60px_-10px_rgba(220,38,38,0.35)]">
            {/* Corner accents */}
            <span className="absolute -top-px -left-px w-3 h-3 border-t-2 border-l-2 border-red-500 z-30" />
            <span className="absolute -top-px -right-px w-3 h-3 border-t-2 border-r-2 border-red-500 z-30" />
            <span className="absolute -bottom-px -left-px w-3 h-3 border-b-2 border-l-2 border-red-500 z-30" />
            <span className="absolute -bottom-px -right-px w-3 h-3 border-b-2 border-r-2 border-red-500 z-30" />

            {/* Video + overlay live in the same inset container */}
            <div className="relative">
              <video
                src="/assets/aslan.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                className="block h-[calc(100vh-40px)] w-auto max-w-full object-contain"
              />

              {/* Top scrim — guarantees wordmark contrast on bright frames */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 via-black/30 to-transparent"
              />

              {/* Wordmark — top-left, inside the frame */}
              <Link
                href="/"
                className="absolute top-3 left-4 z-20 flex items-baseline gap-2 group [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]"
              >
                <span className="font-sans font-semibold tracking-tight text-base text-white">
                  0DTE Market Research
                </span>
                <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-white/60 group-hover:text-white/80 transition-colors">
                  private
                </span>
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {/* RIGHT — declaration above form. On mobile this overlays the
          background video; on desktop it gets its own gradient panel. */}
      <section className="relative z-10 flex flex-col justify-center px-8 lg:pl-10 lg:pr-8 py-10 bg-transparent lg:bg-gradient-to-br lg:from-zinc-950 lg:via-black lg:to-zinc-950">
        {/* Mobile-only wordmark */}
        <Link
          href="/"
          className="lg:hidden flex items-baseline gap-2 mb-6 group"
        >
          <span className="font-sans font-semibold tracking-tight text-base">
            0DTE Market Research
          </span>
          <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-white/40">
            private
          </span>
        </Link>

        {/* DECLARATION — read first.
            Mobile values are deliberately tighter (so the form below stays
            above the fold on a phone). The lg: variants restore the original
            desktop typography. */}
        <div className="w-full max-w-md mb-6 lg:mb-8">
          {/* Header line with red accents */}
          <div className="flex items-center gap-3 mb-3 lg:mb-4">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-red-500/60 to-red-500/60" />
            <h2 className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
              Trader&apos;s Declaration
            </h2>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent via-red-500/60 to-red-500/60" />
          </div>

          {/* Lead with oversized red opening quote */}
          <p className="text-xl lg:text-2xl italic leading-tight lg:leading-snug text-white/95 mb-3 lg:mb-5 relative pl-5 lg:pl-6">
            <span className="absolute left-0 -top-1 text-red-500 text-3xl lg:text-4xl leading-none not-italic font-bold">
              &ldquo;
            </span>
            I&apos;m a consistent winner because:
          </p>

          {/* Principles — round red dot bullets with soft red ring */}
          <ul className="space-y-1.5 lg:space-y-3 text-[12px] lg:text-[14px] leading-snug lg:leading-relaxed text-white/85">
            {DECLARATION.map((line, i) => (
              <li key={i} className="flex items-start gap-2.5 lg:gap-3">
                <span className="shrink-0 mt-[5px] lg:mt-[7px] w-1.5 h-1.5 rounded-full bg-red-500/70 ring-2 ring-red-500/15" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {/* Closing quote + attribution, right-aligned */}
          <div className="text-right mt-3">
            <span className="text-red-500 text-4xl leading-none font-bold not-italic">
              &rdquo;
            </span>
          </div>
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-white/35 text-right -mt-2">
            — Mark Douglas, <span className="italic normal-case tracking-normal">Trading in the Zone</span>
          </p>
        </div>

        {/* Hairline between declaration and form */}
        <div className="w-full max-w-md mb-6 lg:mb-8 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span className="font-sans text-[9px] uppercase tracking-[0.32em] text-white/40">
            Commit
          </span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        {/* FORM */}
        <div className="w-full max-w-md">
          {children}
        </div>

        {/* Footer note */}
        <p className="font-sans text-[11px] text-white/30 mt-10 max-w-md">
          Private research · Not financial advice · Do your own work
        </p>
      </section>
    </div>
  );
}
