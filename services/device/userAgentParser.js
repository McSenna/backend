"use strict";

/**
 * What a User-Agent header can honestly say. Browsers have frozen much of it:
 * Chromium sends "Android 10; K" on every Android phone, "Windows NT 10.0" for
 * Windows 10 and 11, and "Mac OS X 10_15_7" on every Mac; Safari on iOS 26 pins
 * its OS token to 18.x. A frozen value comes back as null, never as a fact.
 */

const MAX_LENGTH = 512;

const IN_APP_BROWSERS = [
  [/FBAN\/Messenger|MessengerForiOS|FB_IAB\/Orca-Android|MessengerLite/i, "Messenger"],
  [/FBAN\/|FBAV\/|FB_IAB\/|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/\bLine\/\d/i, "LINE"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
];

// Order matters: these tokens also carry "Chrome/" or "Safari/".
const BROWSERS = [
  [/SamsungBrowser\/(\d+)/, "Samsung Internet", "blink"],
  [/Edg(?:A|iOS)?\/(\d+)/, "Edge", "blink"],
  [/(?:OPR|OPiOS)\/(\d+)/, "Opera", "blink"],
  [/CriOS\/(\d+)/, "Chrome", "webkit"],
  [/FxiOS\/(\d+)/, "Firefox", "webkit"],
  [/Firefox\/(\d+)/, "Firefox", "gecko"],
  [/Chrome\/(\d+)/, "Chrome", "blink"],
  [/Version\/(\d+)(?:\.\d+)*.*Safari\//, "Safari", "webkit"],
];

const TV = /SmartTV|SMART-TV|Tizen.+TV|Web0S|webOS.+TV|AppleTV|GoogleTV|BRAVIA|\bAFT[A-Z]/i;
const FROZEN_IOS_TOKENS = new Set(["18.6", "18.6.2", "18.7"]);
const NOT_A_MODEL = /^(K|wv|Mobile|Tablet|Linux|U|[a-z]{2}[-_][a-z]{2})$/i;
const WINDOWS_VERSIONS = { "6.1": "7", "6.2": "8", "6.3": "8.1" };

const EMPTY = Object.freeze({
  kind: "unknown",
  osName: null,
  osVersion: null,
  osFamily: null,
  browserName: null,
  browserVersion: null,
  engine: null,
  deviceType: "unknown",
  brand: null,
  modelRaw: null,
  inAppBrowser: null,
  isReduced: false,
});

const readBrowser = (ua) => {
  for (const [pattern, name, engine] of BROWSERS) {
    const match = ua.match(pattern);
    if (match) return { browserName: name, browserVersion: match[1], engine: /iPhone|iPad|iPod/.test(ua) ? "webkit" : engine };
  }
  return { browserName: null, browserVersion: null, engine: /AppleWebKit/.test(ua) ? "webkit" : null };
};

const readAndroidModel = (ua) => {
  const match = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?(?:;|\))/);
  const model = match?.[1]?.trim();
  return model && !NOT_A_MODEL.test(model) ? model : null;
};

const readAndroid = (ua) => {
  const isReduced = /Android 10; K\)/.test(ua);
  return {
    osName: "Android",
    osFamily: "android",
    osVersion: isReduced ? null : ua.match(/Android (\d+(?:\.\d+)?)/)?.[1] ?? null,
    deviceType: /Mobile/.test(ua) ? "phone" : "tablet",
    modelRaw: isReduced ? null : readAndroidModel(ua),
    isReduced,
  };
};

const readIos = (ua, browser) => {
  const token = ua.match(/OS (\d+(?:_\d+){0,2}) like Mac OS X/)?.[1]?.replace(/_/g, ".") ?? null;
  const safariMajor = browser.browserName === "Safari" ? Number(browser.browserVersion) : null;
  let osVersion = token;
  // Safari 26 ships only with iOS 26 and keeps its own version honest.
  if (safariMajor && safariMajor >= 26) osVersion = String(safariMajor);
  else if (token && FROZEN_IOS_TOKENS.has(token) && !safariMajor) osVersion = null;
  return {
    osName: /iPad/.test(ua) ? "iPadOS" : "iOS",
    osFamily: "ios",
    osVersion,
    deviceType: /iPad/.test(ua) ? "tablet" : "phone",
    brand: "Apple",
  };
};

const readDesktop = (ua) => {
  const windows = ua.match(/Windows NT (\d+\.\d+)/);
  if (windows) return { osName: "Windows", osFamily: "windows", osVersion: WINDOWS_VERSIONS[windows[1]] ?? null };
  const mac = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/);
  if (mac || /Macintosh/.test(ua)) {
    const version = mac?.[1]?.replace(/_/g, ".") ?? null;
    return { osName: "macOS", osFamily: "macos", osVersion: version && !version.startsWith("10.15") ? version : null, brand: "Apple" };
  }
  if (/CrOS/.test(ua)) return { osName: "Chrome OS", osFamily: "chromeos", osVersion: null };
  if (/Linux|X11/.test(ua)) return { osName: "Linux", osFamily: "linux", osVersion: null };
  return null;
};

const readNativeClient = (ua) => {
  if (/^okhttp\//i.test(ua)) return { ...EMPTY, kind: "native-android", osName: "Android", osFamily: "android" };
  if (/CFNetwork\/.+Darwin\//.test(ua)) return { ...EMPTY, kind: "native-ios", osName: "iOS", osFamily: "ios", brand: "Apple" };
  return null;
};

const parseUserAgentDetails = (userAgent) => {
  const ua = String(userAgent || "").slice(0, MAX_LENGTH).trim();
  if (!ua) return { ...EMPTY };

  const native = readNativeClient(ua);
  if (native) return native;
  if (!/^Mozilla\//.test(ua)) return { ...EMPTY };

  const browser = readBrowser(ua);
  const inAppBrowser = IN_APP_BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? (/; wv\)/.test(ua) ? "Android WebView" : null);
  let os = null;
  if (/Android/.test(ua)) os = readAndroid(ua);
  else if (/iPhone|iPad|iPod/.test(ua)) os = readIos(ua, browser);
  else {
    const desktop = readDesktop(ua);
    if (desktop) os = { ...desktop, deviceType: "desktop" };
  }
  const deviceType = TV.test(ua) ? "tv" : os?.deviceType ?? "unknown";

  return { ...EMPTY, kind: "browser", ...browser, ...os, deviceType, inAppBrowser };
};

module.exports = { parseUserAgentDetails, MAX_USER_AGENT_LENGTH: MAX_LENGTH };
