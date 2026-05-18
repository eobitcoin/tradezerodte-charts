import Link from "next/link";
import { consumeVerificationToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let status: "ok" | "error" = "error";
  let message = "Missing or invalid token.";
  if (token) {
    const result = await consumeVerificationToken(token);
    if (result.ok) {
      status = "ok";
      message =
        "Your email is verified. An administrator will review your account — you'll get an email when it's approved.";
    } else {
      message = result.reason;
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm border border-black/10 dark:border-white/10 rounded-lg p-6 space-y-3">
        <h1 className="text-xl font-semibold">
          {status === "ok" ? "Email verified" : "Verification failed"}
        </h1>
        <p className="text-sm text-black/70 dark:text-white/70">{message}</p>
        <Link
          href="/login"
          className="inline-block rounded bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium"
        >
          Continue to sign in
        </Link>
      </div>
    </main>
  );
}
