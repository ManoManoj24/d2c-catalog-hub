const BLOCKED_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

function ipv4Parts(host: string): number[] | null {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local")) return true;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

export function assertFetchableImageUrl(raw: string, allowLocal = process.env.ALLOW_LOCAL_MEDIA_URLS === "true"): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Image URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Image URL must use http or https.");
  }
  if (url.username || url.password) throw new Error("Image URL cannot include credentials.");
  if (isPrivateHost(url.hostname) && !(allowLocal && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"))) {
    throw new Error("Image URL host is not allowed.");
  }
  return url;
}
