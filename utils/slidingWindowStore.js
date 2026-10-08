"use strict";

class SlidingWindowStore {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();

    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  isLimited(key) {
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      this.hits.set(key, recent);
      return true;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return false;
  }

  // If the key is currently limited, return how many whole seconds remain
  // until the window expires for the earliest recorded hit. Returns 0 when
  // not limited.
  getRetryAfterSeconds(key) {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);
    if (recent.length < this.maxRequests) return 0;
    // earliest timestamp still in the window
    const earliest = Math.min(...recent);
    const remainingMs = this.windowMs - (now - earliest);
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  reset(key) {
    this.hits.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowMs);
      if (valid.length === 0) this.hits.delete(key);
      else this.hits.set(key, valid);
    }
  }
}

// req.ip only honours X-Forwarded-For when app "trust proxy" is set (TRUST_PROXY).
// Reading the header directly let any client send a fresh fake IP per request
// and skip the per-device login and OTP limits.
function clientIpOf(req) {
  return req.ip || req.socket?.remoteAddress || "unknown-ip";
}

module.exports = { SlidingWindowStore, clientIpOf };
