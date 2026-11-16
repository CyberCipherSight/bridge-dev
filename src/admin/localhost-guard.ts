import type { Request, Response, NextFunction } from "express";
import { validAdminSession } from "./local-session.js";

function isLocalAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/i, "").toLowerCase();
  // The remote peer must be loopback; an unspecified bind address is not a peer.
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const host=req.headers.host;
  if(host && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)){res.status(403).json({error:"Admin Host must be loopback"});return;}
  if (req.headers["sec-fetch-site"] === "cross-site") {
    res.status(403).json({ ok: false, error: "Cross-site admin request refused" });
    return;
  }
  const origin=req.headers.origin;
  if(origin){try{if(new URL(origin).host!==host)throw Error();}catch{res.status(403).json({error:"Cross-origin admin request refused"});return;}}
  const remote = req.socket.remoteAddress;
  if (!isLocalAddress(remote)) {
    res.status(403).json({ ok: false, error: "Admin API is localhost-only" });
    return;
  }
  next();
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN?.trim();
  // An unset token must never disable authentication, even on loopback.
  if (!token) {
    res.status(503).json({ ok: false, error: "Admin API is unavailable until ADMIN_TOKEN is configured" });
    return;
  }
  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : req.headers["x-admin-token"];
  if ((typeof provided !== "string" || provided !== token) && !validAdminSession(req)) {
    res.status(401).json({ ok: false, error: "Invalid admin token" });
    return;
  }
  next();
}