"use strict";
const { randomUUID } = require("node:crypto");
const logger = require("../utils/logger");
const { requestOperation } = require("../utils/requestOperation");

const requestDiagnostics = (req, res, next) => {
  const proposed = req.headers["x-request-id"];
  req.requestId = typeof proposed === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(proposed)
    ? proposed : randomUUID();
  req.dependencyMs = {};
  res.setHeader("X-Request-ID", req.requestId);
  const started = performance.now();
  let recorded = false;
  const record = (cancelled) => {
    if (recorded) return;
    recorded = true;
    logger.info("Request completed", {
      requestId: req.requestId,
      retryCount: /^[0-2]$/.test(req.headers["x-request-attempt"] ?? "") ? Number(req.headers["x-request-attempt"]) : 0,
      method: req.method,
      route: requestOperation(req),
      durationMs: Math.round(performance.now() - started),
      status: cancelled ? undefined : res.statusCode,
      category: cancelled ? "cancelled" : res.locals.failureCode || (res.statusCode >= 400 ? "http_error" : "success"),
      dependencyMs: req.dependencyMs,
    });
  };
  res.once("finish", () => record(false));
  res.once("close", () => record(!res.writableFinished));
  next();
};

const timeDependency = async (req, operation, work) => {
  const started = performance.now();
  try { return await work(); }
  finally {
    if (req.dependencyMs) req.dependencyMs[operation] = Math.round(performance.now() - started);
  }
};
module.exports = { requestDiagnostics, timeDependency };
