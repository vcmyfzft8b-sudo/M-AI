import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const iosRoot = join(repoRoot, "ios-app");
const deprecatedVercelDomain = ["notetakingappslo", "vercel", "app"].join(".");

const checks = [];

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function addCheck(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}

function requireFile(path) {
  const fullPath = join(repoRoot, path);
  const pass = existsSync(fullPath);
  addCheck(`file exists: ${path}`, pass);
  return pass;
}

function requireIncludes(path, expected) {
  const content = read(path);
  const values = Array.isArray(expected) ? expected : [expected];

  for (const value of values) {
    addCheck(`${path} includes ${value}`, content.includes(value));
  }
}

function requireExcludes(path, forbidden) {
  const content = read(path);
  const values = Array.isArray(forbidden) ? forbidden : [forbidden];

  for (const value of values) {
    addCheck(`${path} excludes ${value}`, !content.includes(value));
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(join(repoRoot, path))).digest("hex");
}

function walkFiles(directory) {
  const entries = readdirSync(directory);
  const files = [];

  for (const entry of entries) {
    if (entry === "node_modules") {
      continue;
    }

    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (stats.isFile()) {
      files.push(path);
    }
  }

  return files;
}

requireFile("ios-app/package.json");
requireFile("ios-app/package-lock.json");
requireFile("ios-app/capacitor.config.ts");
requireFile("ios-app/ios/App/App.xcodeproj/project.pbxproj");
requireFile("ios-app/ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");
requireFile("ios-app/ios/App/App/Info.plist");
requireFile("ios-app/ios/App/App/MemoBridgeViewController.swift");
requireFile("ios-app/ios/App/App/MemoStoreKitPlugin.swift");
requireFile("ios-app/ios/App/App/PrivacyInfo.xcprivacy");
requireFile("docs/ios-app-store-readiness.md");
requireFile("ios-app/docs/xcode-archive-checklist.md");
requireFile("src/app/legal/privacy/page.tsx");
requireFile("src/app/legal/terms/page.tsx");
requireFile("src/app/support/page.tsx");
requireFile("src/lib/account-data-cleanup.ts");

requireIncludes("ios-app/capacitor.config.ts", [
  'appId: "eu.memoai.app"',
  'appendUserAgent: "MemoAIiOS/1.0"',
  'url: process.env.MEMO_IOS_SERVER_URL ?? "https://memoai.eu"',
  'errorPath: "index.html"',
]);
requireExcludes("ios-app/capacitor.config.ts", deprecatedVercelDomain);
requireIncludes("ios-app/www/index.html", [
  "Povezava do aplikacije trenutno ni na voljo.",
  "memo-logo.png",
]);

requireIncludes("src/lib/brand.ts", [
  'SEO_SITE_URL = "https://memoai.eu"',
  'SUPPORT_EMAIL = "support@memoai.eu"',
  'PUBLIC_SUPPORT_PATH = "/support"',
  'PUBLIC_PRIVACY_POLICY_PATH = "/legal/privacy"',
]);
requireExcludes("src/lib/brand.ts", "https://www.memoai.eu");

if (existsSync(join(repoRoot, "ios-app/ios/App/App/capacitor.config.json"))) {
  const generatedConfig = JSON.parse(read("ios-app/ios/App/App/capacitor.config.json"));
  addCheck(
    "generated iOS config uses canonical production URL",
    generatedConfig.server?.url === "https://memoai.eu",
    generatedConfig.server?.url,
  );
  addCheck(
    "generated iOS config has local error fallback",
    generatedConfig.server?.errorPath === "index.html",
    generatedConfig.server?.errorPath,
  );
  addCheck(
    "generated iOS config appends native user agent",
    generatedConfig.appendUserAgent === "MemoAIiOS/1.0",
    generatedConfig.appendUserAgent,
  );
}

requireIncludes("ios-app/ios/App/App/Info.plist", [
  "eu.memoai.pro.monthly",
  "eu.memoai.pro.yearly",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSDocumentsFolderUsageDescription",
  "arm64",
]);

requireIncludes("ios-app/docs/xcode-archive-checklist.md", [
  "StoreKit Configuration File",
  "eu.memoai.pro.monthly",
  "eu.memoai.pro.yearly",
  "App Store sandbox purchases",
  "TestFlight",
]);

