import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  uuid,
  date,
  jsonb,
  index,
  uniqueIndex,
  customType,
  serial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export type UserRole = "user" | "admin";
export type UserStatus = "pending" | "active" | "disabled";
export type SubscriptionTier = "free" | "paid";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  // user lifecycle ----------------------------------------------------------
  role: text("role").$type<UserRole>().notNull().default("user"),
  status: text("status").$type<UserStatus>().notNull().default("pending"),
  // null = no expiry; otherwise access ends at this timestamp
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  // future paywall hook: subscription tier (defaults free, extend later)
  subscriptionTier: text("subscription_tier").$type<SubscriptionTier>().notNull().default("free"),
  // When true, the login-time founding-admin auto-promotion is suppressed for
  // this account. Set automatically by /api/admin/users/[id]/role when an admin
  // demotes a founding-admin email; cleared when an admin re-promotes. Lets
  // demotions of bootstrap accounts actually stick.
  foundingAdminOptOut: boolean("founding_admin_opt_out").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  fullName: text("full_name"),
  timezone: text("timezone"),
  // admin-only notes about the user
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AdminAction =
  | "approve"
  | "disable"
  | "enable"
  | "extend_access"
  | "set_role"
  | "update_profile"
  | "verify_email";

export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").$type<AdminAction>().notNull(),
    beforeValue: jsonb("before_value").$type<Record<string, unknown>>(),
    afterValue: jsonb("after_value").$type<Record<string, unknown>>(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("admin_actions_target_idx").on(t.targetUserId, t.createdAt.desc()),
    index("admin_actions_actor_idx").on(t.actorUserId, t.createdAt.desc()),
  ],
);

export type UserProfile = typeof userProfiles.$inferSelect;
export type AdminActionRecord = typeof adminActions.$inferSelect;

// ----------------------------------------------------------------------------
// Economic calendar — upcoming-week macro events that may move US asset prices.
// Refreshed weekly via Sunday cron from Finnhub (raw events) and optionally
// enriched by a separate Claude routine that publishes richer "potential
// impact" commentary on top of the canned event-type description.
// ----------------------------------------------------------------------------

export type EconImportance = "low" | "medium" | "high";

export const economicEvents = pgTable(
  "economic_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Finnhub event field (or hash of country|title|time for other sources)
     *  — used as the dedup/upsert key. */
    externalId: text("external_id").notNull().unique(),
    title: text("title").notNull(),                                 // "CPI YoY"
    country: text("country"),                                       // "US", "EU", "JP", "GB", "CN"
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    importance: text("importance").$type<EconImportance>().notNull().default("low"),
    /** Numeric values for printed/expected/prior readings. Null until known. */
    actual: numeric("actual", { precision: 24, scale: 6 }),
    estimate: numeric("estimate", { precision: 24, scale: 6 }),
    prior: numeric("prior", { precision: 24, scale: 6 }),
    unit: text("unit"),                                             // "%", "K", "$B"
    /** Short canned description: what the event measures. Generated at
     *  ingest from the title pattern. */
    description: text("description"),
    /** Longer narrative on potential market impact. Optionally overridden by
     *  the Sunday Claude routine via /api/economic-calendar/publish. */
    impactText: text("impact_text"),
    /** Asset classes typically moved by this event — for filtering. */
    assetTags: text("asset_tags").array().notNull().default(sql`ARRAY[]::text[]`),
    /** Where the row came from. */
    source: text("source").notNull().default("finnhub"),
    /** Full upstream payload for debugging. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    /** Monday of the week this event falls in (NY tz). Indexed for week
     *  pickers. */
    weekOf: date("week_of").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("economic_events_time_idx").on(t.eventTime),
    index("economic_events_week_idx").on(t.weekOf, t.eventTime),
    index("economic_events_importance_idx").on(t.importance, t.eventTime),
  ],
);

export type EconomicEvent = typeof economicEvents.$inferSelect;

// ----------------------------------------------------------------------------
// Waitlist — public signup table from the /welcome marketing page. Admin
// reviews entries and "invites" selected ones, which creates a `users` row
// + password-reset link that the new user clicks to set their password and
// gain access.
// ----------------------------------------------------------------------------

export type WaitlistStatus = "pending" | "invited" | "declined";

export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull().unique(),
    fullName: text("full_name").notNull(),
    whyInterested: text("why_interested").notNull(),
    tradingExperience: text("trading_experience").notNull(),
    /** Optional ?ref= tracking from the marketing page URL. */
    source: text("source"),
    status: text("status").$type<WaitlistStatus>().notNull().default("pending"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    /** Set once invited — links the waitlist row to the resulting user. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Free-form admin notes (not visible to applicant). */
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("waitlist_signups_status_idx").on(t.status, t.createdAt.desc()),
    index("waitlist_signups_created_idx").on(t.createdAt.desc()),
  ],
);

export type WaitlistSignup = typeof waitlistSignups.$inferSelect;

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Grade =
  | "A+" | "A" | "A-"
  | "B+" | "B" | "B-"
  | "C+" | "C" | "C-"
  | "D+" | "D" | "D-"
  | "F";

export type Direction = "call" | "put" | "long" | "short" | "avoid";

/** Per-trade status emitted by market_open / analysis scans. Premarket trades
 *  carry no status (implicitly confirmed). Silence = confirmed: a premarket
 *  trade that isn't mentioned in a later scan stays as-is. */
export type TradeStatus = "confirmed" | "revised" | "killed" | "added";

/** Result of a trade once the analysis scan runs end-of-day. */
export type TradeOutcome =
  | "target1_hit"
  | "target2_hit"
  | "stopped"
  | "no_fill"
  | "time_stopped"
  | "manual_exit";

export type Trade = {
  ticker: string;
  grade: Grade;
  rank?: number;
  direction?: Direction;
  strike?: number | string;
  expiry?: string;
  entry_zone?: string;
  entry_trigger?: string;
  target1?: number | string;
  target2?: number | string;
  stop?: number | string;
  time_stop?: string;
  rationale?: string;
  // Scan-hierarchy fields — emitted by market_open / analysis scans.
  status?: TradeStatus;
  /** Required when status === "revised". Short human-readable diff. */
  revision_summary?: string;
  /** Required when status === "killed". Why the trade was invalidated. */
  kill_reason?: string;
  // Analysis-only outcome fields.
  outcome?: TradeOutcome;
  actual_entry?: number | string;
  actual_exit?: number | string;
  pnl_pct?: number;
  result_notes?: string;
};

export type PostImage = {
  key: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

/** Which scan produced this post — distinguishes the 8:30, 9:45, 10:15,
 *  and post-close (~4:15) publications for the same trading_day.
 *  `settlement` is the post-close scan that stamps end-of-day outcomes
 *  (target hit / stopped / no-fill) onto each trade. */
export type ScanKind = "premarket" | "market_open" | "analysis" | "settlement";

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingDay: date("trading_day").notNull(),
    /** Defaults to "premarket" so the existing 8:30 routine works unchanged. */
    scanKind: text("scan_kind").$type<ScanKind>().notNull().default("premarket"),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    trades: jsonb("trades").$type<Trade[]>().notNull().default([]),
    tickers: text("tickers").array().notNull().default(sql`ARRAY[]::text[]`),
    sentiment: text("sentiment"),
    bias: text("bias"),
    images: jsonb("images").$type<PostImage[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("posts_trading_day_idx").on(t.tradingDay.desc()),
    uniqueIndex("posts_day_kind_unique").on(t.tradingDay, t.scanKind),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Post = typeof posts.$inferSelect;

// ----------------------------------------------------------------------------
// Insider scanner — daily SEC Form 4 purchase scan.
// Independent table so the data shape stays clean (purchases, not trade plans).
// ----------------------------------------------------------------------------

export type InsiderBuy = {
  ticker: string;
  company: string;
  executive: string;
  title?: string;
  shares?: number;
  total_value?: number;
  // "new" = first time this insider holds the stock; "addition" = adding to an existing position
  position_type?: "new" | "addition";
  filing_date?: string;
  filing_url?: string;
  notes?: string;
};

export const insiderPosts = pgTable(
  "insider_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull().unique(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    buys: jsonb("buys").$type<InsiderBuy[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("insider_posts_scan_day_idx").on(t.scanDay.desc())],
);

export type InsiderPost = typeof insiderPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Daily Briefings — 15-second voiceover script + Higgsfield Soul video +
// YouTube upload. One row per trading_day. Phase 1 stores just the script +
// scene prompt; Phase 2 adds video_s3_key, Phase 3 adds youtube_video_id.
// ----------------------------------------------------------------------------

export type BriefingStatus =
  | "pending"        // row reserved, no script yet
  | "scripted"       // LLM wrote the script + setting prompt, ready for video
  | "generating"     // ElevenLabs / Higgsfield job in flight
  | "pending_upload" // MP4 rendered and available; YouTube upload not yet started
  | "uploading"      // YouTube upload in flight
  | "posted"         // live on YouTube, embedded on site
  | "failed";        // see error_log

export type BriefingErrorEvent = {
  at: string;          // ISO timestamp
  step: "scripting" | "generating" | "uploading" | "other";
  message: string;
  detail?: unknown;
};

/**
 * Per-platform publish state. Set to `pending_review` automatically when the
 * MP4 lands; admin flips to `approved` to release for upload. `posting` is the
 * in-flight window (publish routine has picked it up). `posted` means it
 * succeeded — for YouTube that's a live video, for TikTok (drafts mode) it's
 * pushed to the user's app inbox awaiting final tap-publish.
 */
export type PlatformPublishStatus =
  | "pending_review"
  | "approved"
  | "posting"
  | "posted"
  | "failed"
  | "skipped";

export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingDay: date("trading_day").notNull().unique(),
    /** 30-45 word voiceover script. First-person presenter voice. */
    script: text("script"),
    /** Uppercased ticker symbols the script actually names, in narration
     *  order (e.g. ["QCOM","INTC","MU"]). Drives the right-side calls panel
     *  on /morning-brief so it matches what's spoken in the video — the
     *  script-writer can theme its picks differently from the premarket
     *  top-3 ranking. Empty array → the page falls back to inferring the
     *  top-3 from the premarket scan (legacy behavior). */
    tickers: text("tickers").array().notNull().default(sql`'{}'::text[]`),
    /** One-line scene/wardrobe/mood prompt fed to Higgsfield (Soul + Speak). */
    settingPrompt: text("setting_prompt"),
    status: text("status").$type<BriefingStatus>().notNull().default("pending"),
    /** Higgsfield job ID once video generation kicks off (Phase 2). */
    higgsfieldJobId: text("higgsfield_job_id"),
    /** Railway bucket key for the durable MP4 copy (Phase 2). */
    videoS3Key: text("video_s3_key"),
    /** YouTube video ID once uploaded (Phase 3). */
    youtubeVideoId: text("youtube_video_id"),
    thumbnailUrl: text("thumbnail_url"),
    /** Append-only audit trail of failures across steps. */
    errorLog: jsonb("error_log").$type<BriefingErrorEvent[]>().notNull().default([]),
    /** Free-form, e.g. routine_name, model, prompt_version, character_id. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when the first platform upload completes (legacy / first-success). */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // ---------- YouTube publish workflow ----------
    /** Per-platform publish state. Null until video renders. */
    ytStatus: text("yt_status").$type<PlatformPublishStatus>(),
    ytTitle: text("yt_title"),
    ytCaption: text("yt_caption"),
    ytPostedAt: timestamp("yt_posted_at", { withTimezone: true }),
    ytError: text("yt_error"),
    // ---------- TikTok publish workflow (drafts/inbox mode) ----------
    ttStatus: text("tt_status").$type<PlatformPublishStatus>(),
    ttCaption: text("tt_caption"),
    /** TikTok Content Posting API publish_id returned by /inbox/video/init/. */
    ttPublishId: text("tt_publish_id"),
    ttPostedAt: timestamp("tt_posted_at", { withTimezone: true }),
    ttError: text("tt_error"),
  },
  (t) => [index("briefings_trading_day_idx").on(t.tradingDay.desc())],
);

export type Briefing = typeof briefings.$inferSelect;

// ----------------------------------------------------------------------------
// Weekly Earnings Brief — Sunday-morning 45-50s Olivia Trades video covering
// the upcoming week's important earnings + flagged IV-mispriced setups. Reads
// the Saturday Weekly Earnings Whiplash post as input.
//
// Parallel to `briefings` rather than sharing it — same pipeline shape (script
// → voiceover → Soul portrait → Hedra render → admin approval → YouTube/TikTok
// publish) but a different cadence (weekly vs daily), different word budget
// (100-130 words vs 30-40), and a casually-sexy rooftop aesthetic via different
// setting_prompt rotation. Keeping it in a separate table means iterating on
// either format never destabilizes the other.
//
// Uniqueness key is `week_anchor` — the Sunday-of-the-week date the brief
// publishes for. Reuses BriefingStatus / PlatformPublishStatus / errorLog
// shape from the daily table; nothing per-format about those.
// ----------------------------------------------------------------------------

