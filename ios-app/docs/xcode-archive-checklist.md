# Xcode Archive Checklist

Use this checklist after the source checks pass and before uploading a TestFlight or App Store build.

## Local Xcode setup

1. Install the current stable Xcode from the Mac App Store or Apple Developer.
2. Select the full Xcode toolchain:

   ```sh
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -version
   ```

3. Install the matching iOS platform/runtime in Xcode:

   - Open Xcode > Settings > Components.
   - Install the iOS platform shown for your Xcode version, for example iOS 26.5 for Xcode 26.5.
   - Keep enough free disk space for the download and expanded runtime. The download alone can be larger than 8 GB.
   - Command-line fallback:

     ```sh
     xcodebuild -downloadPlatform iOS
     xcrun simctl list runtimes
     ```

4. Install iOS wrapper dependencies and sync Capacitor:

   ```sh
   npm install --prefix ios-app
   npm run --prefix ios-app sync
   npm run ios:verify
   ```

5. Confirm the shared Xcode scheme is visible:

   ```sh
   xcodebuild -list -project ios-app/ios/App/App.xcodeproj
   ```

## App Store Connect setup

1. Create or confirm the app record for bundle ID `eu.memoai.app`.
2. Create these auto-renewable subscriptions:
   - `eu.memoai.pro.monthly`
   - `eu.memoai.pro.yearly`
3. Configure App Store Server Notifications v2:
   - Production URL: `https://memoai.eu/api/billing/apple/notifications`
4. Configure App Information URLs:
   - Support URL: `https://memoai.eu/support`
   - Privacy Policy URL: `https://memoai.eu/legal/privacy`
5. Confirm production environment variables on the web deployment:
   - `APPLE_APP_STORE_ENVIRONMENT=production`
   - `APPLE_BUNDLE_ID=eu.memoai.app`
   - `APPLE_APP_APPLE_ID=<App Store app Apple ID>`
   - `APPLE_ROOT_CERTIFICATES_BASE64=<comma-separated base64 Apple root certificates>`
   - `APPLE_IAP_MONTHLY_PRODUCT_ID=eu.memoai.pro.monthly`
   - `APPLE_IAP_YEARLY_PRODUCT_ID=eu.memoai.pro.yearly`

## Xcode project setup

1. Open `ios-app/ios/App/App.xcodeproj`.
2. Set the Apple Developer Team.
3. Confirm bundle identifier `eu.memoai.app`.
4. Confirm signing uses the production team profile.
5. Confirm the In-App Purchase capability is enabled.
6. Confirm supported device families, deployment target, icon, launch screen, and privacy manifest.
7. Optional local StoreKit testing setup before sandbox/TestFlight:
   - In Xcode, choose File > New > File, search for `StoreKit Configuration File`, and save it in `ios-app/ios/App/App`.
   - Add one auto-renewable subscription group for Memo Pro.
   - Add product `eu.memoai.pro.monthly` with a one-month duration.
   - Add product `eu.memoai.pro.yearly` with a one-year duration.
   - Add localizations and prices that match the App Store Connect products as closely as possible.
   - In Product > Scheme > Edit Scheme > Run > Options, select that StoreKit configuration file.
   - Do not use local StoreKit testing as the final proof; still test App Store sandbox and TestFlight.
8. Build and run on a real iPhone.
9. Test:
   - Email or Apple login and onboarding.
   - Google login only if email or Apple login is also enabled for the submitted iOS build.
   - Monthly and yearly StoreKit local purchases if a local StoreKit file is configured.
   - Monthly and yearly App Store sandbox purchases.
   - Restore purchases.
   - Subscription management link from settings.
   - Account deletion from settings.
   - Camera, microphone, photo, and document permission prompts only when those features are used.

## Archive and upload

1. Select `Any iOS Device (arm64)`.
2. Run Product > Archive.
   The equivalent command-line archive target is:

   ```sh
   xcodebuild \
     -project ios-app/ios/App/App.xcodeproj \
     -scheme App \
     -configuration Release \
     -destination "generic/platform=iOS" \
     archive
   ```

3. Validate the archive in Organizer.
4. Upload to App Store Connect.
5. Test with TestFlight before submitting to App Review.

## App Review notes

Provide reviewer credentials and reference `docs/app-review-notes.md`. Confirm the App Store Connect privacy labels match `ios/App/App/PrivacyInfo.xcprivacy` and `docs/privacy-label-draft.md`.
