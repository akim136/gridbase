import { type NextRequest, NextResponse } from "next/server";

/**
 * BFF proxy: forwards /api/grid/* to grid-api with the Bearer secret attached
 * server-side, so the browser never sees GRID_API_SECRET. Used by interactive
 * client components (filtering, and the Phase 2+ mutations). Server Components
 * should call lib/server/gridApi directly instead of going through this hop.
 */
const BASE = process.env.GRID_API_URL ?? "http://localhost:8799";
const SECRET = process.env.GRID_API_SECRET ?? "";

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const target = `${BASE}/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const init: RequestInit = {
    method: request.method,
    headers: {
      ...(SECRET ? { Authorization: `Bearer ${SECRET}` } : {}),
      ...(request.headers.get("content-type") ? { "Content-Type": request.headers.get("content-type")! } : {}),
    },
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  const res = await fetch(target, init);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      // Record data is live + access-controlled; never let it be cached downstream.
      "Cache-Control": res.headers.get("cache-control") ?? "no-store",
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
