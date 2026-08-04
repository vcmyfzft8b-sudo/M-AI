# App Store submission checklist

The wrapper is configured as a companion app for existing Memo AI accounts. It does not display Stripe checkout, web subscription management, or purchase calls to action. Users with active access receive the same production web features; users without access can sign out or permanently delete their account.

## Implemented in code

- Launches at the sign-in gateway instead of the marketing landing page.
- Keeps signed-in sessions in persistent WebKit storage.
- Hides Google sign-in in the iOS wrapper until Sign in with Apple is enabled.
- Blocks Stripe checkout and billing-portal APIs for the iOS wrapper user agent.
- Includes in-app account deletion, including uploaded-file cleanup and cancellation of active Stripe billing.
- Includes privacy and terms links in Settings.
- Declares camera, microphone, and photo-library purpose strings.
- Includes a privacy manifest for account, user-content, audio, photo/video, purchase, and crash data.
- Uses HTTPS only and opens unrelated external links outside the embedded session.

## Required before uploading a build

- Register `eu.memoai.web` (or update the target to the final registered identifier), select the Apple Developer team, and create the App Store Connect app record.
- Enable Sign in with Apple in the production Supabase project before enabling Google inside iOS. Until then, the wrapper automatically offers email sign-in only.
- Keep `https://memoai.eu/app/support/privacy-policy` and `https://memoai.eu/app/support/terms-of-use` publicly available and enter the privacy-policy URL in App Store Connect.
- Add a real support URL, screenshots for every required device size, app description, keywords, age rating, content-rights answers, and review contact details.
- Complete App Privacy answers so they match `PrivacyInfo.xcprivacy` and all production SDK/server collection.
- Give App Review a fully featured paid demo account and explain that this is a companion client with no purchasing or purchase links inside the app.
- Test camera, microphone, Files, Photos, downloads, OAuth/email login, account deletion, and every note/study workflow against the production backend on a physical device.
- Archive with the distribution certificate, run Xcode Validate App, upload, resolve all App Store Connect warnings, and submit for review.

## Review risk

App Review approval cannot be guaranteed. A `WKWebView` wrapper remains subject to the minimum-functionality rule. Review notes and screenshots should emphasize the app's recording, camera/document import, generated study tools, and mobile workflows rather than describing it as a website wrapper.
