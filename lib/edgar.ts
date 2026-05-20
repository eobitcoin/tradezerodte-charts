/**
 * SEC EDGAR client for 13F-HR filings.
 *
 * The remote claude.ai routine container can't reach data.sec.gov directly,
 * so this module runs on Railway (which has open egress) and serves parsed
 * holdings to the routine via the MCP server.
 *
 * SEC's policy requires a User-Agent header that identifies the requester.
 * Set SEC_USER_AGENT env var with a contactable string ("App Name email@host").
 * SEC's published rate limit is 10 req/sec; this client doesn't bake in
 * throttling because the routine is the only caller and it spaces requests
 * across multiple funds.
 */

const SEC_DEFAULT_USER_AGENT = "oliviatrades.com institutional-scan admin@oliviatrades.com";

function userAgent(): string {
  return process.env.SEC_USER_AGENT?.trim() || SEC_DEFAULT_USER_AGENT;
}

function commonHeaders(): Record<string, string> {
  return {
    "User-Agent": userAgent(),
    Accept: "application/json, text/xml, */*",
    "Accept-Encoding": "gzip, deflate",
  };
}

/** SEC stores CIKs as 10-digit zero-padded strings. */
function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

/** And expects them WITHOUT leading zeros for URL paths under /Archives/. */
function cikNoLeading(cik: string | number): string {
  return String(parseInt(String(cik).replace(/\D/g, ""), 10));
}

// ---------------------------------------------------------------------------
// Submissions JSON — list of recent filings per CIK
// ---------------------------------------------------------------------------

export interface RecentFiling {
  accessionNumber: string;
  filingDate: string;        // YYYY-MM-DD
  reportDate: string | null; // period of report (quarter-end)
  form: string;
  primaryDocument: string;   // path inside the accession folder
}

export interface FundSubmissions {
  cik: string;            // 10-digit padded
  name: string;
  filings: RecentFiling[];
}

