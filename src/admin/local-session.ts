import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

/**
 * Explicit local-operator pairing, not unauthenticated localhost login.
 * The CLI prints a one-use 60s code. The browser receives only a signed
 * HttpOnly cookie, not ADMIN_TOKEN. Cookie signing survives service restarts,
 * but rotation of ADMIN_TOKEN invalidates all outstanding sessions.
 */
const COOKIE = "bridge_dev_admin_session";
const CODE_TTL_MS = 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const usedCodes = new Map<string, number>();

function signature(secret: string, purpose: string, payload: string): string {
  return createHmac("sha256", secret).update("bridge-dev:" + purpose + ":" + payload).digest("hex");
}
function validMac(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
function secret(): string {
  return process.env.ADMIN_TOKEN?.trim() || "";
}
export function mintAdminPairCode(adminToken: string, now = Date.now()): string {
  if (!adminToken || adminToken.length < 32) throw Error("ADMIN_CREDENTIAL_REQUIRED");
  const payload = String(now + CODE_TTL_MS) + "." + randomBytes(16).toString("hex");
  return "p1." + payload + "." + signature(adminToken, "pair", payload);
}
function validatePairCode(code: string, adminToken: string, now: number): boolean {
  const match = /^p1\.([0-9]{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(code);
  if (!match) return false;
  const expiration = Number(match[1]);
  if (expiration < now || expiration > now + CODE_TTL_MS) return false;
  return validMac(match[3], signature(adminToken, "pair", match[1] + "." + match[2]));
}
function mintSession(adminToken: string): string {
  const payload = String(Date.now() + SESSION_TTL_MS) + "." + randomBytes(16).toString("hex");
  return "s1." + payload + "." + signature(adminToken, "session", payload);
}
export function validAdminSession(req: Request): boolean {
  const cookie = req.headers.cookie || "";
  const code = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!code) return false;
  const match = /^s1\.([0-9]{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(code);
  const adminToken = secret();
  if (!match || !adminToken) return false;
  const expiration = Number(match[1]);
  if (expiration <= Date.now() || expiration > Date.now() + SESSION_TTL_MS) return false;
  return validMac(match[3], signature(adminToken, "session", match[1] + "." + match[2]));
}
export function pairAdminSession(req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  // A cross-site navigation, form or image must not authorize an Admin browser.
  const fetchSite = req.get("sec-fetch-site");
  // Sec-Fetch-Site can be "none" or absent in some local browser contexts.
  // The signed short-lived code, custom header, JSON body and strict
  // loopback Host/Origin guard remain mandatory; cross-site callers fail.
  if ((fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") ||
      req.get("x-bridge-dev-pair") !== "1" || !req.is("application/json")) {
    res.status(403).json({ ok: false, error: "LOCAL_PAIRING_REQUIRES_SAME_ORIGIN" });
    return;
  }
  const adminToken = secret();
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const now = Date.now();
  for (const [key, expiry] of usedCodes) if (expiry < now) usedCodes.delete(key);
  if (usedCodes.has(code) || usedCodes.size > 256 || !adminToken || !validatePairCode(code, adminToken, now)) {
    res.status(403).json({ ok: false, error: "LOCAL_PAIRING_INVALID_OR_USED" });
    return;
  }
  usedCodes.set(code, now + CODE_TTL_MS);
  res.cookie(COOKIE, mintSession(adminToken), {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true, session: "local-operator", expires_in_seconds: SESSION_TTL_MS / 1000 });
}
export function endAdminSession(_req: Request, res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", path: "/" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, signed_out: true });
}
