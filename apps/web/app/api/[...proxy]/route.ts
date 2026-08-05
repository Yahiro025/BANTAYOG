import { NextRequest } from 'next/server';

export const runtime = 'edge';

let API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "https://bantayogserver-production.up.railway.app";
if (!API_BASE_URL.startsWith("http://") && !API_BASE_URL.startsWith("https://")) {
  API_BASE_URL = "https://" + API_BASE_URL;
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UPSTREAM_RETRY_DELAYS_MS = [0, 500, 1000, 1500, 2000] as const;
const DEV_API_DELAY_MS = process.env.NODE_ENV === "production"
  ? 0
  : Math.min(Math.max(Number(process.env.DEV_API_DELAY_MS ?? 0) || 0, 0), 10_000);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchUpstream(targetUrl: URL, options: RequestInit): Promise<Response> {
  const canRetry = IDEMPOTENT_METHODS.has(options.method ?? "GET");
  let lastError: unknown;

  for (let attempt = 0; attempt < UPSTREAM_RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = attempt === 0 ? DEV_API_DELAY_MS : UPSTREAM_RETRY_DELAYS_MS[attempt];
    if (delay > 0) await wait(delay);

    try {
      return await fetch(targetUrl, options);
    } catch (error) {
      lastError = error;
      if (!canRetry || attempt === UPSTREAM_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Upstream request failed");
}

async function proxyRequest(req: NextRequest) {
  const url = new URL(req.url);

  try {
    // Construct the target URL.
    // e.g. /api/beneficiaries -> https://bantayogserver.../api/beneficiaries
    const targetUrl = new URL(url.pathname + url.search, API_BASE_URL);
    console.log("PROXYING TO:", targetUrl.href);

    // Forward essential headers
    const headers = new Headers();
    if (req.headers.has('authorization')) headers.set('authorization', req.headers.get('authorization')!);
    if (req.headers.has('content-type')) headers.set('content-type', req.headers.get('content-type')!);

    // Forward the request
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      redirect: 'manual',
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = req.body;
      // Next.js edge runtime requires duplex: 'half' when forwarding streams
      (fetchOptions as any).duplex = 'half';
    }

    const response = await fetchUpstream(targetUrl, fetchOptions);

    // Return the response
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding'); // Let Next.js handle encoding

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[api-proxy] ${req.method} ${url.pathname} upstream request failed.`, error);
    } else {
      console.error(`[api-proxy] ${req.method} ${url.pathname} upstream request failed.`);
    }

    return new Response(
      JSON.stringify({
        error: 'upstream_unavailable',
        message: 'The API server could not be reached.',
      }),
      {
        status: 502,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        },
      },
    );
  }
}

export async function GET(req: NextRequest) { return proxyRequest(req); }
export async function POST(req: NextRequest) { return proxyRequest(req); }
export async function PUT(req: NextRequest) { return proxyRequest(req); }
export async function PATCH(req: NextRequest) { return proxyRequest(req); }
export async function DELETE(req: NextRequest) { return proxyRequest(req); }
export async function OPTIONS(req: NextRequest) { return proxyRequest(req); }
