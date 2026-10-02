// Origins allowed to call the functions from a browser.
// http://localhost:* and 127.0.0.1:* are added only when AI_DEV=1.

const PROD = ["https://www.theaiminute.blog", "https://theaiminute.blog"];
const DEV_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function originAllowed(origin: string | null, dev: boolean): boolean {
  if (!origin) return false;
  return PROD.includes(origin) || (dev && DEV_RE.test(origin));
}

export function corsHeaders(origin: string | null, dev: boolean, methods: string): Record<string, string> {
  const h: Record<string, string> = { "Vary": "Origin" };
  if (originAllowed(origin, dev)) {
    h["Access-Control-Allow-Origin"] = origin!;
    h["Access-Control-Allow-Methods"] = methods;
    h["Access-Control-Allow-Headers"] = "content-type, x-class-code, x-device-id, authorization, apikey, x-client-info";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}
