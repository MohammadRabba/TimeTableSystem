import { NextRequest, NextResponse } from "next/server";

// Next.js → Python scheduler proxy.
//
// Forwards every request under /api/scheduler/<path> to the Python
// OR-Tools CP-SAT microservice at SCHEDULER_BACKEND_URL (default
// http://127.0.0.1:3040). This lets the Next.js backend call the solver
// using a relative URL (SCHEDULER_URL=/api/scheduler) which is useful
// when the Python port isn't directly reachable from the browser or
// when going through the Caddy gateway.

const BACKEND = process.env.SCHEDULER_BACKEND_URL || "http://127.0.0.1:3040";

async function forward(req: NextRequest, path: string) {
  const url = new URL(req.url);
  const targetUrl = `${BACKEND.replace(/\/$/, "")}/${path}${url.search}`;
  const method = req.method;
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    // Skip host/content-length (fetch will set them)
    if (key.toLowerCase() === "host" || key.toLowerCase() === "content-length") return;
    headers.set(key, value);
  });
  // Always accept JSON
  headers.set("accept", "application/json");

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.text();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5min hard cap
  try {
    const r = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await r.text();
    const respHeaders = new Headers();
    r.headers.forEach((v, k) => respHeaders.set(k, v));
    // Strip content-length so NextResponse can compute its own
    respHeaders.delete("content-length");
    return new NextResponse(text, {
      status: r.status,
      statusText: r.statusText,
      headers: respHeaders,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Scheduler backend unreachable: ${e?.message || e}. Backend: ${BACKEND}. Make sure the Python service is running (mini-services/scheduler/start.sh)` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}
