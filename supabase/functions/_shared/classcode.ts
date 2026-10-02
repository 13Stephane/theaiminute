// The class code is never stored. ai_control holds only a random salt; the
// code is HMAC-SHA256(CLASS_CODE_PEPPER, salt) mapped to six characters.
// Without the pepper (a Supabase secret) the database alone cannot yield the
// code, yet the control room can always show the current one. Rotating
// writes a fresh salt, which changes the code.

// No 0/O, 1/I/L: easy to read off a slide.
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export async function deriveCode(pepper: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(salt)));
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[mac[i] % ALPHABET.length];
  return code;
}

export function normalizeCode(s: string | null): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function newSalt(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
