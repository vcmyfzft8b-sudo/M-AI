# Memo AI iOS Web Wrapper

This is a separate iOS app that embeds the production Memo AI mobile web app in `WKWebView`. It intentionally does not share code or targets with the native Swift rewrite under `ios/Memo`.

## Architecture

- `https://memoai.eu` is the single centrally configured start URL.
- Persistent WebKit storage keeps login sessions and web preferences across launches.
- The wrapper grants microphone/camera web permissions only to Memo AI production hosts.
- Native WebKit file inputs provide camera, photo-library, and Files pickers.
- Downloads are handed to the iOS share sheet.
- Memo AI and authentication-provider navigation stays in the same cookie session.
- User-opened third-party links and system schemes open in the appropriate iOS app.
- Pull to refresh, swipe-back navigation, loading progress, and retry UI are included.

Because the UI and application logic come directly from the production website, web feature releases appear in this app without an iOS code release.

## Open and run

1. Open `MemoWeb.xcodeproj` in Xcode.
2. Select the `MemoWeb` scheme and an iPhone simulator or device.
3. Choose your Apple Development team for device or archive builds.
4. Build and run.

The default bundle identifier is `eu.memoai.web`. Change it in the target settings if a different App Store Connect identifier is required.

## Verification

```sh
xcodebuild \
  -project MemoWeb.xcodeproj \
  -scheme MemoWeb \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

The unit tests validate URL/session routing rules. The UI smoke test loads the live production site and follows its sign-in flow.

## App Store note

Apple may reject apps that are only repackaged websites under App Review Guideline 4.2. This project deliberately remains a web wrapper as requested; review metadata should clearly explain the value of the recording, document-upload, study, and accessibility workflows.