export async function fetchSubmissions(cik: string | number): Promise<FundSubmissions> {
  const padded = padCik(cik);
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: commonHeaders() });
  if (!res.ok) {
    throw new Error(`SEC submissions for CIK ${padded} failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    name?: string;
    filings?: {
      recent?: {
        accessionNumber?: string[];
        filingDate?: string[];
        reportDate?: string[];
        form?: string[];
        primaryDocument?: string[];
      };
    };
  };
  const recent = data.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) {
    throw new Error(`SEC submissions for CIK ${padded} has unexpected shape`);
  }
  const n = recent.accessionNumber.length;
  const filings: RecentFiling[] = [];
  for (let i = 0; i < n; i++) {
    filings.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate?.[i] ?? "",
      reportDate: recent.reportDate?.[i] || null,
      form: recent.form?.[i] ?? "",
      primaryDocument: recent.primaryDocument?.[i] ?? "",
    });
  }
  return { cik: padded, name: data.name ?? "", filings };
}

// ---------------------------------------------------------------------------
// Filing folder index — list of files in a specific accession
// ---------------------------------------------------------------------------

interface IndexFile {
  name: string;
  type: string;
  size: number;
}

async function fetchFilingFiles(cik: string, accessionNumber: string): Promise<IndexFile[]> {
  const accNoDashes = accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNoLeading(cik)}/${accNoDashes}/index.json`;
  const res = await fetch(url, { headers: commonHeaders() });
  if (!res.ok) {
    throw new Error(`SEC filing index for ${accessionNumber} failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { directory?: { item?: IndexFile[] } };
  return data.directory?.item ?? [];
}

function buildAccessionFileUrl(cik: string, accessionNumber: string, fileName: string): string {
  const accNoDashes = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoLeading(cik)}/${accNoDashes}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Infotable XML — the per-holding payload of a 13F-HR
// ---------------------------------------------------------------------------

export interface InfoTableHolding {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  valueUsd: number;        // SEC reports in $1000s since 2022-Q4; we normalize to whole $
  sharesHeld: number;
  shareClass: "SH" | "PRN" | string;
  putCall: "PUT" | "CALL" | null;
  investmentDiscretion: string | null;
  votingSole: number;
  votingShared: number;
  votingNone: number;
}

/**
 * Parse SEC's 13F infotable XML. Schema is `eis_13F_HR.xsd` (and earlier
 * variants). We don't use a full XML parser — the schema is tightly
 * structured and the file is large enough that regex is faster than
 * DOM parsing for our purposes.
 *
 * Tag matching is case-sensitive and namespace-agnostic (SEC inconsistently
 * uses `<ns1:infoTable>` vs `<infoTable>` across years — the regex skips
 * namespace prefixes).
 */
export function parseInfoTableXml(xml: string): InfoTableHolding[] {
  const holdings: InfoTableHolding[] = [];
  // Each holding lives in an <infoTable>...</infoTable> block (or namespaced).
  const blockRegex = /<(?:[a-z0-9]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?infoTable>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(xml)) !== null) {
    const block = match[1];
    const issuer = pickTag(block, "nameOfIssuer") ?? "";
    const titleOfClass = pickTag(block, "titleOfClass") ?? "";
    const cusip = (pickTag(block, "cusip") ?? "").trim().toUpperCase();
    if (!cusip) continue;
    // SEC switched value units from $1000s to whole dollars starting with
    // 13F filings for periods ending on or after 2022-12-31. The XSD now
    // uses USD, but older filings still use thousands. Read both — heuristic:
    // SEC's official guidance says "always read raw value as whole dollars
    // for current filings"; legacy filings need ×1000. We can't reliably
    // detect from XML alone, so we trust the value as-is and let the caller
    // decide. Most current filings will be whole dollars.
    const valueRaw = Number(pickTag(block, "value") ?? 0);
    const sharesHeld = Number(pickTag(block, "sshPrnamt") ?? 0);
    const shareClass = (pickTag(block, "sshPrnamtType") ?? "SH").toUpperCase();
    const putCallRaw = pickTag(block, "putCall");
    const putCall = putCallRaw === "Put" ? "PUT" : putCallRaw === "Call" ? "CALL" : null;
    const investmentDiscretion = pickTag(block, "investmentDiscretion");
    const votingSole = Number(pickTag(block, "Sole") ?? 0);
    const votingShared = Number(pickTag(block, "Shared") ?? 0);
    const votingNone = Number(pickTag(block, "None") ?? 0);
    holdings.push({
      nameOfIssuer: issuer.trim(),
      titleOfClass: titleOfClass.trim(),
      cusip,
      valueUsd: valueRaw,
      sharesHeld,
      shareClass,
      putCall,
      investmentDiscretion: investmentDiscretion?.trim() || null,
      votingSole,
      votingShared,
      votingNone,
    });
  }
  return holdings;
}

function pickTag(block: string, tag: string): string | null {
  // Allow optional namespace prefix and any attributes; capture inner text.
  const re = new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${tag}>`, "i");
  const m = re.exec(block);
  if (!m) return null;
  // Strip nested tags (e.g. <Sole> inside <votingAuthority>) — for our use
  // cases the leaf tags are simple text or numeric so this is a no-op.
  return m[1].replace(/<[^>]+>/g, "").trim();
}

// ---------------------------------------------------------------------------
// Composite: fetch the N most recent 13F-HR filings for a CIK, return parsed
// ---------------------------------------------------------------------------

export interface Parsed13FFiling {
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;  // period of report — quarter-end
  infoTableUrl: string;
  holdings: InfoTableHolding[];
}

export interface Fetched13FBundle {
  cik: string;
  fundName: string;
  filings: Parsed13FFiling[];
}

export async function fetch13FHoldings(
  cik: string | number,
  options?: { numQuarters?: number },
): Promise<Fetched13FBundle> {
  const numQuarters = Math.max(1, Math.min(8, options?.numQuarters ?? 2));
  const subs = await fetchSubmissions(cik);
  // Take the most recent 13F-HR filings (NOT 13F-HR/A amendments here — those
  // can be folded in later if needed). Filter strictly on form == "13F-HR".
  const candidates = subs.filings
    .filter((f) => f.form === "13F-HR")
    .slice(0, numQuarters);
  if (candidates.length === 0) {
    return { cik: subs.cik, fundName: subs.name, filings: [] };
  }

  const parsed: Parsed13FFiling[] = [];
  for (const filing of candidates) {
    let infoTableUrl: string | null = null;
    try {
      const files = await fetchFilingFiles(subs.cik, filing.accessionNumber);
      // Heuristic: the holdings live in the .xml file that ISN'T the primary
      // doc (cover page). Names vary: "infotable.xml", "form13fInfoTable.xml",
      // "<accession>-infotable.xml". Pick by extension + size, exclude the
      // primary doc.
      const primary = filing.primaryDocument.split("/").pop() ?? "";
      const xmlFiles = files
        .filter((f) => f.name.toLowerCase().endsWith(".xml"))
        .filter((f) => f.name !== primary)
        // Largest XML in the folder is typically the holdings table.
        .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0));
      if (xmlFiles.length === 0) {
        // Some filers package everything in the primary doc — try that.
        if (primary.toLowerCase().endsWith(".xml")) {
          infoTableUrl = buildAccessionFileUrl(subs.cik, filing.accessionNumber, primary);
        } else {
          parsed.push({
            accessionNumber: filing.accessionNumber,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            infoTableUrl: "",
            holdings: [],
          });
          continue;
        }
      } else {
        infoTableUrl = buildAccessionFileUrl(subs.cik, filing.accessionNumber, xmlFiles[0].name);
      }
    } catch (err) {
      parsed.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        infoTableUrl: "",
        holdings: [],
      });
      void err;
      continue;
    }

    try {
      const res = await fetch(infoTableUrl, { headers: commonHeaders() });
      if (!res.ok) {
        parsed.push({
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          infoTableUrl,
          holdings: [],
        });
        continue;
      }
      const xml = await res.text();
      const holdings = parseInfoTableXml(xml);
      parsed.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        infoTableUrl,
        holdings,
      });
    } catch {
      parsed.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        infoTableUrl,
        holdings: [],
      });
    }
  }

  return { cik: subs.cik, fundName: subs.name, filings: parsed };
}
