import { assertFetchableImageUrl } from "./url-safety";

export type MediaCheck = {
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  checkedAt: string;
  detail: string;
};

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function contentTypeOf(header: string | null): string | null {
  if (!header) return null;
  return header.split(";")[0].trim().toLowerCase();
}

async function request(url: string, method: "HEAD" | "GET", fetchImpl: typeof fetch): Promise<Response> {
  const response = await fetchImpl(url, {
    method,
    redirect: "follow",
    headers: method === "GET" ? { Range: "bytes=0-1023" } : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (method === "GET") {
    await response.body?.cancel().catch(() => undefined);
  }
  return response;
}

export async function checkImageUrl(raw: string, fetchImpl: typeof fetch = fetch): Promise<MediaCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const url = assertFetchableImageUrl(raw);
    let response = await request(url.toString(), "HEAD", fetchImpl);
    if (response.status === 405 || response.status === 501) {
      response = await request(url.toString(), "GET", fetchImpl);
    }
    const contentType = contentTypeOf(response.headers.get("content-type"));
    if (response.status !== 200 && response.status !== 206) {
      return { ok: false, httpStatus: response.status, contentType, checkedAt, detail: `HTTP ${response.status}` };
    }
    if (!contentType || !ALLOWED.has(contentType)) {
      return {
        ok: false,
        httpStatus: response.status,
        contentType,
        checkedAt,
        detail: `Content-Type ${contentType ?? "missing"} is not an allowed image type.`,
      };
    }
    return { ok: true, httpStatus: response.status, contentType, checkedAt, detail: "reachable" };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      contentType: null,
      checkedAt,
      detail: error instanceof Error ? error.message : "Image check failed.",
    };
  }
}
