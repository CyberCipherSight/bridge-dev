import type { RequestHandler } from "express";
/** Connection-bound accounting: no idle polling, one release on finish or close. */
export function requestLimit(maximum: number): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= maximum) {
      res.setHeader("Retry-After", "1");
      res.status(503).json({ ok: false, error: "GATEWAY_BUSY" });
      return;
    }
    active++;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        active--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
