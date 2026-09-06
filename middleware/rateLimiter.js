"use strict";

/**
 * In-Memory Sliding Window Rate Limiter
 * Zero external dependency, robust against burst spam and double-submit.
 */

class SlidingWindowStore {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();

    // Periodic sweep every 5 minutes to prevent memory leak
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  isLimited(key) {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];

    // Filter out timestamps outside the current sliding window
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      this.hits.set(key, validTimestamps);
      return true;
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);
    return false;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }
}

// 15 requests per 15 minutes per IP for OTP / Register endpoints
const ipLimiterStore = new SlidingWindowStore(15 * 60 * 1000, 15);

// 5 OTP requests per 15 minutes per specific email address
const emailLimiterStore = new SlidingWindowStore(15 * 60 * 1000, 5);

/**
 * Middleware: Rate limit OTP / Auth requests by Client IP and Target Email
 */
function otpRateLimiter(req, res, next) {
  // IP resolution
  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown-ip";

  if (ipLimiterStore.isLimited(clientIp)) {
    console.warn(`⚠️  [RATE LIMIT] IP ${clientIp} exceeded OTP request rate limit`);
    return res.status(429).json({
      success: false,
      code: "OTP_RATE_LIMITED",
      message: "Too many requests from this device. Please wait before trying again.",
    });
  }

  const email = (req.body?.email || "").toLowerCase().trim();
  if (email && emailLimiterStore.isLimited(email)) {
    console.warn(`⚠️  [RATE LIMIT] Email ${email} exceeded OTP request limit`);
    return res.status(429).json({
      success: false,
      code: "OTP_RATE_LIMITED",
      message: "Too many verification requests for this email. Please wait a few minutes before trying again.",
    });
  }

  next();
}

module.exports = {
  otpRateLimiter,
};
