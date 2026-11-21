"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseUserAgentDetails } = require("../../services/device/userAgentParser");

// Real User-Agent strings as the browsers send them (Chromium's reduced form included).
const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  chromeAndroidTablet: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  safariIphone26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  safariIpad: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  samsungInternet: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/494.0.0.48.73;]",
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/490.0.0.39.106;FBBV/671431524;FBDV/iPhone16,1;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  messengerAndroid: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/478.0.0.40.109;]",
  chromeLinux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  chromeOs: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  windows7: "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
  reactNativeAndroid: "okhttp/4.12.0",
  reactNativeIos: "MaslogCare/1 CFNetwork/1568.200.51 Darwin/24.1.0",
};

test("Chrome on Android: reduced UA gives no model and no OS version, never 'K'", () => {
  const ua = parseUserAgentDetails(UA.chromeAndroid);
  assert.equal(ua.modelRaw, null);
  assert.equal(ua.osVersion, null);
  assert.equal(ua.osName, "Android");
  assert.equal(ua.browserName, "Chrome");
  assert.equal(ua.browserVersion, "131");
  assert.equal(ua.deviceType, "phone");
  assert.equal(ua.isReduced, true);
  assert.equal(ua.engine, "blink");
});

test("Android without 'Mobile' is a tablet", () => {
  assert.equal(parseUserAgentDetails(UA.chromeAndroidTablet).deviceType, "tablet");
});

test("Safari on iPhone: Apple, iPhone class, no model", () => {
  const ua = parseUserAgentDetails(UA.safariIphone);
  assert.deepEqual([ua.brand, ua.modelRaw, ua.deviceType, ua.osName, ua.osVersion], ["Apple", null, "phone", "iOS", "18.1"]);
  assert.deepEqual([ua.browserName, ua.browserVersion, ua.engine], ["Safari", "18", "webkit"]);
});

test("Safari 26 on iPhone: frozen 18_6 OS token is replaced by the Safari major", () => {
  assert.equal(parseUserAgentDetails(UA.safariIphone26).osVersion, "26");
});

test("Chrome on iPhone is WebKit, keeps its real OS token", () => {
  const ua = parseUserAgentDetails(UA.chromeIphone);
  assert.deepEqual([ua.browserName, ua.engine, ua.osVersion], ["Chrome", "webkit", "18.1"]);
});

test("Safari on iPad (mobile UA)", () => {
  const ua = parseUserAgentDetails(UA.safariIpad);
  assert.deepEqual([ua.osName, ua.deviceType, ua.brand], ["iPadOS", "tablet", "Apple"]);
});

test("Safari on macOS: frozen 10_15_7 is not reported as the version", () => {
  const ua = parseUserAgentDetails(UA.safariMac);
  assert.deepEqual([ua.osName, ua.osVersion, ua.deviceType, ua.brand, ua.modelRaw], ["macOS", null, "desktop", "Apple", null]);
});

test("Firefox on Windows: Windows 10 and 11 cannot be told apart", () => {
  const ua = parseUserAgentDetails(UA.firefoxWindows);
  assert.deepEqual([ua.osName, ua.osVersion, ua.browserName, ua.browserVersion, ua.engine], ["Windows", null, "Firefox", "133", "gecko"]);
  assert.equal(ua.brand, null);
  assert.equal(ua.modelRaw, null);
});

test("Firefox on Android: no model in the UA", () => {
  const ua = parseUserAgentDetails(UA.firefoxAndroid);
  assert.deepEqual([ua.osName, ua.osVersion, ua.modelRaw, ua.deviceType], ["Android", "14", null, "phone"]);
});

test("Edge on Windows is Edge, not Chrome", () => {
  const ua = parseUserAgentDetails(UA.edgeWindows);
  assert.deepEqual([ua.browserName, ua.browserVersion, ua.engine], ["Edge", "131", "blink"]);
});

test("Samsung Internet is named, and its reduced UA gives no model", () => {
  const ua = parseUserAgentDetails(UA.samsungInternet);
  assert.deepEqual([ua.browserName, ua.browserVersion, ua.modelRaw], ["Samsung Internet", "27", null]);
});

test("Facebook in-app browser on Android: WebView UA keeps the model code", () => {
  const ua = parseUserAgentDetails(UA.facebookAndroid);
  assert.deepEqual([ua.inAppBrowser, ua.modelRaw, ua.osVersion], ["Facebook", "SM-S918B", "14"]);
});

test("Facebook in-app browser on iPhone: no model, no invented browser", () => {
  const ua = parseUserAgentDetails(UA.facebookIos);
  assert.deepEqual([ua.inAppBrowser, ua.modelRaw, ua.browserName, ua.brand], ["Facebook", null, null, "Apple"]);
});

test("Messenger is told apart from Facebook", () => {
  const ua = parseUserAgentDetails(UA.messengerAndroid);
  assert.deepEqual([ua.inAppBrowser, ua.modelRaw], ["Messenger", "Pixel 7"]);
});

test("Desktop Linux, Chrome OS and Windows 7", () => {
  assert.equal(parseUserAgentDetails(UA.chromeLinux).osName, "Linux");
  assert.equal(parseUserAgentDetails(UA.chromeOs).osName, "Chrome OS");
  assert.equal(parseUserAgentDetails(UA.windows7).osVersion, "7");
});

test("React Native clients are recognised by their HTTP stack, nothing more", () => {
  const android = parseUserAgentDetails(UA.reactNativeAndroid);
  assert.deepEqual([android.kind, android.osName, android.modelRaw], ["native-android", "Android", null]);
  const ios = parseUserAgentDetails(UA.reactNativeIos);
  assert.deepEqual([ios.kind, ios.osName, ios.brand], ["native-ios", "iOS", "Apple"]);
});

test("Empty, junk and oversized input never throw", () => {
  assert.equal(parseUserAgentDetails("").kind, "unknown");
  assert.equal(parseUserAgentDetails(undefined).kind, "unknown");
  assert.equal(parseUserAgentDetails("curl/8.5.0").kind, "unknown");
  assert.equal(parseUserAgentDetails(`Mozilla/5.0 (${"x".repeat(5000)}`).kind, "browser");
});
