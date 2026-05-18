/**
 * Circular initial badge used in the top nav.
 *
 * Initial logic:
 *   1. If a full_name profile field exists → first character of the first word
 *   2. Else if a display_name exists → first character of it
 *   3. Else → first character of the email
 *
 * Always rendered uppercase. Red badge to match the login-page typography.
 */
export type AvatarSize = "sm" | "md";

function deriveInitial(opts: {
  fullName?: string | null;
  displayName?: string | null;
  email: string;
}): string {
  const name = opts.fullName?.trim() || opts.displayName?.trim();
  if (name) {
    const first = name.split(/\s+/)[0];
    if (first) return first[0]!.toUpperCase();
  }
  return (opts.email[0] || "?").toUpperCase();
}

export default function UserAvatar({
  email,
  fullName,
  displayName,
  size = "md",
  title,
}: {
  email: string;
  fullName?: string | null;
  displayName?: string | null;
  size?: AvatarSize;
  /** Tooltip on hover. Defaults to the email. */
  title?: string;
}) {
  const initial = deriveInitial({ fullName, displayName, email });
  const dim =
    size === "sm"
      ? "w-7 h-7 text-[12px]"
      : "w-8 h-8 text-[13px]";
  return (
    <span
      title={title ?? email}
      className={[
        dim,
        "inline-flex items-center justify-center rounded-full",
        "bg-red-600 text-white font-semibold tracking-tight",
        "ring-2 ring-red-500/25 hover:ring-red-500/50 transition-all",
        "shadow-sm shadow-red-900/30",
        "select-none",
      ].join(" ")}
    >
      {initial}
    </span>
  );
}
