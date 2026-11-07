"use strict";
const PUBLIC_OPERATIONS = new Set(["login", "logout", "register", "health", "ready", "session", "profile", "notifications"]);

const requestOperation = (req) => {
  if (typeof req?.route?.path === "string") return req.route.path;
  const first = String(req?.path || "").split("/").filter(Boolean).filter((part) => part !== "api")[0];
  return PUBLIC_OPERATIONS.has(first) ? `/${first}` : "unmatched";
};
module.exports = { requestOperation };
