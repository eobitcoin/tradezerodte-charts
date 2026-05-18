import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getObjectStream } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  if (!key || key.includes("..")) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  const obj = await getObjectStream(key);
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });

  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (obj.contentType) headers["Content-Type"] = obj.contentType;
  if (obj.contentLength != null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { status: 200, headers });
}