export const weeklyEarningsBriefings = pgTable(
  "weekly_earnings_briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Sunday-of-the-week date — the date the brief publishes for. */
    weekAnchor: date("week_anchor").notNull().unique(),
    /** 100-130 word voiceover script. First-person Olivia voice. */
    script: text("script"),
    /** Uppercased ticker symbols mentioned in the script, in narration order
     *  (e.g. ["MRVL", "DELL", "AVGO"]). Surfaced as chips next to the video
     *  on both /morning-brief/earnings/[anchor] and /admin/briefings/weekly. The
     *  script writer emits this alongside the script; we don't try to parse
     *  it back out because the script uses company names rather than
     *  symbols. Empty array when the writer didn't populate it. */
    tickers: text("tickers").array().notNull().default(sql`'{}'::text[]`),
    /** One-line scene/wardrobe/mood prompt for Higgsfield Soul. */
    settingPrompt: text("setting_prompt"),
    status: text("status").$type<BriefingStatus>().notNull().default("pending"),
    higgsfieldJobId: text("higgsfield_job_id"),
    /** Railway bucket key for the durable MP4 copy. */
    videoS3Key: text("video_s3_key"),
    youtubeVideoId: text("youtube_video_id"),
    thumbnailUrl: text("thumbnail_url"),
    errorLog: jsonb("error_log").$type<BriefingErrorEvent[]>().notNull().default([]),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // ---------- YouTube publish workflow ----------
    ytStatus: text("yt_status").$type<PlatformPublishStatus>(),
    ytTitle: text("yt_title"),
    ytCaption: text("yt_caption"),
    ytPostedAt: timestamp("yt_posted_at", { withTimezone: true }),
    ytError: text("yt_error"),
    // ---------- TikTok publish workflow ----------
    ttStatus: text("tt_status").$type<PlatformPublishStatus>(),
    ttCaption: text("tt_caption"),
    ttPublishId: text("tt_publish_id"),
    ttPostedAt: timestamp("tt_posted_at", { withTimezone: true }),
    ttError: text("tt_error"),
  },
  (t) => [index("weekly_earnings_briefings_week_anchor_idx").on(t.weekAnchor.desc())],
);

export type WeeklyEarningsBriefing = typeof weeklyEarningsBriefings.$inferSelect;

// ----------------------------------------------------------------------------
// Max Pain — daily options max-pain + gamma-exposure snapshot per ticker.
// One row per scan day. Per-ticker data lives in `tickers` JSONB; alerts
// generated by the routine's regime-change detection live in `alerts` JSONB.
// ----------------------------------------------------------------------------

export type MaxPainGroup = "trading_focus" | "pin_friendly" | "index_vol" | "mega_cap";
export type GexRegime = "POS" | "NEG" | "FLIP";
export type MaxPainAlertSeverity = "HIGH" | "MED" | "LOW";

export type MaxPainExpiration = {
  exp: string;             // YYYY-MM-DD
  dte?: number;
  maxPain?: number;
  spot?: number;
  callOI?: number;
  putOI?: number;
  pcRatio?: number;
  netGEX?: number;          // $M per 1%
  source?: string;
};

export type MaxPainTicker = {
  ticker: string;
  group: MaxPainGroup;
  spot?: number;
  frontMonthMaxPain?: number;
  totalGEX?: number;        // $B per 1%
  flipStrike?: number;
  callWall?: number;
  putWall?: number;
  regime?: GexRegime;
  expirations?: MaxPainExpiration[];
  tags?: string[];          // RETAIL, PIN, EST, STALE
  source?: string;
  notes?: string;
};

export type MaxPainAlert = {
  id?: string;
  ticker: string;
  type: string;             // GAMMA_FLIP_CROSS, REGIME_CHANGE, MAX_PAIN_SHIFT, WALL_BREAK_CALL, WALL_BREAK_PUT, FLIP_MIGRATION, CROSS_SOURCE_DISAGREE
  severity: MaxPainAlertSeverity;
  message: string;
  prior_value?: number | string;
  current_value?: number | string;
  acknowledged?: boolean;
};

export const maxPainPosts = pgTable(
  "max_pain_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull().unique(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    tickers: jsonb("tickers").$type<MaxPainTicker[]>().notNull().default([]),
    alerts: jsonb("alerts").$type<MaxPainAlert[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("max_pain_posts_scan_day_idx").on(t.scanDay.desc())],
);

export type MaxPainPost = typeof maxPainPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Research — daily long-form per-ticker writeups (Wicked Stocks style).
// One row per (ticker, scan_day). Body markdown + 2 chart images per ticker
// (slots: "weekly", "daily" — but the slot field is free-form so future
// templates can use other slots). Images live on the bucket; we just store
// keys + URLs.
// ----------------------------------------------------------------------------

export type ResearchImage = {
  slot: string;            // "weekly" | "daily" | (future: "intraday", etc.)
  key: string;             // S3 object key
  url: string;             // /api/images/<key> — gated path served by this app
  alt?: string;
  width?: number;
  height?: number;
  content_type?: string;
};

/** Asset class split for `research_posts`. Most rows are "equity" (the
 *  Wicked Stocks daily writeups). "metals" rows are the Sunday metals
 *  research routine (GLD/SLV/GDX/etc.). "quantum" rows are the Sunday
 *  quantum-computing research routine (IONQ/RGTI/QBTS/QUBT/INFQ/FORM),
 *  which adds Fundamentals + Valuation sections on top of the standard
 *  Wicked Stocks technical layout. Members surfaces and ticker-hub
 *  reverse lookups filter on this column so the asset classes never
 *  bleed into each other's archive pages. */
export type AssetClass = "equity" | "metals" | "quantum";

export const researchPosts = pgTable(
  "research_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    scanDay: date("scan_day").notNull(),
    title: text("title").notNull(),
    headline: text("headline").notNull().default(""),
    bodyMd: text("body_md").notNull().default(""),
    images: jsonb("images").$type<ResearchImage[]>().notNull().default([]),
    /** Which research stream this row belongs to. See AssetClass above. */
    assetClass: text("asset_class").$type<AssetClass>().notNull().default("equity"),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("research_posts_ticker_day_idx").on(t.ticker, t.scanDay),
    index("research_posts_scan_day_idx").on(t.scanDay.desc()),
    index("research_posts_ticker_idx").on(t.ticker),
    // Hot path: every metals page does WHERE asset_class='metals' ORDER BY scan_day DESC.
    index("research_posts_asset_class_scan_day_idx").on(t.assetClass, t.scanDay.desc()),
  ],
);

export type ResearchPost = typeof researchPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Research image chunked-upload staging table.
// When the routine's upload_research_image tool call would carry >~200KB of
// base64 (causing claude.ai's stream-idle timer to fire mid-tool-use), the
// routine splits the payload into N chunks. Each chunk is one row here;
// the final chunk triggers reassembly + S3 upload + row cleanup.
// ----------------------------------------------------------------------------

export const researchUploadChunks = pgTable(
  "research_upload_chunks",
  {
    uploadId: text("upload_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkTotal: integer("chunk_total").notNull(),
    dataB64: text("data_b64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("research_upload_chunks_pk_idx").on(t.uploadId, t.chunkIndex),
  ],
);

// ----------------------------------------------------------------------------
// Radar — TradingView buy/sell signals streamed via webhook.
// One row per signal event (kept as full history). The /radar page shows the
// LATEST signal per (ticker, timeframe) using DISTINCT ON.
// ----------------------------------------------------------------------------

export type RadarTimeframe = "4h" | "1d" | "1w";
export type RadarSignal = "buy" | "sell" | "neutral";

export const radarSignals = pgTable(
  "radar_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe").notNull(),
    signal: text("signal").notNull(),
    indicator: text("indicator"),
    price: numeric("price", { precision: 14, scale: 4 }),
    signalAt: timestamp("signal_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("radar_signals_ticker_tf_idx").on(t.ticker, t.timeframe),
    index("radar_signals_signal_at_idx").on(t.signalAt.desc().nullsLast()),
  ],
);

export type RadarSignalRow = typeof radarSignals.$inferSelect;

// ----------------------------------------------------------------------------
// Crypto Radar — same shape as the equity Radar but for crypto USDT pairs.
// Kept in a separate table so the equity vs crypto schemas can evolve
// independently (e.g. crypto-specific indicators, different watchlists).
// ----------------------------------------------------------------------------

export const cryptoRadarSignals = pgTable(
  "crypto_radar_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),         // BTCUSDT, ETHUSDT, ...
    timeframe: text("timeframe").notNull(),   // "4h" | "1d" | "1w"
    signal: text("signal").notNull(),         // "buy" | "sell" | "neutral"
    indicator: text("indicator"),
    price: numeric("price", { precision: 20, scale: 8 }),  // crypto can be sub-dollar (TAO etc.)
    signalAt: timestamp("signal_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("crypto_radar_signals_ticker_tf_idx").on(t.ticker, t.timeframe),
    index("crypto_radar_signals_signal_at_idx").on(t.signalAt.desc().nullsLast()),
  ],
);

export type CryptoRadarSignalRow = typeof cryptoRadarSignals.$inferSelect;

// ----------------------------------------------------------------------------
// Crypto research — daily writeup with a structured trade plan for the
// flagship pairs (BTCUSDT/ETHUSDT/SOLUSDT). One row per scan_day. Trades
// reuse the equity `Trade` shape — `direction` accepts "long"|"short"|"avoid"
// already, and strike/expiry stay undefined for spot crypto.
// ----------------------------------------------------------------------------

export type CryptoTrade = {
  ticker: string;                              // e.g. "BTCUSDT"
  bias?: "long" | "short" | "neutral" | "avoid";
  entry_zone?: string;                         // e.g. "$104,500-$105,200"
  entry_trigger?: string;                      // e.g. "4H close > 105,200"
  target1?: number | string;
  target2?: number | string;
  stop?: number | string;
  time_horizon?: string;                       // e.g. "intraday", "1-2 days", "swing"
  rationale?: string;
};

export const cryptoPosts = pgTable(
  "crypto_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull().unique(),
    title: text("title").notNull(),
    headline: text("headline").notNull().default(""),
    bodyMd: text("body_md").notNull().default(""),
    trades: jsonb("trades").$type<CryptoTrade[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("crypto_posts_scan_day_idx").on(t.scanDay.desc())],
);

export type CryptoPost = typeof cryptoPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Crypto Weekly Research — Wicked-Stocks-style per-ticker writeup with two
// annotated charts (weekly + daily). Each ticker is its own post (one publish
// call per ticker), keyed on (ticker, scan_day). Mirrors the equity
// research_posts table, kept separate so equity and crypto pages stay clean.
// ----------------------------------------------------------------------------

export const cryptoWeeklyResearchPosts = pgTable(
  "crypto_weekly_research_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    scanDay: date("scan_day").notNull(),
    title: text("title").notNull(),
    headline: text("headline").notNull().default(""),
    bodyMd: text("body_md").notNull().default(""),
    images: jsonb("images").$type<ResearchImage[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crypto_weekly_research_ticker_day_idx").on(t.ticker, t.scanDay),
    index("crypto_weekly_research_scan_day_idx").on(t.scanDay.desc()),
    index("crypto_weekly_research_ticker_idx").on(t.ticker),
  ],
);

export type CryptoWeeklyResearchPost = typeof cryptoWeeklyResearchPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Institutional flow — weekly 13F scan published as ONE post per scan_day.
// The post body holds 5 candidate stocks in a structured jsonb array, each
// with per-fund holdings + a retail-attention block. Posts UPSERT by
// scan_day so re-runs on the same day overwrite cleanly.
// ----------------------------------------------------------------------------

export type InstitutionalSupportingFund = {
  fund: string;
  sharesNow: number;
  sharesPrior: number | null;
  deltaPct: number | null;
  isNewPosition: boolean;
};

export type InstitutionalRetailAttention = {
  googleTrendsScore: number | null;
  news30DayCount: number | null;
  isOnRetailHotlist: boolean;
  optionsCallPutOiRatio: number | null;
};

export type InstitutionalStock = {
  ticker: string;
  companyName: string;
  sector: string | null;
  marketCapUsdB: number | null;
  avgEntryPriceEstimate: number | null;
  currentPrice: number | null;
  totalSharesHeldUsd: number | null;
  totalSharesHeld: number | null;
  supportingFunds: InstitutionalSupportingFund[];
  retailAttention: InstitutionalRetailAttention;
  earningsNext: string | null;
  thesis: string;
  risks: string;
};

export const institutionalPosts = pgTable(
  "institutional_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull(),
    summary: text("summary").notNull().default(""),
    methodology: text("methodology").notNull().default(""),
    stocks: jsonb("stocks").$type<InstitutionalStock[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("institutional_posts_scan_day_idx").on(t.scanDay),
  ],
);

export type InstitutionalPost = typeof institutionalPosts.$inferSelect;

// Admin-editable list of funds the institutional scan should pull 13F
// filings for. Seeded with the v1 list (Berkshire, Bridgewater, RenTech,
// Citadel, Two Sigma); admin can add/disable through /admin/research/funds.
export const institutionalFunds = pgTable(
  "institutional_funds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    cik: text("cik").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("institutional_funds_cik_idx").on(t.cik),
    index("institutional_funds_enabled_idx").on(t.enabled, t.sortOrder),
  ],
);

export type InstitutionalFund = typeof institutionalFunds.$inferSelect;

