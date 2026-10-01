import { ALLOWED_ORIGINS } from "./config.ts";

// localhost is allowed only when the dev flag is set on the function.
export function originAllowed(origin: string | null, allowLocalhost: boolean): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (allowLocalhost && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) return true;
  return false;
}

export function corsHeaders(origin: string, allowHeaders: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

// The class code: six characters from an alphabet with no look-alikes (0/O, 1/I/L).
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newClassCode(): string {
  const out: string[] = [];
  const buf = new Uint8Array(1);
  while (out.length < 6) {
    crypto.getRandomValues(buf);
    // Rejection sampling keeps every character equally likely.
    if (buf[0] < 256 - (256 % CODE_ALPHABET.length)) out.push(CODE_ALPHABET[buf[0] % CODE_ALPHABET.length]);
  }
  return out.join("");
}

export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

export function newSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return toHex(b);
}

// HMAC-SHA256 keyed with the pepper secret, over salt and code.
export async function hashCode(code: string, salt: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(salt + ":" + normaliseCode(code)));
  return toHex(new Uint8Array(sig));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
