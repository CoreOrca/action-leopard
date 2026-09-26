import { createHmac, timingSafeEqual } from "crypto";

export const ACCESS_COOKIE = "al-access";

export function accessCodes(): string[] {
  return (process.env.USER_ACCESS_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

/** The hosted app stays closed when at least one code is configured. */
export function gateEnabled(): boolean {
  return accessCodes().length > 0;
}

function digest(value: string): Buffer {
  return createHmac("sha256", "action-leopard-access-v1").update(value).digest();
}

export function codeMatches(input: string): boolean {
  const given = digest(input.trim());
  return accessCodes().some((code) => timingSafeEqual(given, digest(code)));
}

export function accessToken(): string {
  return createHmac("sha256", "action-leopard-access-v1")
    .update(accessCodes().join("\n"))
    .digest("hex");
}

export function hasAccessCookie(value: string | undefined): boolean {
  if (!value) return false;
  const expected = accessToken();
  const given = Buffer.from(value);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
