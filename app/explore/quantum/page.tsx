import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadQuantumPreview,
  listQuantumScanDays,
} from "@/lib/explore-preview";
import QuantumPreviewView from "@/components/QuantumPreviewView";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export async function generateMetadata(): Promise<Metadata> {
  const preview = await loadQuantumPreview();
  if (!preview) return { title: "Quantum Research — Olivia Trades" };
  const scanLabel = new Date(`${preview.scanDay}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
  const teaser = preview.headline
    ? (preview.headline.headline || "Weekly quantum-computing research.").slice(0, 180)
    : "Weekly quantum-computing research — IONQ, RGTI, QBTS, QUBT, INFQ, FORM.";
  return {
    title: `Quantum Research — ${scanLabel} | Olivia Trades`,
    description: teaser,
    alternates: { canonical: `${APP_URL}/explore/quantum` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreQuantumLanding() {
  const preview = await loadQuantumPreview();
  if (!preview) notFound();
  const archive = (await listQuantumScanDays(26))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({
      scanDay: d,
      href: `/explore/quantum/${d}`,
      label: "View preview",
    }));
  return <QuantumPreviewView preview={preview} archive={archive} />;
}
