/**
 * Shared HTML renderers used to build the daily-research email.
 *
 * Both the MCP publish path (`/api/mcp/[token]`) and the standalone email
 * endpoint (`/api/posts/email-latest`) need to render a trades-summary
 * table with email-safe inline styles. Keeping it here avoids drift between
 * the two send paths.
 */

import { sortTradesByGrade, gradeColors, cleanStrikeDisplay } from "@/lib/grade";
import type { Trade } from "@/lib/db/schema";

/** Build an inline-styled HTML table summarizing parsed trades. */
export function buildTradesTableHtml(trades: Trade[]): string {
  if (!trades || trades.length === 0) return "";
  const sorted = sortTradesByGrade(trades);
  const td = "padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top";
  const th = "padding:8px 10px;background:#f6f6f6;border-bottom:2px solid #ddd;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#555;text-align:left;font-weight:600";
  const rows = sorted
    .map((t, i) => {
      const gc = gradeColors(t.grade);
      const gradeBg =
        gc.pill.includes("emerald") ? "#dcfce7" :
        gc.pill.includes("sky") ? "#e0f2fe" :
        gc.pill.includes("amber") ? "#fef3c7" :
        gc.pill.includes("orange") ? "#ffedd5" :
        gc.pill.includes("red") ? "#fee2e2" :
        "#f3f4f6";
      const gradeFg =
        gc.pill.includes("emerald") ? "#15803d" :
        gc.pill.includes("sky") ? "#0369a1" :
        gc.pill.includes("amber") ? "#a16207" :
        gc.pill.includes("orange") ? "#c2410c" :
        gc.pill.includes("red") ? "#b91c1c" :
        "#555";
      const dir = t.direction ? t.direction.toUpperCase() : "—";
      const dirBg =
        t.direction === "call" || t.direction === "long" ? "#dcfce7" :
        t.direction === "put" || t.direction === "short" ? "#fee2e2" :
        "#f3f4f6";
      const dirFg =
        t.direction === "call" || t.direction === "long" ? "#15803d" :
        t.direction === "put" || t.direction === "short" ? "#b91c1c" :
        "#555";
      const fmt = (v: number | string | undefined) =>
        v == null ? "—" : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(v);
      return `
        <tr>
          <td style="${td};color:#999">${i + 1}</td>
          <td style="${td};font-family:ui-monospace,monospace;font-weight:600">${escapeHtml(t.ticker)}</td>
          <td style="${td}"><span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;background:${gradeBg};color:${gradeFg}">${escapeHtml(t.grade ?? "—")}</span></td>
          <td style="${td}"><span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;background:${dirBg};color:${dirFg}">${escapeHtml(dir)}</span></td>
          <td style="${td};font-family:ui-monospace,monospace">${escapeHtml(cleanStrikeDisplay(t.strike))}</td>
          <td style="${td};font-family:ui-monospace,monospace">${escapeHtml(t.entry_zone || "—")}</td>
          <td style="${td};font-family:ui-monospace,monospace">${escapeHtml(fmt(t.target1))}</td>
          <td style="${td};font-family:ui-monospace,monospace">${escapeHtml(fmt(t.target2))}</td>
          <td style="${td};font-family:ui-monospace,monospace">${escapeHtml(fmt(t.stop))}</td>
          <td style="${td};font-size:12px">${escapeHtml(t.time_stop || "—")}</td>
        </tr>
      `;
    })
    .join("");
  const rationaleRows = sorted
    .filter((t) => t.rationale)
    .map(
      (t) => `
    <li style="margin-bottom:6px"><strong>${escapeHtml(t.grade ?? "")}</strong> · <span style="font-family:ui-monospace,monospace;font-weight:600">${escapeHtml(t.ticker)}</span> — ${escapeHtml(t.rationale!)}</li>
  `,
    )
    .join("");
  return `
    <div style="overflow-x:auto;border:1px solid #e5e5e5;border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="${th}">#</th>
            <th style="${th}">Ticker</th>
            <th style="${th}">Grade</th>
            <th style="${th}">Dir</th>
            <th style="${th}">Strike</th>
            <th style="${th}">Entry</th>
            <th style="${th}">T1</th>
            <th style="${th}">T2</th>
            <th style="${th}">Stop</th>
            <th style="${th}">Time stop</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${rationaleRows ? `<ul style="margin:16px 0 0;padding-left:20px;font-size:13px;color:#333">${rationaleRows}</ul>` : ""}
  `;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}
