import { NextRequest, NextResponse } from "next/server";
import { testProxyConnection } from "@/lib/net/resilient-fetch";
import { getProxyPoolSnapshot } from "@/lib/proxy/manager";
import { mapWithConcurrency } from "@/lib/sources/model";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const target = typeof body?.target === "string" && body.target ? body.target : "ip-check";

  if (body?.all === true) {
    const current = getProxyPoolSnapshot();
    const results: Awaited<ReturnType<typeof testProxyConnection>>[] = [];
    await mapWithConcurrency(current.proxies, 4, async (proxy) => {
      results.push(await testProxyConnection(proxy.id, target));
    });
    return NextResponse.json(
      { results, snapshot: getProxyPoolSnapshot() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing proxy id or all=true" }, { status: 400 });
  }

  const result = await testProxyConnection(id, target);
  return NextResponse.json(
    { results: [result], snapshot: getProxyPoolSnapshot() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