addCheck(
  "iOS app icon is not the Capacitor placeholder",
  sha256("ios-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png") !==
    "29e4777e319de3ee5a52c3a8004ec19d0568414004257e36d7c94a077d71c93b",
);

requireIncludes("ios-app/ios/App/App.xcodeproj/project.pbxproj", [
  "MemoStoreKitPlugin.swift in Sources",
  "MemoBridgeViewController.swift in Sources",
  "PrivacyInfo.xcprivacy in Resources",
  "PRODUCT_BUNDLE_IDENTIFIER = eu.memoai.app;",
]);

requireIncludes("ios-app/ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme", [
  'BlueprintName = "App"',
  'BuildableName = "App.app"',
  'buildForArchiving = "YES"',
  'buildConfiguration = "Release"',
]);

requireIncludes("ios-app/ios/App/App/MemoBridgeViewController.swift", [
  "registerPluginType(MemoStoreKitPlugin.self)",
]);

requireIncludes("ios-app/ios/App/App/MemoStoreKitPlugin.swift", [
  "import StoreKit",
  "Product.products",
  "appAccountToken",
  ".appAccountToken(appAccountToken)",
  "product.purchase",
  "AppStore.sync",
  "Transaction.currentEntitlements",
  "transaction.jwsRepresentation",
]);

requireIncludes("ios-app/ios/App/App/PrivacyInfo.xcprivacy", [
  "NSPrivacyTracking",
  "NSPrivacyCollectedDataTypeEmailAddress",
  "NSPrivacyCollectedDataTypePurchaseHistory",
  "NSPrivacyCollectedDataTypeAudioData",
  "NSPrivacyCollectedDataTypeOtherUserContent",
  "NSPrivacyAccessedAPICategoryUserDefaults",
  "CA92.1",
  "NSPrivacyAccessedAPICategoryFileTimestamp",
  "C617.1",
  "NSPrivacyAccessedAPICategoryDiskSpace",
  "E174.1",
  "NSPrivacyAccessedAPICategorySystemBootTime",
  "35F9.1",
]);
addCheck(
  "iOS privacy manifest declares tracking disabled",
  /<key>NSPrivacyTracking<\/key>\s*<false\/>/u.test(read("ios-app/ios/App/App/PrivacyInfo.xcprivacy")),
);

requireIncludes("src/components/onboarding-paywall.tsx", [
  'commerceMode?: NativeCommerceMode',
  'commerceMode === "ios-app"',
  "const paywallPlans = [yearlyPlan, monthlyPlan]",
  "PUBLIC_PRIVACY_POLICY_PATH",
  "PUBLIC_TERMS_OF_USE_PATH",
  "startAppStorePurchase",
  "restoreAppStorePurchases",
  "appAccountToken",
  "/api/billing/apple/transactions",
  "Obnovi nakupe",
  "Varno plačilo prek App Store",
  "memo-paywall-legal",
  "Naročnina se samodejno obnavlja",
  "nastavitvah App Store",
]);

requireIncludes("src/app/app/start/page.tsx", [
  "isMemoIosAppUserAgent",
  "commerceMode={commerceMode}",
]);

requireIncludes("src/app/app/settings/page.tsx", [
  "isMemoIosAppUserAgent",
  "itms-apps://apps.apple.com/account/subscriptions",
  "DeleteAccountButton",
  'subscriptionProvider={isIosApp ? "ios-app" : "web"}',
  "/app/support/contact-support",
  "PUBLIC_PRIVACY_POLICY_PATH",
  "PUBLIC_SUPPORT_PATH",
  "PUBLIC_TERMS_OF_USE_PATH",
]);

requireIncludes("src/components/delete-account-button.tsx", [
  'subscriptionProvider?: "ios-app" | "web"',
  "Brisanje računa ne prekliče App Store naročnine.",
  "Naročnino upravljaš v nastavitvah App Store.",
]);

requireIncludes("src/lib/auth-providers.ts", [
  "getIosAppReviewSafeAuthProviders",
  "providers.google || providers.apple || providers.email",
]);

requireIncludes("src/components/auth-page-shell.tsx", [
  "isMemoIosAppUserAgent",
  "getIosAppReviewSafeAuthProviders",
  "PUBLIC_PRIVACY_POLICY_PATH",
  "PUBLIC_TERMS_OF_USE_PATH",
]);

