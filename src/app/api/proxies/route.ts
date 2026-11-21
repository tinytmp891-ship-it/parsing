import { NextRequest, NextResponse } from "next/server";
import {
  addProxiesFromInput,
  clearAllProxies,
  deleteProxyEntry,
  getProxyPoolSnapshot,
  updateProxyEntry,
  updateProxySettings,
} from "@/lib/proxy/manager";
import type { ProxyProtocol, ProxySettings, ProxyType } from "@/lib/proxy/types";
import type { SourceId } from "@/lib/sources/model";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getProxyPoolSnapshot(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (body.action === "settings" && typeof body.settings === "object" && body.settings !== null) {
    const snapshot = updateProxySettings(body.settings as Partial<ProxySettings>);
    return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
  }

  const rawText = typeof body.rawText === "string" ? body.rawText : "";
  if (!rawText.trim()) {
    return NextResponse.json({ error: "Provide at least one proxy URL or host:port line" }, { status: 400 });
  }

  const defaultProtocol =
    body.defaultProtocol === "https" || body.defaultProtocol === "socks5" ? body.defaultProtocol : ("http" as ProxyProtocol);

  const result = addProxiesFromInput({
    rawText,
    defaultProtocol,
    proxyType: body.proxyType as ProxyType | undefined,
    country: typeof body.country === "string" ? body.country : undefined,
    sources: Array.isArray(body.sources) ? (body.sources as SourceId[]) : undefined,
    label: typeof body.label === "string" ? body.label : undefined,
  });

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (typeof body.settings === "object" && body.settings !== null) {
    const snapshot = updateProxySettings(body.settings as Partial<ProxySettings>);
    return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing proxy id" }, { status: 400 });
  }

  const snapshot = updateProxyEntry(id, {
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    label: typeof body.label === "string" ? body.label : undefined,
    proxyType: body.proxyType as ProxyType | undefined,
    country: typeof body.country === "string" ? body.country : undefined,
    sources: Array.isArray(body.sources) ? (body.sources as SourceId[]) : undefined,
  });

  if (!snapshot) {
    return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
  }
  return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("all") === "1") {
    return NextResponse.json({ snapshot: clearAllProxies() }, { headers: { "Cache-Control": "no-store" } });
  }
  const id = searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing id query parameter" }, { status: 400 });
  }
  return NextResponse.json({ snapshot: deleteProxyEntry(id) }, { headers: { "Cache-Control": "no-store" } });
}
