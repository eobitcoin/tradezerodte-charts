import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIngestBearer } from "@/lib/bearer";
import { buildKey, presignPut } from "@/lib/s3";

export const runtime = "nodejs";

const Body = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
});

export async function POST(req: Request) {
  const auth = requireIngestBearer(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const key = buildKey(parsed.filename);
  const { uploadUrl, publicUrl, expiresIn } = await presignPut(key, parsed.contentType);
  return NextResponse.json(
    { uploadUrl, key, publicUrl, expiresIn },
    { headers: { "Cache-Control": "no-store" } },
  );
}