requireIncludes("src/app/auth/continue/page.tsx", [
  "isMemoIosAppUserAgent",
  "getIosAppReviewSafeAuthProviders",
  "PUBLIC_PRIVACY_POLICY_PATH",
  "PUBLIC_TERMS_OF_USE_PATH",
]);

requireIncludes("src/app/auth/google/route.ts", [
  "isMemoIosAppUserAgent",
  "getIosAppReviewSafeAuthProviders",
  "Google prijava v iOS aplikaciji ni na voljo brez e-poštne ali Apple prijave.",
]);

requireIncludes("src/app/support/page.tsx", [
  "SUPPORT_EMAIL",
  "PUBLIC_PRIVACY_POLICY_PATH",
  "PUBLIC_TERMS_OF_USE_PATH",
]);
requireExcludes("src/app/support/page.tsx", [
  "Stripe",
  "Checkout",
  "promocijsko",
  "darilno",
]);

requireIncludes("src/lib/help-center.ts", [
  "hiddenInIosApp",
  "contact-support",
  "getVisibleHelpArticles",
  "getHelpSections",
]);

requireIncludes("src/app/app/support/page.tsx", [
  "getHelpSections",
  "isMemoIosAppUserAgent",
]);

requireIncludes("src/app/app/support/[slug]/page.tsx", [
  "getHelpArticle(slug",
  "isMemoIosAppUserAgent",
]);

requireIncludes("src/app/api/billing/apple/transactions/route.ts", [
  "syncAppStoreTransactionEntitlement",
  "verifyAppStoreTransaction",
  "transaction.appAccountToken !== appState.user.id",
]);

requireIncludes("src/app/api/billing/checkout/route.ts", [
  "isMemoIosAppUserAgent",
  "Stripe Checkout ni na voljo v iOS aplikaciji",
]);

requireIncludes("src/app/api/billing/portal/route.ts", [
  "isMemoIosAppUserAgent",
  "Stripe portal ni na voljo v iOS aplikaciji",
]);

requireIncludes("src/app/api/billing/apple/notifications/route.ts", [
  "verifyAppStoreNotification",
  "syncAppStoreTransactionEntitlement",
  "processedTransaction",
]);

requireIncludes("src/lib/apple-app-store.ts", [
  "verifyAppStoreNotification",
  "syncAppStoreTransactionEntitlement",
  "appAccountToken",
  'stripe_subscription_id: subscriptionId',
]);

requireIncludes("src/app/api/account/delete/route.ts", [
  "collectLectureStorageObjectPaths",
  "removeAccountResidualDatabaseRows",
  "removeLectureStorageObjects",
  "auth.admin.deleteUser",
]);

requireIncludes("src/lib/account-data-cleanup.ts", [
  "ai_usage_events",
  "api_rate_limits",
  "email_auth_requests",
  "lecture_note_media",
  "lecture_tts_chunks",
  "removeAccountResidualDatabaseRows",
  "parseAudioChunkManifest",
  "extractScanImageStoragePaths",
  "service.storage.from(STORAGE_BUCKET).remove",
]);

requireIncludes(".env.production.example", [
  "APPLE_APP_STORE_ENVIRONMENT=production",
  "APPLE_BUNDLE_ID=eu.memoai.app",
  "APPLE_ROOT_CERTIFICATES_BASE64=",
  "APPLE_IAP_MONTHLY_PRODUCT_ID=eu.memoai.pro.monthly",
  "APPLE_IAP_YEARLY_PRODUCT_ID=eu.memoai.pro.yearly",
]);

for (const file of walkFiles(iosRoot)) {
  const relativePath = relative(repoRoot, file);

  if (/\.(png|jpg|jpeg|ico|wasm)$/i.test(file)) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  addCheck(
    `${relativePath} excludes deprecated Vercel production domain`,
    !content.includes(deprecatedVercelDomain),
  );
}

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  const prefix = check.pass ? "ok" : "fail";
  const detail = check.detail ? ` (${check.detail})` : "";
  console.log(`${prefix} - ${check.name}${detail}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} iOS readiness check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} iOS readiness checks passed.`);
