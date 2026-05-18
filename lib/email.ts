import { Resend } from "resend";
import { FOUNDING_ADMINS_RAW } from "./founding-admins";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM || "onboarding@resend.dev";
const appUrl = process.env.APP_URL || "http://localhost:3000";
// Admin email(s) that receive new-signup notifications. Comma-separated.
// Falls back to the founding-admin allowlist below.
const adminEmails = (process.env.ADMIN_EMAILS || FOUNDING_ADMINS_RAW)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let _resend: Resend | null = null;
function client(): Resend {
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  if (!_resend) _resend = new Resend(apiKey);
  return _resend;
}

function shell(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;background:#fff">
      <div style="border-bottom:1px solid #eee;padding-bottom:12px;margin-bottom:20px">
        <strong style="font-size:14px">0DTE Market Research</strong>
        <span style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.18em;margin-left:6px">private</span>
      </div>
      <h2 style="margin:0 0 12px;font-size:18px">${title}</h2>
      ${bodyHtml}
      <p style="color:#999;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:12px">
        This is an automated message from the 0DTE Market Research site.
      </p>
    </div>
  `;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

export async function sendVerificationEmail(to: string, token: string) {
  const url = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  // Single CTA, no duplicate "or copy this link" line (which spam filters
  // score as a phishing pattern). The plain-text part is intentionally
  // verbose so filters don't see a thin-text-heavy-HTML imbalance.
  const body = `
    <p>Hello,</p>
    <p>Thanks for creating an account on the 0DTE Market Research site. Please confirm your email address to continue.</p>
    <p>After confirming, an administrator will review and activate your account — you'll get another email once that's done.</p>
    <p style="margin:28px 0">
      <a href="${url}" style="background:#dc2626;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Confirm my email address</a>
    </p>
    <p style="color:#777;font-size:12px;margin-top:24px">If the button doesn't work, paste this address into your browser: <span style="word-break:break-all">${url}</span></p>
    <p style="color:#999;font-size:12px">If you didn't sign up, you can safely ignore this email — the link expires in 24 hours and no account will be created.</p>
  `;
  const text = [
    `Hello,`,
    ``,
    `Thanks for creating an account on the 0DTE Market Research site.`,
    `Please confirm your email address by visiting the link below.`,
    ``,
    `After confirming, an administrator will review and activate your account.`,
    ``,
    `Confirmation link:`,
    `${url}`,
    ``,
    `If you didn't sign up, you can ignore this email — the link expires in 24 hours.`,
    ``,
    `— 0DTE Market Research`,
  ].join("\n");
  const { error } = await client().emails.send({
    from,
    to,
    replyTo: from,
    subject: "Confirm your email address",
    html: shell("Confirm your email address", body),
    text,
    headers: {
      // Required by Gmail/Yahoo bulk-sender rules and improves deliverability.
      "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

/**
 * Sends a password-reset link to the user. Same content discipline as the
 * verification email (one CTA, beefed-up plain-text, List-Unsubscribe) so it
 * clears Yahoo / Gmail content filters.
 */
export async function sendPasswordResetEmail(to: string, token: string) {
  const url = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const body = `
    <p>Hello,</p>
    <p>We received a request to reset the password for your 0DTE Market Research account. Click the button below to choose a new password.</p>
    <p style="margin:28px 0">
      <a href="${url}" style="background:#dc2626;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Choose a new password</a>
    </p>
    <p style="color:#777;font-size:12px;margin-top:24px">If the button doesn't work, paste this address into your browser: <span style="word-break:break-all">${url}</span></p>
    <p style="color:#999;font-size:12px">If you didn't request this, you can safely ignore this email — your password won't change. The link expires in 1 hour.</p>
  `;
  const text = [
    `Hello,`,
    ``,
    `We received a request to reset the password for your 0DTE Market Research account.`,
    `Click the link below to choose a new password.`,
    ``,
    `${url}`,
    ``,
    `If you didn't request this, you can ignore this email — your password won't change.`,
    `The link expires in 1 hour.`,
    ``,
    `— 0DTE Market Research`,
  ].join("\n");
  const { error } = await client().emails.send({
    from,
    to,
    replyTo: from,
    subject: "Reset your password",
    html: shell("Reset your password", body),
    text,
    headers: {
      "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

/**
 * Notifies admin(s) that a new user has signed up and is awaiting approval.
 * Best-effort: failures here should NOT block signup, just log.
 */
export async function sendNewSignupNotification(opts: {
  newUserEmail: string;
  signupAt: Date;
}): Promise<void> {
  if (adminEmails.length === 0) return;
  const adminUrl = `${appUrl}/admin/users?status=pending`;
  const body = `
    <p>A new user has signed up and is awaiting your approval:</p>
    <p style="background:#f5f5f5;padding:12px 14px;border-radius:6px;margin:16px 0;font-family:ui-monospace,monospace;font-size:13px">
      ${escape(opts.newUserEmail)}<br/>
      <span style="color:#666;font-size:12px">Signed up: ${escape(opts.signupAt.toISOString())}</span>
    </p>
    <p style="margin:24px 0">
      <a href="${adminUrl}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Review pending users</a>
    </p>
  `;
  const text = `New signup awaiting approval: ${opts.newUserEmail}\nReview at ${adminUrl}`;
  try {
    await client().emails.send({
      from,
      to: adminEmails,
      subject: `New signup awaiting approval — ${opts.newUserEmail}`,
      html: shell("New signup awaiting approval", body),
      text,
    });
  } catch (err) {
    console.error("admin signup notification failed:", err);
  }
}

/**
 * Notifies a user that their account has been approved.
 */
export async function sendApprovalEmail(opts: {
  to: string;
  accessExpiresAt: Date | null;
}): Promise<void> {
  const expiry = opts.accessExpiresAt
    ? `Your access is valid until <strong>${escape(opts.accessExpiresAt.toLocaleDateString("en-US", { dateStyle: "long" }))}</strong>.`
    : "Your access does not expire.";
  const body = `
    <p>Your account on the 0DTE Market Research site has been approved. You can sign in now.</p>
    <p>${expiry}</p>
    <p style="margin:24px 0">
      <a href="${appUrl}/login" style="background:#dc2626;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Sign in</a>
    </p>
  `;
  const text = `Your account has been approved. Sign in at ${appUrl}/login`;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: "Your account has been approved — 0DTE Market Research",
      html: shell("Your account is active", body),
      text,
    });
  } catch (err) {
    console.error("approval email failed:", err);
  }
}

/**
 * Sends a copy of the daily 0DTE research post to the bot inbox so the
 * user has the day's trades in their email even when away from the site.
 * Reads `DTE_RESEARCH_EMAIL_TO` (comma-separated list) from env.
 * Best-effort: failures don't break the publish.
 */
export interface DteResearchEmailPost {
  title: string;
  tradingDay: string;          // YYYY-MM-DD
  runAt: Date | null;
  sentiment: string | null;
  bias: string | null;
  bodyHtml: string;            // pre-rendered HTML body
  tradesTableHtml: string;     // pre-rendered HTML for the trade summary table
}

export async function sendDteResearchEmail(post: DteResearchEmailPost): Promise<void> {
  const toRaw = process.env.DTE_RESEARCH_EMAIL_TO || "";
  const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) {
    console.warn("[email] DTE_RESEARCH_EMAIL_TO not set — skipping daily research email");
    return;
  }
  const runAtText = post.runAt
    ? post.runAt.toLocaleString("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " ET"
    : "";
  const chips: string[] = [];
  if (post.sentiment) chips.push(`<span style="display:inline-block;padding:2px 8px;border:1px solid #ccc;border-radius:999px;font-size:11px;margin-right:6px;color:#444;background:#fafafa">Sentiment: ${escape(post.sentiment)}</span>`);
  if (post.bias) chips.push(`<span style="display:inline-block;padding:2px 8px;border:1px solid #ccc;border-radius:999px;font-size:11px;margin-right:6px;color:#444;background:#fafafa">Bias: ${escape(post.bias)}</span>`);

  const url = `${appUrl}/posts/${post.tradingDay}`;
  const body = `
    <div style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">
      Trading day · ${escape(post.tradingDay)}${runAtText ? ` · Run at ${escape(runAtText)}` : ""}
    </div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#111;line-height:1.3">${escape(post.title)}</h2>
    ${chips.length ? `<div style="margin-bottom:18px">${chips.join("")}</div>` : ""}

    ${post.tradesTableHtml ? `
      <div style="margin-bottom:24px">
        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#444;margin-bottom:8px">Trade summary</div>
        ${post.tradesTableHtml}
      </div>
    ` : ""}

    <div style="margin:24px 0;font-size:14px;line-height:1.6;color:#222">
      ${post.bodyHtml}
    </div>

    <p style="margin:28px 0 16px">
      <a href="${url}" style="background:#dc2626;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;font-size:13px">View on tradezerodte.com →</a>
    </p>
  `;

  const text = [
    `0DTE Research — ${post.tradingDay}`,
    "",
    post.title,
    "",
    post.sentiment ? `Sentiment: ${post.sentiment}` : "",
    post.bias ? `Bias: ${post.bias}` : "",
    runAtText ? `Run at: ${runAtText}` : "",
    "",
    `View on the site: ${url}`,
  ].filter(Boolean).join("\n");

  const subject = `0DTE Research — ${post.tradingDay}: ${post.title.slice(0, 110)}`;

  try {
    await client().emails.send({
      from,
      to,
      replyTo: from,
      subject,
      html: shell(post.title, body),
      text,
      headers: {
        "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (err) {
    console.error("[email] daily research email failed:", err);
  }
}

/**
 * Confirms to a waitlist signup that we received their application.
 * Best-effort.
 */
export async function sendWaitlistConfirmation(opts: {
  to: string;
  fullName: string;
}): Promise<void> {
  const body = `
    <p>Hello ${escape(opts.fullName.split(/\s+/)[0] || "there")},</p>
    <p>Thanks for joining the 0DTE Market Research waitlist. Your application is in — we review every signup individually.</p>
    <p>This is an invite-only research tool, so it may take a few days. When we're ready to bring you on, you'll get an email from this address with a one-time link to set your password and sign in.</p>
    <p style="color:#666;font-size:13px;margin-top:24px">In the meantime, you can browse a few of our public explainers:</p>
    <ul style="color:#666;font-size:13px">
      <li><a href="${appUrl}/learn/0dte-options">What is 0DTE Options Trading?</a></li>
      <li><a href="${appUrl}/learn/max-pain">How Max Pain Works</a></li>
      <li><a href="${appUrl}/learn/gamma-exposure">Gamma Exposure (GEX) Explained</a></li>
    </ul>
    <p style="color:#999;font-size:12px;margin-top:24px">If you didn't sign up, you can safely ignore this — no account has been created.</p>
  `;
  const text = [
    `Hello ${opts.fullName.split(/\s+/)[0] || "there"},`,
    ``,
    `Thanks for joining the 0DTE Market Research waitlist.`,
    `Your application is in — we review every signup individually.`,
    ``,
    `When we're ready to bring you on, you'll receive an email with a`,
    `one-time link to set your password.`,
    ``,
    `In the meantime, browse our public explainers:`,
    `  - ${appUrl}/learn/0dte-options`,
    `  - ${appUrl}/learn/max-pain`,
    `  - ${appUrl}/learn/gamma-exposure`,
    ``,
    `— 0DTE Market Research`,
  ].join("\n");
  try {
    await client().emails.send({
      from,
      to: opts.to,
      replyTo: from,
      subject: "You're on the waitlist — 0DTE Market Research",
      html: shell("Waitlist application received", body),
      text,
      headers: {
        "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (err) {
    console.error("waitlist confirmation email failed:", err);
  }
}

/**
 * Notifies admin(s) that a new waitlist signup came in.
 */
export async function sendWaitlistAdminNotification(opts: {
  email: string;
  fullName: string;
  whyInterested: string;
  tradingExperience: string;
}): Promise<void> {
  if (adminEmails.length === 0) return;
  const adminUrl = `${appUrl}/admin/waitlist`;
  const body = `
    <p>New waitlist signup:</p>
    <table style="border-collapse:collapse;font-size:13px;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Name</td><td style="padding:4px 0;font-weight:600">${escape(opts.fullName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Email</td><td style="padding:4px 0;font-family:ui-monospace,monospace">${escape(opts.email)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Experience</td><td style="padding:4px 0">${escape(opts.tradingExperience)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Why interested</td><td style="padding:4px 0;max-width:480px">${escape(opts.whyInterested)}</td></tr>
    </table>
    <p style="margin:24px 0">
      <a href="${adminUrl}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Review waitlist</a>
    </p>
  `;
  const text = `New waitlist signup: ${opts.fullName} <${opts.email}>\nExperience: ${opts.tradingExperience}\nWhy: ${opts.whyInterested}\n\nReview at ${adminUrl}`;
  try {
    await client().emails.send({
      from,
      to: adminEmails,
      subject: `New waitlist signup — ${opts.fullName}`,
      html: shell("New waitlist signup", body),
      text,
    });
  } catch (err) {
    console.error("waitlist admin notification failed:", err);
  }
}

/**
 * Sends an invitation email when an admin approves a waitlist entry.
 * Includes a password-reset link so the new user can set their own password
 * and sign in.
 */
export async function sendWaitlistInvitation(opts: {
  to: string;
  fullName: string;
  setPasswordToken: string;
  accessExpiresAt: Date | null;
}): Promise<void> {
  const url = `${appUrl}/reset-password?token=${encodeURIComponent(opts.setPasswordToken)}`;
  const firstName = opts.fullName.split(/\s+/)[0] || "there";
  const expiry = opts.accessExpiresAt
    ? `Your initial access is valid until <strong>${escape(opts.accessExpiresAt.toLocaleDateString("en-US", { dateStyle: "long" }))}</strong>.`
    : "Your access does not expire.";
  const body = `
    <p>Hi ${escape(firstName)},</p>
    <p>You're in. We've activated your invitation to 0DTE Market Research — click below to set your password and sign in.</p>
    <p style="margin:28px 0">
      <a href="${url}" style="background:#dc2626;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Set my password and sign in</a>
    </p>
    <p>${expiry}</p>
    <p style="color:#777;font-size:12px;margin-top:24px">If the button doesn't work, paste this address into your browser: <span style="word-break:break-all">${url}</span></p>
    <p style="color:#999;font-size:12px;margin-top:20px">This link expires in 1 hour. If it expires before you use it, reply to this email and we'll send a fresh one.</p>
  `;
  const text = [
    `Hi ${firstName},`,
    ``,
    `You're in. We've activated your invitation to 0DTE Market Research.`,
    `Click the link below to set your password and sign in.`,
    ``,
    `${url}`,
    ``,
    opts.accessExpiresAt
      ? `Your initial access is valid until ${opts.accessExpiresAt.toDateString()}.`
      : `Your access does not expire.`,
    ``,
    `This link expires in 1 hour. Reply to this email if you need a fresh one.`,
    ``,
    `— 0DTE Market Research`,
  ].join("\n");
  const { error } = await client().emails.send({
    from,
    to: opts.to,
    replyTo: from,
    subject: "You've been invited to 0DTE Market Research",
    html: shell("Your invitation is ready", body),
    text,
    headers: {
      "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

/**
 * Notifies a user that their account has been disabled.
 */
export async function sendDisabledEmail(opts: {
  to: string;
  reason: string | null;
}): Promise<void> {
  const reasonHtml = opts.reason
    ? `<p style="background:#f5f5f5;padding:12px 14px;border-radius:6px;margin:16px 0;font-size:13px">${escape(opts.reason)}</p>`
    : "";
  const body = `
    <p>Your account on the 0DTE Market Research site has been disabled by an administrator.</p>
    ${reasonHtml}
    <p>If you believe this was in error, please reply to this email or contact the administrator.</p>
  `;
  const text = `Your account has been disabled.${opts.reason ? ` Reason: ${opts.reason}` : ""}`;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: "Your account has been disabled — 0DTE Market Research",
      html: shell("Account disabled", body),
      text,
    });
  } catch (err) {
    console.error("disabled email failed:", err);
  }
}
