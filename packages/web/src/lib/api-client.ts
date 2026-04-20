/**
 * Thin fetch wrapper for the /api surface.
 * Throws ApiError for non-2xx; parses JSON by default.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiErrorShape {
  error?: string;
  code?: string;
  message?: string;
}

export interface RequestInitJson<B = unknown> extends Omit<RequestInit, "body"> {
  json?: B;
}

export async function apiFetch<T>(path: string, init: RequestInitJson = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, body, headers });

  if (!res.ok) {
    let msg = res.statusText;
    let code: string | undefined;
    try {
      const data = (await res.json()) as ApiErrorShape;
      msg = data.error || data.message || msg;
      code = data.code;
    } catch {
      /* non-JSON error response — keep statusText */
    }
    throw new ApiError(msg, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiSearchParams(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === null) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