// ----------------------------------------------------------------------------
// Earnings Whiplash Map — weekly scan that ranks the next ~2 weeks of S&P 500
// earnings reports by historical post-earnings move magnitude, then flags the
// names where the options-implied move is meaningfully BELOW the historical
// realized move (asymmetric setup). ONE row per scan_day; same UPSERT pattern
// as institutional_posts.
// ----------------------------------------------------------------------------

export type EarningsStock = {
  ticker: string;
  companyName: string;
  sector: string | null;
  marketCapUsdB: number | null;
  earningsDate: string;                    // YYYY-MM-DD (next report)
  earningsTime: "bmo" | "amc" | "unknown"; // before-market-open / after-market-close
  currentPrice: number | null;
  // Historical post-earnings realized move (absolute, %).
  historicalAvgMovePct: number | null;     // avg |move| over lookback
  historicalMaxMovePct: number | null;     // worst |move| over lookback
  historicalMovesAbove8Pct: number | null; // count of moves ≥ 8% in lookback
  lookbackQuarters: number | null;         // typically 8 (2 years)
  // Current options-implied move (front-month straddle/strangle-derived %).
  impliedMovePct: number | null;
  // impliedMovePct − historicalAvgMovePct. Negative = IV cheap vs HV.
  ivVsHvDeltaPct: number | null;
  // Top-3 asymmetric setups flagged by the routine.
  isFlagged: boolean;
  flagReason: string | null;
  thesis: string;
  risks: string;
};

export const earningsPosts = pgTable(
  "earnings_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull(),
    summary: text("summary").notNull().default(""),
    methodology: text("methodology").notNull().default(""),
    stocks: jsonb("stocks").$type<EarningsStock[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("earnings_posts_scan_day_idx").on(t.scanDay),
  ],
);

export type EarningsPost = typeof earningsPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Sector Rotation Detector — weekly scan that compares the last 30 days of
// each S&P 500 sector's relative strength against the same period one year
// ago. Identifies "rotation" — sectors where the relative-strength sign
// has FLIPPED. For each rotating sector, ranks the top 5 highest-volume
// sector ETFs by net money flow over the last 10 trading days.
// ONE row per scan_day; same UPSERT pattern as institutional/earnings.
// ----------------------------------------------------------------------------

export type RotationDirection =
  | "turning_positive"  // RS was negative a year ago, now positive
  | "turning_negative"  // RS was positive a year ago, now negative
  | "stable_positive"   // RS positive both windows
  | "stable_negative";  // RS negative both windows

export type SectorRotationEtf = {
  ticker: string;
  name: string;
  aumUsdB: number | null;
  avgDailyDollarVolumeUsd: number | null; // 10-day average
  moneyFlowUsd: number | null;            // 10-day net money flow ($ in − $ out)
  moneyFlowRank: number;                  // 1 = highest inflow within this sector
  currentPrice: number | null;
  thirtyDayReturnPct: number | null;
  note: string | null;                    // optional 1-line on each ETF
};

export type SectorRotationSector = {
  sectorName: string;                     // e.g. "Technology"
  sectorEtf: string;                      // primary SPDR proxy, e.g. "XLK"
  last30DayReturnPct: number | null;      // sector return last 30 days
  spy30DayReturnPct: number | null;       // SPY return same window
  relativeStrength: number | null;        // last30Day − spy30Day
  priorYear30DayReturnPct: number | null; // sector return prior-year same window
  spyPriorYear30DayReturnPct: number | null; // SPY return prior-year same window
  relativeStrengthPriorYear: number | null; // priorYear values
  rotationDirection: RotationDirection;
  rotationMagnitudePct: number | null;    // |rs − rs_prior|; bigger = more decisive flip
  isRotating: boolean;                    // true when direction is turning_*
  topEtfs: SectorRotationEtf[];           // up to 5; only populated for rotating sectors
  thesis: string;
  risks: string;
};

export const sectorRotationPosts = pgTable(
  "sector_rotation_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull(),
    summary: text("summary").notNull().default(""),
    methodology: text("methodology").notNull().default(""),
    sectors: jsonb("sectors").$type<SectorRotationSector[]>().notNull().default([]),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sector_rotation_posts_scan_day_idx").on(t.scanDay),
  ],
);

export type SectorRotationPost = typeof sectorRotationPosts.$inferSelect;

// ----------------------------------------------------------------------------
// Polymarket — wallet discovery + PnL scoring (Phase 2 of /polymarket).
// One row per wallet ever observed in a whale-sized trade. Wallet history is
// updated continuously by the /api/polymarket/ingest endpoint.
// ----------------------------------------------------------------------------

export const polymarketWallets = pgTable(
  "polymarket_wallets",
  {
    /** Lowercase 0x address, primary key. */
    address: text("address").primaryKey(),
    pseudonym: text("pseudonym"),
    displayName: text("display_name"),
    /** First time we observed this wallet (any size). */
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    /** Most recent trade we observed from this wallet. */
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    /** Total trades this wallet has appeared in (in the trade firehose we've sampled). */
    tradesSeen: integer("trades_seen").notNull().default(0),
    /** Subset of tradesSeen at or above the whale threshold (default $500). */
    whaleTradesSeen: integer("whale_trades_seen").notNull().default(0),
    /** Cumulative USD volume across observed trades. */
    totalVolumeUsd: numeric("total_volume_usd", { precision: 20, scale: 2 })
      .notNull()
      .default("0"),
    /** When we last successfully scored this wallet (null = never). */
    lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("polymarket_wallets_last_seen_idx").on(t.lastSeen.desc()),
    index("polymarket_wallets_volume_idx").on(t.totalVolumeUsd.desc()),
    index("polymarket_wallets_last_scored_idx").on(t.lastScoredAt.asc().nullsFirst()),
  ],
);

export type PolymarketWallet = typeof polymarketWallets.$inferSelect;

// One row per scoring snapshot. Latest score per wallet via DISTINCT ON.
// Historical scores are kept to track wallet performance over time.
export const polymarketWalletScores = pgTable(
  "polymarket_wallet_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wallet: text("wallet")
      .notNull()
      .references(() => polymarketWallets.address, { onDelete: "cascade" }),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
    /** Sum of cashPnl across resolved positions (positions Polymarket reports as resolved). */
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 4 }).notNull().default("0"),
    /** Sum of cashPnl across open (unresolved) positions — i.e. mark-to-market. */
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 4 }).notNull().default("0"),
    /** Total dollars deployed across positions returned by /positions. */
    capitalDeployedUsd: numeric("capital_deployed_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    /** Realized PnL / capital deployed, as a fraction (e.g. 0.21 = +21%). */
    roi: numeric("roi", { precision: 12, scale: 6 }),
    /** Number of positions returned by /positions at scoring time. */
    positionCount: integer("position_count").notNull().default(0),
    /** Composite score — see lib/polymarket.ts for the math. */
    compositeScore: numeric("composite_score", { precision: 14, scale: 4 }),
    /** Raw response sample for audit/debug. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("polymarket_wallet_scores_wallet_idx").on(t.wallet, t.scoredAt.desc()),
    index("polymarket_wallet_scores_composite_idx").on(t.compositeScore.desc()),
  ],
);

export type PolymarketWalletScore = typeof polymarketWalletScores.$inferSelect;

// Whale-sized trades persisted from the ingestion firehose. Phase 3 reads
// from this table to detect convergence (≥2 top wallets, same market+side,
// 24h window) and surface fresh signals from high-scorer wallets.
//
// Filtered to USD ≥ MIN_WHALE_USD at ingest time to keep storage sane.
// Natural key (transaction_hash, asset) for dedupe.
export const polymarketTrades = pgTable(
  "polymarket_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionHash: text("transaction_hash").notNull(),
    asset: text("asset").notNull(),
    /** Lowercase 0x — matches polymarket_wallets.address. */
    wallet: text("wallet").notNull(),
    conditionId: text("condition_id").notNull(),
    side: text("side").notNull(), // BUY | SELL
    size: numeric("size", { precision: 24, scale: 6 }).notNull(),
    /** Implied probability in [0, 1] = USDC per share. */
    price: numeric("price", { precision: 10, scale: 6 }).notNull(),
    /** size × price, denormalized for fast filtering. */
    usdValue: numeric("usd_value", { precision: 20, scale: 4 }).notNull(),
    outcome: text("outcome"),
    outcomeIndex: integer("outcome_index"),
    title: text("title"),
    slug: text("slug"),
    eventSlug: text("event_slug"),
    /** Trade time (Polymarket-reported, Unix→tz). */
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("polymarket_trades_uniq_idx").on(t.transactionHash, t.asset),
    index("polymarket_trades_wallet_ts_idx").on(t.wallet, t.timestamp.desc()),
    index("polymarket_trades_condition_ts_idx").on(t.conditionId, t.timestamp.desc()),
    index("polymarket_trades_ts_idx").on(t.timestamp.desc()),
  ],
);

export type PolymarketTrade = typeof polymarketTrades.$inferSelect;

// Cached Gamma event metadata, keyed by event_slug. We use this to attach
// a category (Sports / Politics / Crypto / Macro / etc.) to each trade for
// filtering on the Signals page. Lazy-populated by the ingest endpoint.
export const polymarketEvents = pgTable(
  "polymarket_events",
  {
    eventSlug: text("event_slug").primaryKey(),
    category: text("category"),
    title: text("title"),
    /** Tag slugs from Gamma (e.g. ["nfl", "all"]). Useful for sub-filters later. */
    tagSlugs: text("tag_slugs").array().notNull().default(sql`ARRAY[]::text[]`),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("polymarket_events_category_idx").on(t.category)],
);

export type PolymarketEvent = typeof polymarketEvents.$inferSelect;

// ---------------------------------------------------------------------------
// BotWick — automated options trading bot (Tradier-backed)
// ---------------------------------------------------------------------------
// The bot is intentionally OFF by default and requires an admin to enable it,
// pick a mode (paper / live), and select which trade-plan grades it will act
// on. The risk engine and OMS read from `bot_config` on every tick; UI reads
// from `bot_actions` and `bot_trades` for status + journal.

export type BotMode = "paper" | "live" | "off";
export type BotGradeFilter = "A+" | "A" | "A-" | "B+" | "ALL";
/** Active signal-generation strategy. New strategies plug in by adding to
 *  this union AND to the registry in lib/botwick/strategies/index.ts. */
export type SignalStrategy =
  | "alma_vwap_cross"
  | "plan_based"        // deprecated — kept in DB enum for back-compat
  | "alma_plus_plan"    // deprecated — depends on plan_based
  | "alma_9_39_rsi";    // ALMA 9/39 cross + RSI + Chop + VWAP + Session
export type BotActionKind =
  | "config_change"      // admin toggled enabled / mode / grade
  | "plan_received"      // 0DTE plan ingested
  | "plan_skipped"       // plan failed grade filter or risk check
  | "plan_expired"       // pending/armed plan auto-cancelled (stale day, end-of-day sweep)
  | "monitor_tick"       // monitoring pass started/finished
  | "quote_refresh"      // live quote pulled from Tradier
  | "signal_armed"       // entry condition met on underlying state
  | "signal_fired"       // armed AND passed live re-risk-check (Phase 3b+)
  | "order_submitted"    // OMS submitted to Tradier
  | "order_filled"
  | "order_partial"
  | "order_rejected"
  | "order_cancelled"
  | "exit_target_hit"
  | "exit_stop_hit"
  | "exit_time_stop"
  | "exit_alma_reversal"
  | "exit_alma_break"    // price closed back through ALMA9 by > threshold
  | "exit_alma_939"      // ALMA 9/39 RSI strategy exit (stop / TP / ALMA / VWAP)
  | "force_exit"         // day-trade force-close fired (15:55 ET sweep)
  | "risk_block"         // risk engine refused to place
  | "kill_switch"        // emergency stop hit
  | "error";

export type BotTradeStatus =
  | "pending"        // ingested, waiting for entry trigger
  | "signal_armed"   // entry condition met on underlying data
  | "signal_fired"   // armed AND passed live re-risk-check
  | "submitting"     // claim taken — about to POST to Tradier (race-safe gate)
  | "working"        // order submitted, not yet filled
  | "open"           // filled, position live
  | "closing"        // exit order submitted
  | "closed"         // fully closed
  | "rejected"
  | "cancelled"
  | "errored";

/**
 * Singleton-style bot configuration row. We enforce singleton via a CHECK in
 * a follow-up migration; for now app code uses where(id = "default").
 */
export const botConfig = pgTable("bot_config", {
  id: text("id").primaryKey().default("default"),
  // Master switch. When false, the runner does NOT submit any orders even if
  // mode is "live"/"paper". User dashboard reflects this immediately.
  enabled: boolean("enabled").notNull().default(false),
  // off | paper | live. Paper hits Tradier sandbox; live hits production.
  mode: text("mode").$type<BotMode>().notNull().default("off"),
  // Which trade-plan grades the bot will act on.
  gradeFilter: text("grade_filter").$type<BotGradeFilter>().notNull().default("A+"),
  // Hard cap on dollars at risk per trade (premium debit, or max-loss for spreads).
  maxRiskPerTradeUsd: numeric("max_risk_per_trade_usd", { precision: 14, scale: 2 })
    .notNull()
    .default("250.00"),
  // Hard cap on stock-mode notional exposure per trade ($shares × price). Used
  // when a strategy is in instrument_mode=stock_long. Independent of
  // maxRiskPerTradeUsd because $1k options budget ≠ $1k of shares (linear vs
  // leveraged exposure).
  maxStockNotionalUsd: numeric("max_stock_notional_usd", { precision: 14, scale: 2 })
    .notNull()
    .default("10000.00"),
  // Hard cap on total realized + unrealized PnL drawdown for the trading day
  // (in dollars, positive number). Hit → kill switch trips.
  maxDailyLossUsd: numeric("max_daily_loss_usd", { precision: 14, scale: 2 })
    .notNull()
    .default("500.00"),
  // Concurrent open positions cap.
  maxOpenPositions: integer("max_open_positions").notNull().default(3),
  // Plan-slippage guard for the live-mid re-check (Phase 3b+).
  // If abs(liveMid - planMid) / planMid > this %, the live re-check blocks
  // promotion of signal_armed → signal_fired. Catches overnight gaps and
  // egregious option-price moves where the plan's premise may no longer hold.
  // Stored as a percent: "50.00" = 50%.
  maxPlanSlippagePct: numeric("max_plan_slippage_pct", { precision: 6, scale: 2 })
    .notNull()
    .default("50.00"),
  // Day-trade force-exit. When true (default), at 15:55 ET the bot:
  //   - cancels all pending / signal_armed / working entry orders
  //   - submits MARKET sell_to_close orders for all open positions
  // Keeps the bot honest as 0DTE-only — nothing rides overnight, no
  // theta-decay-to-zero on options that didn't print intrinsic value, no
  // pin risk near close. Disable only if you mean to swing trades manually.
  dayTradeForceExit: boolean("day_trade_force_exit").notNull().default(true),
  // Which signal-generation strategy is active. The bot honors exactly one
  // at a time. See lib/botwick/strategies/index.ts for the catalog +
  // semantics. Default keeps existing behavior (plan-based) so installs
  // that predate the SIGNALS tab don't change behavior on upgrade.
  activeSignalStrategy: text("active_signal_strategy")
    .$type<SignalStrategy>()
    .notNull()
    .default("plan_based"),
  // Dollar amount per trade — used by signal strategies that compute their
  // own size (e.g. ALMA strategies select contracts by mid × 100 ≤ this).
  // Independent from maxRiskPerTradeUsd which is the hard cap on max-loss
  // for an individual contract; positionSizeUsd is the *intent* amount.
  positionSizeUsd: numeric("position_size_usd", { precision: 14, scale: 2 })
    .notNull()
    .default("500.00"),
  // Instrument: trade options (default), buy shares on long signals, short
  // shares on short signals, or both. In stock_long/stock_short modes the
  // signals on the other side get a warning + skip; stock_both fires both.
  // Stock shorts require a margin account at Tradier.
  almaInstrumentMode: text("alma_instrument_mode")
    .$type<"options" | "stock_long" | "stock_short" | "stock_both">()
    .notNull()
    .default("options"),
  // Tickers the ALMA × VWAP strategy scans (it has no plan-source to derive
  // tickers from like plan_based does). Admin editable.
  almaWatchlist: text("alma_watchlist")
    .array()
    .notNull()
    .default(sql`ARRAY['SPY','QQQ']::text[]`),
  // "Steep" threshold for the ALMA slope at cross-time, as % change per
  // bar. Smaller = more permissive cross, more setups. Default 0.05%.
  almaSteepSlopePct: numeric("alma_steep_slope_pct", { precision: 6, scale: 4 })
    .notNull()
    .default("0.05"),
  // Cool-down window after a fresh ARM (in 5-min bars). During the cool-down,
  // a close that crosses back through VWAP does NOT clear READY — we wait
  // through whippy bars and only fire on the first pullback that matches
  // the band. After cool-down expires, the standard close-still-holds guard
  // resumes. Default 5 (≈25 min).
  almaPullbackCoolDownBars: integer("alma_pullback_cool_down_bars")
    .notNull()
    .default(5),
  // Pullback band: max depth (% of ALMA) the wick may go beyond ALMA9 and
  // still count as a valid pullback. For LONG, bar.low must be in
  // [ALMA × (1 − thresh/100), ALMA]. Wicks deeper than this are treated as
  // real reversals, not pullbacks. Default 0.10% (typical 0DTE wick tolerance).
  almaPullbackThresholdPct: numeric("alma_pullback_threshold_pct", { precision: 6, scale: 4 })
    .notNull()
    .default("0.10"),
  // Smart re-pegging for entry orders. After an entry order sits unfilled
  // for one monitor tick (~5 min), we cancel and re-submit at a slightly
  // worsened limit. After `entryRepegMax` such attempts, we cross the
  // spread with a MARKET order so the trade actually starts. Default 2 →
  // mid → mid+1c → market. Set to 0 to disable re-pegging entirely.
  entryRepegMax: integer("entry_repeg_max").notNull().default(2),
  // Drift cap for re-pegs: if the live mid has moved MORE than this percent
  // ABOVE the original signal mid (for buys), the re-peg abandons the trade
  // instead of chasing. Protects against premium runs like
  // $0.64 → $1.47 (130%) where the original sizing was correct but the price
  // is no longer the setup we intended to enter. The check is asymmetric —
  // a CHEAPER live mid is always allowed (better fill than expected).
  // Default 10%. Set very high (e.g. 1000) to effectively disable.
  entryRepegMaxDriftPct: numeric("entry_repeg_max_drift_pct", { precision: 6, scale: 2 })
    .notNull()
    .default("10.00"),
  // Default exit policy — applied to any trade whose AST is missing the
  // corresponding branch. ALMA × VWAP trades always use these (the strategy
  // doesn't generate per-trade exits). Plan-based trades use their plan's
  // exits when the parser recognised them, falling back to these defaults
  // for any null branch. Without this safety net, an ALMA trade rides until
  // 15:55 force-exit regardless of P&L.
  //
  // All percentages are positive magnitudes; sign is applied internally.
  defaultTarget1Pct: numeric("default_target1_pct", { precision: 6, scale: 2 })
    .notNull()
    .default("50.00"),
  defaultTarget2Pct: numeric("default_target2_pct", { precision: 6, scale: 2 })
    .notNull()
    .default("100.00"),
  defaultStopLossPct: numeric("default_stop_loss_pct", { precision: 6, scale: 2 })
    .notNull()
    .default("30.00"),
  defaultTimeStopMin: integer("default_time_stop_min").notNull().default(120),
  // Optional ALMA-reversal exit filter. When true, in addition to the
  // standard exit checks (target / stop / time_stop), each open position is
  // checked on every tick for a "directional reversal":
  //   - LONG  position → ALMA(9) crosses BELOW VWAP → market sell_to_close
  //   - SHORT position → ALMA(9) crosses ABOVE VWAP → market sell_to_close
  // Runs independently of which signal strategy spawned the trade, so a
  // plan-based long-call benefits from the reversal exit the same way an
  // ALMA × VWAP trade does. Priority: stop > reversal > target > time_stop.
  // Default OFF — opt-in.
  almaReversalExit: boolean("alma_reversal_exit").notNull().default(false),
  // Optional Price-Reversal ALMA exit. Fires sooner than `almaReversalExit`
  // (which waits for ALMA itself to cross VWAP). This one watches the price
  // close vs the ALMA line directly:
  //   LONG  → bar.close < ALMA × (1 − threshold/100)
  //   SHORT → bar.close > ALMA × (1 + threshold/100)
  // On match → MARKET sell_to_close. Independent of almaReversalExit; both
  // can be on at the same time (this fires first because it's earlier).
  // Default OFF; default threshold 0.05% (typical 0DTE noise band).
  priceReversalAlmaExit: boolean("price_reversal_alma_exit").notNull().default(false),
  priceReversalAlmaThresholdPct: numeric("price_reversal_alma_threshold_pct", {
    precision: 6,
    scale: 4,
  })
    .notNull()
    .default("0.05"),
  // Grace period (in 5-min bars after fill) during which the Price-Reversal
  // ALMA exit is INACTIVE. Lets a fresh trade develop without getting kicked
  // out on intra-bar noise. Default 5 → exit becomes active on the 6th bar
  // after entry (~25 minutes). Setting to 0 disables the grace period.
  priceReversalAlmaGraceBars: integer("price_reversal_alma_grace_bars")
    .notNull()
    .default(5),

  // ──────────────────────────────────────────────────────────────────────
  // ALMA 9/39 RSI strategy (Option 2)
  // ──────────────────────────────────────────────────────────────────────
  // Instrument: see almaInstrumentMode docs — same four modes.
  alma939InstrumentMode: text("alma939_instrument_mode")
    .$type<"options" | "stock_long" | "stock_short" | "stock_both">()
    .notNull()
    .default("options"),
  // Per-strategy watchlist so Option 1's tickers don't bleed in.
  alma939Watchlist: text("alma939_watchlist")
    .array()
    .notNull()
    .default(sql`ARRAY['SPY','QQQ']::text[]`),
  // ALMA indicator settings (mirror Pinescript defaults).
  alma939FastLen: integer("alma939_fast_len").notNull().default(9),
  alma939SlowLen: integer("alma939_slow_len").notNull().default(39),
  alma939Offset: numeric("alma939_offset", { precision: 4, scale: 2 })
    .notNull()
    .default("0.85"),
  alma939Sigma: numeric("alma939_sigma", { precision: 4, scale: 1 })
    .notNull()
    .default("6.0"),
  // RSI filter.
  alma939UseRsiFilter: boolean("alma939_use_rsi_filter").notNull().default(true),
  alma939RsiLen: integer("alma939_rsi_len").notNull().default(14),
  alma939LongRsiMin: numeric("alma939_long_rsi_min", { precision: 5, scale: 2 })
    .notNull()
    .default("50.00"),
  alma939LongRsiMax: numeric("alma939_long_rsi_max", { precision: 5, scale: 2 })
    .notNull()
    .default("72.00"),
  alma939ShortRsiMin: numeric("alma939_short_rsi_min", { precision: 5, scale: 2 })
    .notNull()
    .default("28.00"),
  alma939ShortRsiMax: numeric("alma939_short_rsi_max", { precision: 5, scale: 2 })
    .notNull()
    .default("50.00"),
  // Choppiness Index filter.
  alma939UseChopFilter: boolean("alma939_use_chop_filter").notNull().default(true),
  alma939ChopLen: integer("alma939_chop_len").notNull().default(14),
  alma939ChopThreshold: numeric("alma939_chop_threshold", { precision: 5, scale: 2 })
    .notNull()
    .default("50.00"),
  alma939ChopMode: text("alma939_chop_mode").$type<"below" | "above">().notNull().default("below"),
  // VWAP entry filter.
  alma939UseVwapEntryFilter: boolean("alma939_use_vwap_entry_filter").notNull().default(true),
  alma939VwapLongMode: text("alma939_vwap_long_mode").$type<"close" | "hl2">().notNull().default("close"),
  alma939VwapShortMode: text("alma939_vwap_short_mode").$type<"close" | "hl2">().notNull().default("close"),
  // Session + force-close.
  alma939UseSessionFilter: boolean("alma939_use_session_filter").notNull().default(true),
  alma939SessionStart: text("alma939_session_start").notNull().default("09:30"),
  alma939SessionEnd: text("alma939_session_end").notNull().default("16:00"),
  alma939UseForceClose: boolean("alma939_use_force_close").notNull().default(true),
  alma939ForceCloseHour: integer("alma939_force_close_hour").notNull().default(15),
  alma939ForceCloseMinute: integer("alma939_force_close_minute").notNull().default(55),
  // ALMA-based exits (close vs ALMA39, ALMA9 × ALMA39 cross).
  alma939UseAlmaSignalExits: boolean("alma939_use_alma_signal_exits").notNull().default(false),
  alma939UseLongCloseBelowAlma39Exit: boolean("alma939_use_long_close_below_alma39_exit").notNull().default(true),
  alma939UseLongAlmaCrossDownExit: boolean("alma939_use_long_alma_cross_down_exit").notNull().default(true),
  alma939UseShortCloseAboveAlma39Exit: boolean("alma939_use_short_close_above_alma39_exit").notNull().default(true),
  alma939UseShortAlmaCrossUpExit: boolean("alma939_use_short_alma_cross_up_exit").notNull().default(true),
  // VWAP-based exits (close vs VWAP, ALMA9 × VWAP cross + close confirms).
  alma939UseVwapExitRules: boolean("alma939_use_vwap_exit_rules").notNull().default(true),
  alma939UseLongCloseBelowVwapExit: boolean("alma939_use_long_close_below_vwap_exit").notNull().default(false),
  alma939UseShortCloseAboveVwapExit: boolean("alma939_use_short_close_above_vwap_exit").notNull().default(false),
  alma939UseLongAlma9CrossBelowVwapExit: boolean("alma939_use_long_alma9_cross_below_vwap_exit").notNull().default(true),
  alma939UseShortAlma9CrossAboveVwapExit: boolean("alma939_use_short_alma9_cross_above_vwap_exit").notNull().default(true),
  // Stop loss — fixed % or trailing % on underlying. Trailing source can be
  // the previous bar's extreme (Pine "prev_extreme" semantic), current bar's
  // extreme, or the close. Trailing stop only ever moves in the favorable
  // direction (up for long, down for short).
  alma939UseStopLoss: boolean("alma939_use_stop_loss").notNull().default(true),
  alma939SlMode: text("alma939_sl_mode").$type<"fixed" | "trailing">().notNull().default("fixed"),
  alma939FixedSlPct: numeric("alma939_fixed_sl_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("1.00"),
  alma939TrailSlPct: numeric("alma939_trail_sl_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("1.00"),
  alma939TrailUpdateMode: text("alma939_trail_update_mode")
    .$type<"prev_extreme" | "curr_extreme" | "close">()
    .notNull()
    .default("prev_extreme"),
  // Profit targets — up to 5 levels, each with its own scale-out % of the
  // original position size. Levels are on the underlying price (% from entry
  // underlying). Each fires once. After all selected TPs fire, any remaining
  // qty rides the trailing/fixed stop or the ALMA/VWAP exit rules.
  alma939UseProfitTargets: boolean("alma939_use_profit_targets").notNull().default(true),
  alma939UseTp1: boolean("alma939_use_tp1").notNull().default(true),
  alma939Tp1Pct: numeric("alma939_tp1_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0.50"),
  alma939Tp1Qty: numeric("alma939_tp1_qty", { precision: 5, scale: 2 })
    .notNull()
    .default("20.00"),
  alma939UseTp2: boolean("alma939_use_tp2").notNull().default(true),
  alma939Tp2Pct: numeric("alma939_tp2_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("1.00"),
  alma939Tp2Qty: numeric("alma939_tp2_qty", { precision: 5, scale: 2 })
    .notNull()
    .default("20.00"),
  alma939UseTp3: boolean("alma939_use_tp3").notNull().default(true),
  alma939Tp3Pct: numeric("alma939_tp3_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("1.50"),
  alma939Tp3Qty: numeric("alma939_tp3_qty", { precision: 5, scale: 2 })
    .notNull()
    .default("20.00"),
  alma939UseTp4: boolean("alma939_use_tp4").notNull().default(true),
  alma939Tp4Pct: numeric("alma939_tp4_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("2.00"),
  alma939Tp4Qty: numeric("alma939_tp4_qty", { precision: 5, scale: 2 })
    .notNull()
    .default("20.00"),
  alma939UseTp5: boolean("alma939_use_tp5").notNull().default(true),
  alma939Tp5Pct: numeric("alma939_tp5_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("2.50"),
  alma939Tp5Qty: numeric("alma939_tp5_qty", { precision: 5, scale: 2 })
    .notNull()
    .default("20.00"),

  // Hard manual kill switch. When true, everything halts and exit orders fire
  // on any open positions. Admin must clear it explicitly to resume.
  killSwitchEngaged: boolean("kill_switch_engaged").notNull().default(false),
  killSwitchReason: text("kill_switch_reason"),
  // Independent safety rail for live trading. The OMS (Phase 4+) MUST refuse
  // to submit live orders unless this is true AND mode=live AND enabled AND
  // !killSwitchEngaged. Lets us safely run mode=live for real-time data
  // monitoring today without risking that Phase 4 silently arms real trading
  // the moment we deploy it. Defaults false; admin flips explicitly with
  // full acknowledgment copy.
  liveOrdersConfirmed: boolean("live_orders_confirmed").notNull().default(false),
  // Tradier creds — stored encrypted at rest in a follow-up. For now plain
  // env-driven; these columns let the admin UI surface that they're set
  // without us roundtripping the secret.
  tradierAccountId: text("tradier_account_id"),
  tradierEnv: text("tradier_env"), // "sandbox" | "production"
  // Free-form prefs for the risk engine + selector (jsonb so it's evolvable
  // without migrations).
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type BotConfig = typeof botConfig.$inferSelect;

/**
 * Append-only audit / event log. The "Matrix" user view streams the most
 * recent N rows so the user can watch the bot work in real time.
 */
export const botActions = pgTable(
  "bot_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").$type<BotActionKind>().notNull(),
    // Severity for color-coding in the UI: "info" | "warn" | "error" | "success".
    severity: text("severity").notNull().default("info"),
    // Human-readable line: "Signal fired — TSLA 437.5P @ $4.80 mid".
    message: text("message").notNull(),
    // Optional linkage to the trade this event belongs to.
    tradeId: uuid("trade_id").references(() => botTrades.id, { onDelete: "set null" }),
    // Structured payload for debugging / replay.
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // Set by the Reset & Archive admin action. Activity tab filters
    // archivedAt IS NULL; Archive tab shows archivedAt IS NOT NULL, grouped
    // by archivedAt batch.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("bot_actions_ts_idx").on(t.ts.desc()),
    index("bot_actions_kind_ts_idx").on(t.kind, t.ts.desc()),
    index("bot_actions_trade_idx").on(t.tradeId),
    index("bot_actions_archived_idx").on(t.archivedAt),
  ],
);

export type BotAction = typeof botActions.$inferSelect;

/**
 * One row per trade intent. Lifecycle: pending → working → open → closing →
 * closed (or rejected / cancelled / errored). Multi-leg orders store legs
 * inside `legs` jsonb so we don't need a join table at this stage.
 */
export const botTrades = pgTable(
  "bot_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Which trading-day post the trade was sourced from (FK kept loose with
    // text so we don't break if the post is deleted).
    sourcePostDay: date("source_post_day"),
    sourceTicker: text("source_ticker").notNull(),
    sourceGrade: text("source_grade"),
    // Strategy taxonomy: "long_call" | "long_put" | "credit_put_spread" | ...
    strategy: text("strategy").notNull(),
    // Tradier-side identifiers, populated as the OMS progresses.
    tradierOrderId: text("tradier_order_id"),
    tradierPositionId: text("tradier_position_id"),
    // Legs: each is { side, option_symbol, strike, expiry, qty, fill_price }
    legs: jsonb("legs").$type<Array<Record<string, unknown>>>().notNull().default([]),
    // Plan inputs captured at signal time — so we can audit slippage later.
    plan: jsonb("plan").$type<Record<string, unknown>>().notNull().default({}),
    // Mode at time of placement: "paper" or "live". Important for journaling.
    mode: text("mode").$type<BotMode>().notNull(),
    status: text("status").$type<BotTradeStatus>().notNull().default("pending"),
    // Money fields.
    entryFillUsd: numeric("entry_fill_usd", { precision: 14, scale: 4 }),
    exitFillUsd: numeric("exit_fill_usd", { precision: 14, scale: 4 }),
    realizedPnlUsd: numeric("realized_pnl_usd", { precision: 14, scale: 2 }),
    // Lifecycle timestamps.
    signaledAt: timestamp("signaled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // First time the entry condition matched on underlying data (Phase 3a+).
    // Distinct from `signaledAt` (set at ingest) so we can measure
    // ingest-to-armed latency.
    entrySignaledAt: timestamp("entry_signaled_at", { withTimezone: true }),
    // Set when status transitions signal_fired → submitting. Used by the
    // broker-side reconcile job to detect rows that have been stuck in
    // 'submitting' longer than the threshold (typically because the process
    // died between Tradier POST and the commit UPDATE).
    submittingAt: timestamp("submitting_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Set by the Reset & Archive admin action. Only terminal-state trades
    // (closed/cancelled/rejected/errored) and non-actionable trades
    // (pending/signal_armed/signal_fired) are archivable. Live trades
    // (submitting/working/open/closing) are NEVER archived — they're real
    // money in flight.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("bot_trades_status_idx").on(t.status),
    index("bot_trades_signaled_idx").on(t.signaledAt.desc()),
    index("bot_trades_ticker_idx").on(t.sourceTicker),
    index("bot_trades_archived_idx").on(t.archivedAt),
  ],
);

export type BotTrade = typeof botTrades.$inferSelect;

/**
 * ALMA × VWAP READY-state cache. One row per ticker currently in the
 * "armed for pullback entry" state. On cross-detection we insert/upsert;
 * on entry-fire we delete; on day-end (force-exit) we wipe. Primary key on
 * ticker enforces "one READY per ticker at a time."
 */
export const botAlmaState = pgTable("bot_alma_state", {
  ticker: text("ticker").primaryKey(),
  /** Side of the trade the READY corresponds to. */
  side: text("side").$type<"long" | "short">().notNull(),
  /** When the cross was detected and we entered READY. */
  readyAt: timestamp("ready_at", { withTimezone: true }).notNull().defaultNow(),
  /** ALMA value at the bar of the cross. Stored for audit / debugging. */
  almaAtCross: numeric("alma_at_cross", { precision: 14, scale: 4 }).notNull(),
  /** VWAP value at the bar of the cross. Same. */
  vwapAtCross: numeric("vwap_at_cross", { precision: 14, scale: 4 }).notNull(),
  /** Slope (% per bar) at cross-time. */
  slopePctAtCross: numeric("slope_pct_at_cross", { precision: 8, scale: 4 }).notNull(),
});

export type BotAlmaState = typeof botAlmaState.$inferSelect;

/**
 * BotWick backtest runs. One row per admin-triggered backtest. The row
 * carries its full config snapshot, the list of synthetic signals it
 * produced, and the aggregate metrics — so the UI can re-display past runs
 * without re-running anything.
 *
 * `signals` shape (jsonb array):
 *   [{ ticker, side, signalAt, almaAtCross, vwapAtCross, slopePct,
 *      pullbackAt, underlyingAtSignal, otmStrike,
 *      touched, maxFavorablePct, maxAdversePct, timeToTouchMin }]
 *
 * `summary` shape (jsonb):
 *   { totalSignals, hitRate, avgFavorablePct, avgAdversePct, byTicker }
 *
 * `config` shape (jsonb):
 *   { strategy, fromDay, toDay, watchlist, slopePct }
 */
export const botBacktestRuns = pgTable(
  "bot_backtest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    startedBy: text("started_by").references(() => users.id, { onDelete: "set null" }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    signals: jsonb("signals").$type<Array<Record<string, unknown>>>().notNull().default([]),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"running" | "complete" | "failed">().notNull().default("running"),
    error: text("error"),
  },
  (t) => [index("bot_backtest_runs_started_idx").on(t.startedAt.desc())],
);

export type BotBacktestRun = typeof botBacktestRuns.$inferSelect;

// ============================================================================
// Options Edge — IV surface anomaly scanner.
//
// Two tables:
//   1. ivSnapshots — daily per-ticker constant-maturity IV + HV surface points,
//      backfilled 12 months from Polygon's as_of endpoint and refreshed
//      weekly. The historical depth here is what makes IV rank / z-scores
//      possible from day one.
//   2. optionsEdgeScans — weekly scan posts: ranked anomaly list +
//      summary + suggested trade per anomaly. The /research/options-edge
//      surface reads these.
// ============================================================================

export const ivSnapshots = pgTable(
  "iv_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    /** Snapshot calendar date (the Polygon `as_of` date the chain was
     *  pulled at). Daily granularity. */
    snapshotDate: date("snapshot_date").notNull(),
    /** Underlying spot price at the snapshot. */
    underlyingPrice: numeric("underlying_price", { precision: 14, scale: 4 }),
    /** Constant-maturity 30-day ATM IV. Linearly interpolated between the
     *  two listed expiries that bracket 30 DTE. */
    atmIv30d: numeric("atm_iv_30d", { precision: 8, scale: 6 }),
    /** Constant-maturity 60-day ATM IV. */
    atmIv60d: numeric("atm_iv_60d", { precision: 8, scale: 6 }),
    /** 25-delta put IV at the 30-day tenor. */
    put25dIv30d: numeric("put_25d_iv_30d", { precision: 8, scale: 6 }),
    /** 25-delta call IV at the 30-day tenor. */
    call25dIv30d: numeric("call_25d_iv_30d", { precision: 8, scale: 6 }),
    /** 30-day realized historical volatility computed from underlying
     *  daily bars (annualized log-return stdev). */
    hv30d: numeric("hv_30d", { precision: 8, scale: 6 }),
    /** Fit metadata — strike count, interpolation source, error flags. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("iv_snapshots_ticker_date_idx").on(t.ticker, t.snapshotDate),
    index("iv_snapshots_ticker_date_desc_idx").on(
      t.ticker,
      t.snapshotDate.desc(),
    ),
  ],
);

export type IvSnapshot = typeof ivSnapshots.$inferSelect;

/** A single anomaly the scanner flagged. The metric tells you what's
 *  out-of-line; zScore + percentileRank give the strength. */
/** One leg of a suggested trade structure. The scanner returns these so
 *  the UI can render concrete strike levels next to the strategy name —
 *  e.g. "Sell 145P / 175C · Buy 125P / 195C" for an iron condor. Strikes
 *  are computed from a Black-Scholes delta approximation against the
 *  surface (spot × exp(±N⁻¹(δ) · σ√T)) then snapped to the nearest
 *  listed-options grid. They are SUGGESTIONS, not live quotes. */
export interface TradeLeg {
  side: "buy" | "sell";
  type: "call" | "put";
  /** Snapped strike in dollars. */
  strike: number;
  /** Target days-to-expiration (30 or 60 for the Options Edge structures). */
  dte: number;
}

export interface OptionsEdgeAnomaly {
  ticker: string;
  /** What's anomalous. */
  metric:
    | "atm_iv_rank"      // current ATM IV percentile vs 1y history
    | "skew_z"           // 25Δ put-call IV spread vs 1y norm
    | "term_z"           // 60d - 30d slope vs 1y norm
    | "iv_hv_ratio";     // IV30 / HV30 vs 1y norm
  /** Current observed value. */
  currentValue: number;
  /** 1-year z-score (how many stdevs from the mean). */
  zScore: number;
  /** 0-100. 95 = current value in the top 5%. */
  percentileRank: number;
  /** "high" = sell-vol candidate; "low" = buy-vol candidate. */
  direction: "high" | "low";
  /** Suggested trade strategy in trader vocabulary
   *  (e.g. "sell 30d 25-delta strangle", "buy 60d ATM straddle"). */
  suggestedStrategy: string;
  /** One-line plain-English thesis. */
  thesis: string;
  /** Surface snapshot at scan time — for the page to render context. */
  surface: {
    atmIv30d: number | null;
    put25dIv30d: number | null;
    call25dIv30d: number | null;
    hv30d: number | null;
    underlyingPrice: number | null;
  };
  /** Concrete suggested strikes per leg. Optional — older scans
   *  predating this field won't have it; the UI hides the strike row
   *  when missing. */
  legs?: TradeLeg[];
}

export const optionsEdgeScans = pgTable(
  "options_edge_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Scan day. Sunday is the canonical publish day. */
    scanDay: date("scan_day").notNull().unique(),
    title: text("title").notNull(),
    /** Prose summary the routine wrote — rendered as the post body. */
    summary: text("summary").notNull().default(""),
    /** Ranked anomaly list (top N across all metrics). */
    anomalies: jsonb("anomalies")
      .$type<OptionsEdgeAnomaly[]>()
      .notNull()
      .default([]),
    /** How many tickers were scanned. */
    universeSize: integer("universe_size").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("options_edge_scans_scan_day_idx").on(t.scanDay.desc())],
);

export type OptionsEdgeScan = typeof optionsEdgeScans.$inferSelect;

// ============================================================================
// UNUSUAL OPTIONS ACTIVITY (UOA)
//
// Smart-money flow scanner. Two tables:
//   1. uoaPrints — raw filtered prints. Each row is one option trade
//      that cleared the unusual-activity bar (premium > $50k, OI mult
//      > 3x, opening-trade aggressor signal). Populated by an EOD
//      cron + an intraday 5-min cron during RTH.
//   2. uoaScans — daily summary post. UPSERTs on scan_day; one row
//      per trading day with the top N prints + classification
//      breakdown + prose summary.
//
// The Sweep flag uses Polygon's condition code 41 (intermarket sweep
// order) — a single order broken across exchanges, conventionally
// read as urgent / institutional. Aggressor side is classified from
// the bid/ask at trade time: at-or-above ask → aggressive buyer,
// at-or-below bid → aggressive seller, midmarket → ambiguous.
// ============================================================================

/** UOA print classification. Drives the per-card color + the
 *  "bullish call buying" / "bearish put buying" copy. */
export type UoaClassification =
  | "bullish_call_buy"   // aggressive buyer of calls — bullish bet
  | "bearish_put_buy"    // aggressive buyer of puts — bearish bet
  | "call_sell"          // aggressive seller of calls (short call)
  | "put_sell"           // aggressive seller of puts (short put / cash-secured)
  | "ambiguous";         // couldn't classify cleanly (midmarket fill, etc)

export const uoaPrints = pgTable(
  "uoa_prints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** When the trade actually printed (Polygon participant_timestamp). */
    printTs: timestamp("print_ts", { withTimezone: true }).notNull(),
    /** When our cron pulled + classified it. */
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    underlying: text("underlying").notNull(),
    contractTicker: text("contract_ticker").notNull(),
    expirationDate: date("expiration_date").notNull(),
    strike: numeric("strike", { precision: 14, scale: 4 }).notNull(),
    contractType: text("contract_type").notNull(), // 'call' | 'put'

    side: text("side").notNull(), // 'buy' | 'sell' aggressor
    size: integer("size").notNull(),
    price: numeric("price", { precision: 14, scale: 4 }).notNull(),
    premiumUsd: numeric("premium_usd", { precision: 16, scale: 2 }).notNull(),

    bidAtTrade: numeric("bid_at_trade", { precision: 14, scale: 4 }),
    askAtTrade: numeric("ask_at_trade", { precision: 14, scale: 4 }),

    isSweep: boolean("is_sweep").notNull().default(false),
    conditions: jsonb("conditions").$type<number[]>().notNull().default([]),

    priorDayOi: integer("prior_day_oi"),
    oiMultiplier: numeric("oi_multiplier", { precision: 8, scale: 2 }),

    classification: text("classification").$type<UoaClassification>().notNull(),

    pctFromSpot: numeric("pct_from_spot", { precision: 8, scale: 2 }),
    underlyingPriceAtTrade: numeric("underlying_price_at_trade", {
      precision: 14,
      scale: 4,
    }),

    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("uoa_prints_underlying_ts_idx").on(t.underlying, t.printTs.desc()),
    index("uoa_prints_captured_at_idx").on(t.capturedAt.desc()),
    index("uoa_prints_premium_desc_idx").on(t.premiumUsd.desc(), t.printTs.desc()),
    index("uoa_prints_classification_idx").on(t.classification, t.printTs.desc()),
    uniqueIndex("uoa_prints_dedup_idx").on(
      t.contractTicker,
      t.printTs,
      t.size,
      t.price,
    ),
  ],
);

export type UoaPrint = typeof uoaPrints.$inferSelect;

/** Denormalized print summary stored in `uoa_scans.prints`. Snapshot at
 *  scan time so historical scans don't break if uoa_prints evolves. */
export interface UoaPrintSummary {
  printTs: string; // ISO
  underlying: string;
  contractTicker: string;
  expirationDate: string; // YYYY-MM-DD
  strike: number;
  contractType: "call" | "put";
  side: "buy" | "sell";
  size: number;
  price: number;
  premiumUsd: number;
  isSweep: boolean;
  oiMultiplier: number | null;
  classification: UoaClassification;
  pctFromSpot: number | null;
  underlyingPriceAtTrade: number | null;
}

export const uoaScans = pgTable(
  "uoa_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    prints: jsonb("prints").$type<UoaPrintSummary[]>().notNull().default([]),
    universeSize: integer("universe_size").notNull(),
    runAt: timestamp("run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("uoa_scans_scan_day_desc_idx").on(t.scanDay.desc())],
);

export type UoaScan = typeof uoaScans.$inferSelect;

// ============================================================================
// DEALER GAMMA EXPOSURE (GEX)
//
// 5-min snapshot of the dealer gamma surface per ticker. Persisted by
// a Railway cron during RTH; consumed by the /research/gex dashboard.
//
// Sign convention: dealers assumed long calls + short puts.
//   netGex(strike) = (callOI · callGamma − putOI · putGamma) · 100 · spot²
//   totalGex = Σ netGex across all listed strikes and expiries
//   zeroGammaStrike = strike where the running cumulative netGex
//                     (from low strikes upward) crosses zero
//
// totalGex > 0  → long-gamma regime  (dealers fade moves → low realized vol)
// totalGex < 0  → short-gamma regime (dealers chase moves → high realized vol)
// ============================================================================

/** One row in the per-strike GEX profile JSONB. Stored sorted asc by strike. */
export interface GexStrikeRow {
  strike: number;
  /** Sum of (OI · gamma · 100 · spot²) across call expiries at this strike. */
  callGex: number;
  /** Same shape for puts, sign-flipped (dealers short puts). */
  putGex: number;
  /** callGex + putGex. */
  netGex: number;
  /** Running sum of netGex from lowest strike up through this one. */
  cumulativeGex: number;
}

export const gexSnapshots = pgTable(
  "gex_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    spot: numeric("spot", { precision: 14, scale: 4 }).notNull(),
    /** Total net dealer gamma — sign indicates the regime. */
    totalGex: numeric("total_gex", { precision: 20, scale: 2 }).notNull(),
    /** The flip strike. NULL when cumulative GEX is monotonic. */
    zeroGammaStrike: numeric("zero_gamma_strike", {
      precision: 14,
      scale: 4,
    }),
    /** (zeroGammaStrike − spot) / spot · 100. Convenience for ranking. */
    zeroGammaPct: numeric("zero_gamma_pct", { precision: 8, scale: 2 }),
    /** Per-strike profile, sorted asc by strike. */
    gexByStrike: jsonb("gex_by_strike")
      .$type<GexStrikeRow[]>()
      .notNull()
      .default([]),
    contractsScanned: integer("contracts_scanned").notNull().default(0),
    expiriesScanned: integer("expiries_scanned").notNull().default(0),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("gex_snapshots_ticker_ts_desc_idx").on(t.ticker, t.ts.desc()),
    index("gex_snapshots_ts_idx").on(t.ts),
  ],
);

export type GexSnapshot = typeof gexSnapshots.$inferSelect;

// ============================================================================
// CHEAP LEAPS SCANNER
//
// Weekly scan that finds 14-20 month calls where IV is in the bottom
// quartile of its 1-year range AND the underlying has solid
// fundamentals (revenue growth, positive operating income, cash
// buffer) AND the stock has pulled back but isn't in free fall.
// Vega-positive long-term position: two ways to win (delta + vega).
// ============================================================================

/** Denormalized pick summary stored in `leap_scans.picks`. */
export interface LeapPickSummary {
  ticker: string;
  contractTicker: string;
  expirationDate: string;       // YYYY-MM-DD
  strike: number;
  dteDays: number;
  underlyingPrice: number;
  premiumMid: number | null;
  premiumBid: number | null;
  premiumAsk: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openInterest: number | null;
  ivRank: number | null;
  qualityScore: number | null;
  setupScore: number | null;
  compositeScore: number;
  fundamentals: Record<string, unknown>;
}

export const leapPicks = pgTable(
  "leap_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull(),
    ticker: text("ticker").notNull(),

    contractTicker: text("contract_ticker").notNull(),
    expirationDate: date("expiration_date").notNull(),
    strike: numeric("strike", { precision: 14, scale: 4 }).notNull(),
    dteDays: integer("dte_days").notNull(),

    underlyingPrice: numeric("underlying_price", { precision: 14, scale: 4 }).notNull(),
    premiumMid: numeric("premium_mid", { precision: 14, scale: 4 }),
    premiumBid: numeric("premium_bid", { precision: 14, scale: 4 }),
    premiumAsk: numeric("premium_ask", { precision: 14, scale: 4 }),
    iv: numeric("iv", { precision: 8, scale: 6 }),
    delta: numeric("delta", { precision: 6, scale: 4 }),
    gamma: numeric("gamma", { precision: 10, scale: 8 }),
    theta: numeric("theta", { precision: 10, scale: 4 }),
    vega: numeric("vega", { precision: 10, scale: 4 }),
    openInterest: integer("open_interest"),

    ivRank: numeric("iv_rank", { precision: 5, scale: 2 }),
    qualityScore: numeric("quality_score", { precision: 5, scale: 2 }),
    setupScore: numeric("setup_score", { precision: 5, scale: 2 }),
    compositeScore: numeric("composite_score", {
      precision: 5,
      scale: 2,
    }).notNull(),

    fundamentals: jsonb("fundamentals")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("leap_picks_scan_day_desc_idx").on(
      t.scanDay.desc(),
      t.compositeScore.desc(),
    ),
    index("leap_picks_ticker_scan_day_idx").on(t.ticker, t.scanDay.desc()),
  ],
);

export type LeapPick = typeof leapPicks.$inferSelect;

export const leapScans = pgTable(
  "leap_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDay: date("scan_day").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    picks: jsonb("picks").$type<LeapPickSummary[]>().notNull().default([]),
    universeSize: integer("universe_size").notNull(),
    runAt: timestamp("run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("leap_scans_scan_day_desc_idx").on(t.scanDay.desc())],
);

export type LeapScan = typeof leapScans.$inferSelect;

/**
 * Time-series mark of an individual leap_pick's current market state.
 * Populated daily by /api/cron/leap-marks for every pick whose expiry
 * is still in the future. Drives the Performance section on
 * /research/leaps — tracks P&L vs entry over time.
 */
export const leapPickMarks = pgTable(
  "leap_pick_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leapPickId: uuid("leap_pick_id")
      .notNull()
      .references(() => leapPicks.id, { onDelete: "cascade" }),
    markTs: timestamp("mark_ts", { withTimezone: true })
      .notNull()
      .defaultNow(),
    underlyingPrice: numeric("underlying_price", { precision: 14, scale: 4 }),
    premiumMid: numeric("premium_mid", { precision: 14, scale: 4 }),
    premiumBid: numeric("premium_bid", { precision: 14, scale: 4 }),
    premiumAsk: numeric("premium_ask", { precision: 14, scale: 4 }),
    iv: numeric("iv", { precision: 8, scale: 6 }),
    delta: numeric("delta", { precision: 6, scale: 4 }),
    openInterest: integer("open_interest"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("leap_pick_marks_pick_ts_idx").on(t.leapPickId, t.markTs.desc()),
    index("leap_pick_marks_ts_idx").on(t.markTs),
  ],
);

export type LeapPickMark = typeof leapPickMarks.$inferSelect;

// ============================================================================
// RISK GRAPH — saved multi-leg trade ideas
//
// Users build a multi-leg option position via the Risk Graph tool,
// save it with a name + notes. The detail page recreates the risk
// graph client-side from the stored legs against the latest live
// spot. Wave 2 adds trade_idea_marks for performance tracking.
// ============================================================================

/** One leg of a saved trade idea. Matches the Leg interface in
 *  lib/risk-graph.ts — kept here too so the schema is self-contained. */
export interface TradeIdeaLeg {
  type: "call" | "put";
  side: "long" | "short";
  strike: number;
  expiration: string; // YYYY-MM-DD
  qty: number;
  entryPrice: number;
  entryIv: number;
  /** Optional — the OPRA ticker so wave-2 marks can re-fetch this exact
   *  contract from Polygon. */
  contractTicker?: string;
  /** Bid/ask at entry, captured from the chain at add-time. Used by
   *  the multi-quote-scenario panel to compute Natural vs Mid vs
   *  Optimistic entry costs. NULL when chain didn't have a quote. */
  entryBid?: number | null;
  entryAsk?: number | null;
}

/** Snapshot of one leg at the moment of close. Stored in
 *  trade_ideas.closing_legs index-matched against trade_ideas.legs
 *  so the saved-detail page can render an entry→close breakdown. */
export interface TradeIdeaClosingLeg {
  contractTicker: string;
  closePrice: number;        // mid at close (used for P&L)
  closeBid: number | null;
  closeAsk: number | null;
  closeIv: number | null;
  /** Per-leg realized P&L in dollars (sign × qty × 100 × (close − entry)). */
  legPnl: number;
}

export type TradeIdeaStatus = "open" | "closed" | "expired";

export const tradeIdeas = pgTable(
  "trade_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ticker: text("ticker").notNull(),
    legs: jsonb("legs").$type<TradeIdeaLeg[]>().notNull().default([]),
    underlyingSpotAtEntry: numeric("underlying_spot_at_entry", {
      precision: 14,
      scale: 4,
    }).notNull(),
    entryDebit: numeric("entry_debit", { precision: 16, scale: 2 }).notNull(),
    status: text("status").$type<TradeIdeaStatus>().notNull().default("open"),
    notes: text("notes").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** Close-trade columns (NULL while open). Populated when the user
     *  clicks Close, snapshotting current chain prices + realized P&L. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closingLegs: jsonb("closing_legs").$type<TradeIdeaClosingLeg[]>(),
    realizedPnl: numeric("realized_pnl", { precision: 16, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("trade_ideas_created_at_idx").on(t.createdAt.desc()),
    index("trade_ideas_ticker_idx").on(t.ticker, t.createdAt.desc()),
    index("trade_ideas_status_idx").on(t.status, t.createdAt.desc()),
  ],
);

export type TradeIdea = typeof tradeIdeas.$inferSelect;

// ============================================================================
// EARNINGS SCANS (V1)
//
// Weekly scan that, for each company reporting earnings in the
// upcoming week, computes historical earnings-effect stats from
// the past N earnings cycles and suggests which of the four
// earnings-options strategies (Rush / Condor / Straddle / Breakout)
// fits the historical pattern + current vol regime best.
//
// Detail per ticker is stored in `data` jsonb so V2/V3 (real
// backtest stats) can extend the shape without migrating.
// ============================================================================

/** Per-strategy suggestion for one ticker. score is 0-100, higher =
 *  stronger match between the company's historical EE pattern and
 *  the strategy's edge case. */
export interface EarningsStrategySuggestion {
  suggested: boolean;
  score: number;
  rationale: string;
}

/** One past earnings observation. priceWindow describes which
 *  surrounding close-to-close move we used (BMO = prior→same, AMC =
 *  same→next). */
export interface EarningsHistoryPoint {
  date: string;        // YYYY-MM-DD
  hour: "bmo" | "amc" | "dmh";
  pricePctChange: number | null;
  priceBefore: number | null;
  priceAfter: number | null;
}

/** Per-cycle backtest result. One per past earnings event included
 *  in the backtest. Used by the per-strategy detail view to show
 *  exactly what happened on each historical EE. */
export interface EarningsBacktestCycle {
  earningsDate: string;
  hour: "bmo" | "amc" | "dmh";
  entryDate: string;
  exitDate: string;
  entryPrice: number | null;
  exitPrice: number | null;
  pnlDollar: number | null;
  roiPct: number | null;
  underlyingMove: number | null;
  skipReason: string | null;
}

/** Aggregate backtest stats for one strategy on one ticker. Populated
 *  by the V3 backtester; for strategies that are heuristic-only the
 *  fields are null and `kind === "heuristic"`. */
export interface EarningsBacktestStats {
  /** Distinguishes a real Polygon-priced backtest from V1's heuristic. */
  kind: "backtest" | "heuristic";
  avgRoiPct: number | null;
  winRate: number | null;       // 0-1
  wins: number;
  losses: number;
  cyclesUsed: number;
  totalCycles: number;
  cycles: EarningsBacktestCycle[];
}

export interface EarningsTickerEntry {
  symbol: string;
  earningsDate: string;        // YYYY-MM-DD of upcoming earnings
  hour: "bmo" | "amc" | "dmh";
  spot: number | null;
  /** ATM IV at the nearest 30d expiry (decimal). */
  atmIv: number | null;
  /** IV-implied 1-day earnings move %, computed from the ATM straddle
   *  at the closest expiry after earnings. */
  impliedMovePct: number | null;
  /** Past earnings effects, newest first. Up to 10 cycles. */
  history: EarningsHistoryPoint[];
  /** Summary stats over the history (price % changes). */
  historyStats: {
    count: number;
    median: number | null;
    mean: number | null;
    max: number | null;
    min: number | null;
    /** Median of |pricePctChange| — used to compare against implied move. */
    medianAbs: number | null;
  };
  strategies: {
    rush: EarningsStrategySuggestion;
    condor: EarningsStrategySuggestion;
    straddle: EarningsStrategySuggestion;
    breakout: EarningsStrategySuggestion;
  };
  /** V3 backtest results per strategy. Straddle is real-backtest in
   *  V3.1; others are heuristic-only until V3.2-V3.4 land. */
  backtests?: {
    rush?: EarningsBacktestStats;
    condor?: EarningsBacktestStats;
    straddle?: EarningsBacktestStats;
    breakout?: EarningsBacktestStats;
  };
  /** Per-ticker errors (skip reasons, partial failures). */
  notes: string[];
}

export interface EarningsScanData {
  coveredFrom: string;
  coveredTo: string;
  tickers: EarningsTickerEntry[];
}

export const earningsScans = pgTable(
  "earnings_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanWeek: date("scan_week").notNull().unique(),
    universeSize: integer("universe_size").notNull(),
    computedSize: integer("computed_size").notNull(),
    data: jsonb("data").$type<EarningsScanData>().notNull().default({
      coveredFrom: "",
      coveredTo: "",
      tickers: [],
    }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("earnings_scans_scan_week_idx").on(t.scanWeek.desc())],
);

export type EarningsScan = typeof earningsScans.$inferSelect;

// ===========================================================================
// Sell Puts scans
// ===========================================================================

/** Tier bucket for Sell Puts picks — drives which sub-tab a pick
 *  shows up on. Boundaries by P(profit):
 *    conservative: PoP ≥ 0.85 — safety-first, lower premium
 *    balanced:     0.70 ≤ PoP < 0.85 — sweet spot
 *    aggressive:   PoP < 0.70 — fattest credit, narrow margin
 */
export type SellPutTier = "conservative" | "balanced" | "aggressive";

/** One ranked Sell Puts opportunity. The pick is a single short put at
 *  a chosen strike/expiry. Ranking is driven by `expectedRoiScore` =
 *  P(profit) × (credit / close), the standard "expected ROI" metric for
 *  put-selling screens. Each ticker can produce up to 3 picks (one per
 *  tier) so users can compare aggressive vs. conservative side-by-side. */
export interface SellPutPick {
  /** Which sub-tab this pick belongs to. Older scans without tiers
   *  default to "aggressive" on read. */
  tier?: SellPutTier;
  symbol: string;
  /** Stock close price at scan time. */
  close: number | null;
  /** Annualized dividend yield as percent (0..100). null when unavailable. */
  dividendYieldPct: number | null;
  /** YYYY-MM-DD. The chosen expiry from the chain (within 21–45 DTE). */
  expiration: string;
  /** Calendar days from scan_day to expiration. */
  dteDays: number;
  /** OPRA contract ticker for the chosen short put. */
  contractTicker: string;
  /** Strike price. */
  strike: number;
  /** Premium collected per share (= bid for sell, mid for ranking). */
  putCredit: number | null;
  /** Strike − credit. Stock must stay above this for trade to profit. */
  breakeven: number | null;
  /** (close − breakeven) / close × 100. Larger = more cushion. */
  breakevenCushionPct: number | null;
  /** credit / close × 100. The raw % return on stock notional. */
  creditToClosePct: number | null;
  /** Annualized version of creditToClosePct, accounting for DTE. */
  annualizedReturnPct: number | null;
  /** Risk-neutral P(stock at expiry > breakeven). 0..1. */
  probabilityOfProfit: number | null;
  /** P(profit) × creditToClosePct. The composite ranking score. */
  expectedRoiScore: number | null;
  /** Implied vol of the chosen put (decimal, e.g. 0.32 for 32%). */
  iv: number | null;
  /** IV rank in 0..100 of the underlying's 30d ATM IV vs trailing 1y.
   *  null if no IV history persisted for that name. */
  ivRank: number | null;
  /** 100 × (ask − bid) / ask. Smaller = tighter, more tradeable. */
  quoteSlippagePct: number | null;
  bid: number | null;
  ask: number | null;
  /** Open interest on the chosen contract. */
  openInterest: number | null;
  /** Delta of the chosen put (negative number, e.g. −0.20 for 20-delta). */
  delta: number | null;
  /** Diagnostic — why a ticker was skipped (null when included). */
  skipReason?: string;
}

/** Stored scan payload. Tickers in `picks` are sorted by
 *  expectedRoiScore desc. Items with `skipReason` set are kept at the
 *  end for diagnostic visibility but excluded from the page table. */
export interface SellPutScanData {
  scanDay: string;
  dteRange: { min: number; max: number };
  picks: SellPutPick[];
}

export const sellPutScans = pgTable(
  "sell_put_scans",
  {
    id: serial("id").primaryKey(),
    scanDay: date("scan_day").notNull().unique(),
    universeSize: integer("universe_size").notNull().default(0),
    computedSize: integer("computed_size").notNull().default(0),
    data: jsonb("data").$type<SellPutScanData>().notNull().default({
      scanDay: "",
      dteRange: { min: 21, max: 45 },
      picks: [],
    }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sell_put_scans_scan_day_desc_idx").on(t.scanDay.desc())],
);

export type SellPutScan = typeof sellPutScans.$inferSelect;

// ===========================================================================
// PREMIUM RANKER — weekly high-IV / premium scanner
//
// Full-market funnel: pull every US stock from the Polygon all-tickers
// snapshot, keep price ≥ $20 + daily volume > 500k, deep-scan each
// survivor's near-30d option chain for ATM IV + best short-put premium,
// then rank by IV (and by premium richness). The top names also get
// concrete naked-put + put-credit-spread trade suggestions.
//
// One row per scan_day. We store the top ~120 ranked rows (not all
// ~2500 survivors) to keep the JSONB tight, plus the 3 headline picks.
// ===========================================================================

/** A single ranked stock row in the Premium Ranker table. Every value is
 *  derived from one weekly scan; nulls mean the metric couldn't be computed
 *  (illiquid chain, missing quote, etc). */
export interface PremiumRankerRow {
  symbol: string;
  /** Stock last/close at scan time. */
  price: number;
  /** Daily share volume used for the >500k liquidity gate. */
  dayVolume: number;
  /** Constant-ish 30d ATM implied vol (decimal, e.g. 0.62 = 62%). The
   *  PRIMARY ranking metric — "highest IV". */
  atmIv: number;
  /** IV rank 0..100 vs the name's trailing-1y 30d ATM IV. null unless we
   *  have iv_snapshots history for it (only the ~25 Options Edge names). */
  ivRank: number | null;
  /** ATM straddle premium ÷ spot × 100 — the market's implied move and a
   *  clean "how rich is premium" read independent of strike selection. */
  atmStraddlePct: number | null;
  /** Best tradeable short put within the scan's DTE window. */
  bestPut: {
    expiration: string;       // YYYY-MM-DD
    dteDays: number;
    strike: number;
    contractTicker: string;
    credit: number | null;    // mid premium per share
    creditToClosePct: number | null;  // credit / spot × 100
    annualizedReturnPct: number | null; // creditPct × 365/dte — the SECONDARY ranking ("highest premium")
    probabilityOfProfit: number | null; // risk-neutral P(expire > breakeven)
    delta: number | null;
    bid: number | null;
    ask: number | null;
    openInterest: number | null;
  } | null;
  /** 1-based position when the table is sorted by atmIv desc. */
  rankByIv: number;
  /** 1-based position when sorted by bestPut.annualizedReturnPct desc. */
  rankByPremium: number;
}

/** A credit-spread leg pair derived for a headline suggestion. */
export interface PremiumRankerSpread {
  type: "put" | "call";
  shortStrike: number;
  longStrike: number;
  expiration: string;
  netCredit: number;          // per share
  width: number;              // strike width
  maxProfit: number;          // netCredit × 100
  maxLoss: number;            // (width − netCredit) × 100
  breakeven: number;
  probabilityOfProfit: number | null;
  shortContractTicker: string;
  longContractTicker: string;
}

/** One of the 3 headline trade suggestions shown atop the page. */
export interface PremiumRankerSuggestion {
  symbol: string;
  price: number;
  atmIv: number;
  thesis: string;
  /** Cash-secured naked short put. */
  nakedPut: {
    expiration: string;
    dteDays: number;
    strike: number;
    contractTicker: string;
    credit: number;
    breakeven: number;
    creditToClosePct: number | null;
    annualizedReturnPct: number | null;
    probabilityOfProfit: number | null;
    maxRisk: number;          // (strike − credit) × 100, if assigned to $0
  };
  /** Defined-risk version — put credit spread (short the naked put strike,
   *  long a put one band lower). */
  creditSpread: PremiumRankerSpread | null;
  /** LLM-written analysis of the setup. Computed once at scan time (weekly
   *  cron), stored in the JSONB — never generated on page load. Optional so
   *  older stored scans (and scans where the model call failed) still render. */
  aiAnalysis?: {
    /** Why this is an attractive premium-selling setup (2–4 sentences). */
    why: string;
    /** Honest probability / risk read contextualizing the model's PoP. */
    probability: string;
    /** Whether an earnings report falls inside the trade window — the single
     *  biggest reason IV is elevated. null when the calendar lookup was
     *  unavailable. */
    earningsInWindow: boolean | null;
    /** Model id that produced the analysis, for provenance. */
    model: string;
  };
}

export interface PremiumRankerScanData {
  scanDay: string;
  /** Filters applied, echoed for the page footer. */
  filters: { minPrice: number; minDayVolume: number; dteMin: number; dteMax: number };
  /** Top N ranked rows (by IV). */
  rows: PremiumRankerRow[];
  /** 3 headline trade ideas. */
  suggestions: PremiumRankerSuggestion[];
}

export const premiumRankerScans = pgTable(
  "premium_ranker_scans",
  {
    id: serial("id").primaryKey(),
    scanDay: date("scan_day").notNull().unique(),
    /** How many tickers passed the price+volume gate (the deep-scan input). */
    universeSize: integer("universe_size").notNull().default(0),
    /** How many produced a usable IV row (the ranked output count). */
    computedSize: integer("computed_size").notNull().default(0),
    data: jsonb("data").$type<PremiumRankerScanData>().notNull().default({
      scanDay: "",
      filters: { minPrice: 20, minDayVolume: 500000, dteMin: 21, dteMax: 45 },
      rows: [],
      suggestions: [],
    }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("premium_ranker_scans_scan_day_desc_idx").on(t.scanDay.desc())],
);

export type PremiumRankerScan = typeof premiumRankerScans.$inferSelect;

// ===========================================================================
// Calendar scans
// ===========================================================================

/** Why a ticker was skipped (or "ok" for tradeable). Used in the
 *  view footer + dev diagnostics. */
export type CalendarSkipReason =
  | "ok"
  | "no_chain"
  | "no_iv_rank"
  | "iv_rank_too_low"
  | "earnings_in_window"
  | "no_front_expiry"
  | "no_back_expiry"
  | "no_strikes"
  | "term_structure_unfavorable"
  | "scan_error";

/** One ranked calendar opportunity: long ATM call calendar (sell
 *  front-month ATM call, buy back-month ATM call). Same strike on
 *  both legs. Ranking is driven by `compositeScore` which blends IV
 *  rank, term-structure ratio, post-earnings timing bonus, and DTE
 *  quality vs ideal sweet spots. */
export interface CalendarPick {
  symbol: string;
  /** Spot price at scan time. */
  spot: number | null;
  /** ATM strike (closest listed strike to spot). */
  strike: number | null;
  /** Front-month (short) expiry — target ~30 DTE. */
  frontExpiration: string | null;
  frontDte: number | null;
  /** Back-month (long) expiry — target ~90 DTE. */
  backExpiration: string | null;
  backDte: number | null;
  /** OPRA tickers for each leg, so the BUILD button can drop into
   *  Risk Graph with both legs pre-populated. */
  frontContractTicker: string | null;
  backContractTicker: string | null;
  /** Mid prices for each leg (per share). */
  frontMid: number | null;
  backMid: number | null;
  /** Net debit per spread (= back_mid − front_mid). Always positive
   *  for a long calendar; longer expiry has more time value. */
  netDebit: number | null;
  /** Implied vol on each leg (decimal, e.g. 0.32 for 32%). */
  frontIv: number | null;
  backIv: number | null;
  /** front_iv / back_iv. >1 means front is richer (good for calendar). */
  termStructureRatio: number | null;
  /** Front-month IV rank in 0..100 vs trailing 1y from iv_snapshots.
   *  Null when the ticker isn't in the IV-rank watchlist. */
  ivRank: number | null;
  /** Days since the ticker's most recent earnings report.
   *  Null if Polygon financials returned no past EE. */
  daysSinceEarnings: number | null;
  /** Days until the next earnings report. Null if no upcoming EE
   *  known within 45 days. */
  daysToNextEarnings: number | null;
  /** Composite ranking score 0..100. Higher = more attractive setup. */
  compositeScore: number | null;
  /** Why a row was skipped — null/undefined when tradeable. */
  skipReason: CalendarSkipReason;
  /** Free-form human-readable rationale for the score, for the row's
   *  tooltip / analyst-note layer. */
  notes: string;
}

export interface CalendarScanData {
  scanDay: string;
  /** Ideal DTE windows — surfaced in help + view footer. */
  frontDteRange: { min: number; max: number };
  backDteRange: { min: number; max: number };
  picks: CalendarPick[];
}

export const calendarScans = pgTable(
  "calendar_scans",
  {
    id: serial("id").primaryKey(),
    scanDay: date("scan_day").notNull().unique(),
    universeSize: integer("universe_size").notNull().default(0),
    computedSize: integer("computed_size").notNull().default(0),
    data: jsonb("data").$type<CalendarScanData>().notNull().default({
      scanDay: "",
      frontDteRange: { min: 20, max: 40 },
      backDteRange: { min: 60, max: 120 },
      picks: [],
    }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("calendar_scans_scan_day_desc_idx").on(t.scanDay.desc())],
);

export type CalendarScan = typeof calendarScans.$inferSelect;

// ============================================================================
// SECTOR FLOW BUBBLES
//
// Powers /sector — a cryptobubbles-style packed bubble chart where size = net
// aggressor flow (|buy_vol − sell_vol|), color = price change % over the
// selected timeframe. Universe is 22 names: 11 sector SPDRs (XLK XLF XLE XLV
// XLY XLP XLI XLB XLU XLRE XLC), 4 index ETFs (SPY QQQ IWM DIA), 7 Mag (AAPL
// MSFT NVDA GOOGL AMZN META TSLA).
//
// Wire-format: one row per (ticker, window_start). The cron pulls 5-min
// windows of stock trades + NBBO from Polygon (5 min matches Railway's cron
// floor), classifies each trade via the existing classifyAggressor helper,
// and upserts a row. The read endpoint rolls bars up server-side: 5m = last
// single bar, 1h = SUM of last 12, 1d = SUM since session open, 1w = SUM
// since 5 sessions ago. A rolling retention prunes rows older than 8 days
// to keep the table tight (~14k live rows: 22 × 78 RTH windows × 8 days).
// ============================================================================

export const sectorFlowBars = pgTable(
  "sector_flow_bars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    /** Start of the 2-min window (NY session-aligned). */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** Exclusive end of the window. */
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),

    /** Shares classified as aggressive buys (price ≥ ask). */
    buyVolume: numeric("buy_volume", { precision: 18, scale: 0 }).notNull().default("0"),
    /** Shares classified as aggressive sells (price ≤ bid). */
    sellVolume: numeric("sell_volume", { precision: 18, scale: 0 }).notNull().default("0"),
    /** Shares between bid and ask (unclassifiable). */
    ambiguousVolume: numeric("ambiguous_volume", { precision: 18, scale: 0 }).notNull().default("0"),
    /** Total shares traded in the window (buy + sell + ambiguous). */
    totalVolume: numeric("total_volume", { precision: 18, scale: 0 }).notNull().default("0"),

    /** Notional traded in window (Σ price × size). */
    notionalUsd: numeric("notional_usd", { precision: 20, scale: 2 }).notNull().default("0"),

    /** First print in window (used to derive open). */
    openPrice: numeric("open_price", { precision: 12, scale: 4 }),
    /** Last print in window. */
    closePrice: numeric("close_price", { precision: 12, scale: 4 }),

    /** Trade count — useful for sanity checks against rate limits. */
    tradeCount: integer("trade_count").notNull().default(0),

    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sector_flow_bars_ticker_window_idx").on(t.ticker, t.windowStart),
    index("sector_flow_bars_window_idx").on(t.windowStart.desc()),
    index("sector_flow_bars_ticker_window_desc_idx").on(t.ticker, t.windowStart.desc()),
  ],
);

export type SectorFlowBar = typeof sectorFlowBars.$inferSelect;

// ============================================================================
// SQUEEZE WATCH — weekly Sunday scan that ranks short-squeeze candidates
// from a curated ~150-name universe (small/mid-cap + historically high-SI
// names). Scoring blends short-interest-to-shares-outstanding, days-to-cover,
// 5-day price momentum, and IV rank into a composite 0-100 score. Top 25
// surface on /research/squeeze.
//
// Data sources (all Polygon, no third-party):
//   - FINRA short interest (/stocks/v1/short-interest) — bi-monthly, ~3wk lag
//   - Shares outstanding (/v3/reference/tickers/{ticker})
//   - 5-day momentum (/v2/aggs/ticker/{ticker}/range/1/day)
//   - IV rank (existing iv_snapshots if covered, else null)
//
// Known data gaps vs Ortex/S3: no cost-to-borrow, no real-time utilization.
// Surfaces "candidates worth watching," not "shorts are actively bleeding."
// ============================================================================

/** One leg of a suggested option trade. The OPRA ticker lets the UI deep-link
 *  into Risk Graph with the exact contract pre-loaded. */
export interface SqueezeTradeLeg {
  side: "long" | "short";
  type: "call" | "put";
  strike: number;
  expiration: string;          // YYYY-MM-DD
  contractTicker: string;      // OPRA-format symbol (e.g. "O:GME260117C00050000")
  mid: number | null;
}

/** A suggested option trade attached to a top-N squeeze candidate. */
export interface SqueezeTradeIdea {
  strategy: "long_call" | "bull_call_spread" | "diagonal_call";
  label: string;
  legs: SqueezeTradeLeg[];
  /** Net debit per spread (positive = pay). 100x for share contract. */
  netDebit: number | null;
  /** Max profit per spread, or null when unbounded (long call) or hard to model (diagonal). */
  maxProfit: number | null;
  maxLoss: number | null;
  breakeven: number | null;
  /** DTE of the longest leg. */
  dte: number;
  notes: string;
}

export interface SqueezeCandidate {
  ticker: string;
  companyName: string | null;
  /** FINRA settlement date the SI snapshot was reported as of. */
  siSettlementDate: string;
  /** Shares short at last settlement. */
  shortInterest: number;
  /** Polygon's reported avg daily volume from the SI release. */
  avgDailyVolume: number;
  /** SI ÷ ADV. */
  daysToCover: number;
  /** Total shares outstanding (from /v3/reference/tickers). */
  sharesOutstanding: number | null;
  /** SI ÷ shares outstanding × 100. NULL when sharesOutstanding unknown.
   *  This is "of shares outstanding," not "of float" — true float requires
   *  subtracting insider/restricted shares which Polygon doesn't expose. */
  shortInterestPctSO: number | null;

  /** Most recent close. */
  lastClose: number;
  /** 5-trading-day return in percent. */
  priceChange5dPct: number | null;
  /** 30-trading-day return in percent — captures the squeeze trajectory. */
  priceChange30dPct: number | null;
  /** Latest atm_iv_rank from iv_snapshots, if scanned. */
  atmIvRank: number | null;

  // Composite 0-100 sub-scores. Higher = more squeeze-y.
  siPctScore: number;
  dtcScore: number;
  momentumScore: number;
  ivRankScore: number;

  /** Weighted composite 0-100. Drives the ranking. */
  compositeScore: number;
  /** Short prose explaining what's driving the score (≤200 chars). */
  thesis: string;

  /** Optional — present for top-10 candidates only. Generated from live
   *  options chain at scan time. May be omitted entirely if the chain
   *  pull failed for this ticker. */
  tradeIdeas?: SqueezeTradeIdea[];
}

export const squeezeScans = pgTable(
  "squeeze_scans",
  {
    id: serial("id").primaryKey(),
    scanDay: date("scan_day").notNull().unique(),
    universeSize: integer("universe_size").notNull().default(0),
    /** Number of candidates that scored above threshold + made the top-N cut. */
    rankedSize: integer("ranked_size").notNull().default(0),
    candidates: jsonb("candidates").$type<SqueezeCandidate[]>().notNull().default([]),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("squeeze_scans_scan_day_desc_idx").on(t.scanDay.desc())],
);

export type SqueezeScan = typeof squeezeScans.$inferSelect;
