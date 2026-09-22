import XCTest

final class WrapperTests: XCTestCase {
    /// Walk the same anonymous onboarding as a fresh PWA install before login.
    /// The working-adult route avoids school-only questions; demo steps keep
    /// their ordinary Continue action instead of bypassing the survey cookie.
    @MainActor private func completeAnonymousOnboarding(_ app: XCUIApplication) {
        let start = app.webViews.buttons["Get started"].firstMatch
        guard start.waitForExistence(timeout: 10) || app.webViews.otherElements["Setup progress"].firstMatch.exists else { return }
        let choices = ["Instagram Reels", "For me", "Working", "Learn 10× faster", "Audio notes", "No, just help me in general", "Casual — 10 min / day"]
        let deadline = Date().addingTimeInterval(180)
        var capturedWaitingState = false
        while Date() < deadline {
            if app.webViews.buttons["Continue with email"].firstMatch.exists { return }
            XCTAssertFalse(app.webViews.staticTexts["Your answers could not be saved."].firstMatch.exists,
                           "Anonymous onboarding must save successfully before sign-in")
            let cta = ["Get started", "Make my first note", "Continue"].map {
                app.webViews.buttons.matching(NSPredicate(format: "label == %@", $0)).firstMatch
            }
            // WebKit exposes aria-pressed options as switches, not buttons.
            let options = choices.map {
                app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", $0)).firstMatch
            }
            let action = (cta + options).first { $0.exists && $0.isEnabled && $0.isHittable }
            if let action {
                let shot = XCTAttachment(screenshot: app.screenshot())
                shot.name = "PWA onboarding — \(action.label)"
                shot.lifetime = .keepAlways
                add(shot)
                action.tap()
            }
            else if !capturedWaitingState {
                let hierarchy = XCTAttachment(string: app.debugDescription)
                hierarchy.name = "Onboarding waiting state"
                hierarchy.lifetime = .keepAlways
                add(hierarchy)
                capturedWaitingState = true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
        XCTFail("Anonymous onboarding must finish at sign-in")
    }

    @MainActor private func dismissInitialOffer(_ app: XCUIApplication) {
        let close = app.webViews.buttons.matching(NSPredicate(
            format: "label == %@ OR label == %@", "Close the subscription offer", "Zapri ponudbo naročnine")).firstMatch
        if close.waitForExistence(timeout: 8) {
            for _ in 0..<4 where close.exists {
                close.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(2))
            }
        }
    }

    // Opt-in account switch for the dedicated staging simulator. This signs in
    // through the real email-code flow; it does not fabricate an entitlement.
    @MainActor func testPreviewPrepareStudyAccount() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], let code = env["MEMO_QA_CODE"] else {
            throw XCTSkip("Requires a staging Preview and its synthetic review account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        if settings.waitForExistence(timeout: 15) {
            settings.tap()
            let signOut = app.webViews.buttons["Sign out"].firstMatch
            XCTAssertTrue(signOut.waitForExistence(timeout: 15))
            for _ in 0..<5 where !signOut.isHittable { app.webViews.firstMatch.swipeUp() }
            signOut.tap()
            XCTAssertTrue(app.webViews.staticTexts["Sign out?"].waitForExistence(timeout: 10))
            let signOutButtons = app.webViews.buttons.matching(identifier: "Sign out")
            signOutButtons.element(boundBy: signOutButtons.count - 1).tap()
        }
        completeAnonymousOnboarding(app)
        XCTAssertTrue(app.webViews.buttons["Continue with Google"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.buttons["Continue with Apple"].firstMatch.exists)
        XCTAssertTrue(signInWithCode(app, email: email, code: code), "The staging review account must sign in")
        dismissInitialOffer(app)
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch.waitForExistence(timeout: 30))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Staging study account signed in"
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// A signed-in synthetic account that withdrew AI permission meets the
    /// consent gate at launch; allow it again (retrying until React hydrates).
    @MainActor private func passConsentGate(_ app: XCUIApplication) {
        let allow = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Allow AI processing", "Dovoli obdelavo")).firstMatch
        let home = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
        // Wait for whichever page follows the launch cover: home, or the gate.
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline, !allow.exists, !home.exists,
              !app.webViews.otherElements["Setup progress"].firstMatch.exists,
              !app.webViews.buttons["Continue with email"].firstMatch.exists {
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        guard allow.exists else { return }
        for _ in 0..<4 where allow.exists {
            allow.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(6))
        }
    }

    /// Signs in with the fixed review code, when the app is showing sign-in.
    ///
    /// The code stands in for a mailed one for the accounts named in the
    /// Preview's `APP_REVIEW_ACCOUNT_EMAILS`; there is no password screen.
    /// Returns false when the app was already signed in.
    @MainActor @discardableResult
    private func signInWithCode(_ app: XCUIApplication, email: String, code: String) -> Bool {
        func either(_ english: String, _ slovenian: String) -> NSPredicate {
            NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", english, slovenian)
        }
        let emailButton = app.webViews.buttons.matching(either("Continue with email", "Nadaljuj z e-po")).firstMatch
        guard emailButton.waitForExistence(timeout: 60) else { return false }

        let emailField = app.webViews.textFields.firstMatch
        // Server-rendered buttons do nothing until React has hydrated.
        for _ in 0..<4 where !emailField.exists {
            emailButton.tap()
            _ = emailField.waitForExistence(timeout: 6)
        }
        emailField.tap()
        emailField.typeText(email)

        // Waiting on "a text field" is not waiting for the next page: the email
        // field is still on screen, so the code would be typed into that one.
        // The heading is what actually changes.
        let codeHeading = app.webViews.staticTexts.matching(either("Enter the code", "Vnesi kodo")).firstMatch
        let send = app.webViews.buttons.matching(either("Continue", "Nadaljuj")).firstMatch
        for _ in 0..<4 where !codeHeading.exists {
            if send.exists { send.tap() }
            _ = codeHeading.waitForExistence(timeout: 20)
        }
        XCTAssertTrue(codeHeading.exists, "Sending the code must open the code entry page")

        let codeField = app.webViews.textFields.firstMatch
        codeField.tap()
        codeField.typeText(code)
        for _ in 0..<4 where codeHeading.exists {
            if send.exists { send.tap() }
            RunLoop.current.run(until: Date().addingTimeInterval(6))
        }
        XCTAssertFalse(codeHeading.exists, "The review code must be accepted")

        let allow = app.webViews.buttons.matching(either("Allow AI processing", "Dovoli obdelavo")).firstMatch
        if allow.waitForExistence(timeout: 30) {
            for _ in 0..<4 where allow.exists {
                allow.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(6))
            }
        }
        return true
    }

    /// Scrolls the note's horizontal tab strip: swipe on a chip that sits well
    /// inside the screen (a clipped one has no visible frame), or drag along
    /// the row when none does.
    @MainActor private func scrollStrip(_ app: XCUIApplication, tabNames: [String], rowY: CGFloat, left: Bool) {
        // Chips near the strip's faded edges report an empty visible frame even
        // when hittable, so always drag along the row instead of swiping a chip.
        let window = app.windows.firstMatch.frame
        let y = rowY / window.height
        // Start well inside the screen: a drag from the left edge is the back gesture.
        let from = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.85 : 0.3, dy: y))
        let to = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.3 : 0.85, dy: y))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0.05)
    }
    // Real study flow on a staging Preview: a synthetic lesson photo becomes a
    // note, then flashcards, a quiz and a mindmap are generated, the mindmap is
    // shared through the native sheet, chat and read-aloud run, and the note is
    // deleted. Seed the photo first: xcrun simctl addmedia <udid> ios/build/synthetic-plant-lesson.png
    @MainActor func testPreviewCreateStudyNoteFromPhoto() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview, synthetic account and seeded lesson photo")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        continueAfterFailure = false
        func snap(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        func contains(_ text: String) -> NSPredicate { NSPredicate(format: "label CONTAINS %@", text) }
        func webButton(_ text: String) -> XCUIElement { app.webViews.buttons.matching(contains(text)).firstMatch }
        func webText(_ text: String) -> XCUIElement { app.webViews.staticTexts.matching(contains(text)).firstMatch }
        let tabNames = ["Notes", "Tutor", "Flashcards", "Podcast", "Quiz", "Mindmap", "Palace", "Test", "Speed reader", "Transcript"]
        /// The tab strip is a horizontally scrolling chip row: drag it from a
        /// visible chip until the wanted chip is on screen.
        func tapTab(_ name: String) {
            let tab = app.webViews.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 15), "\(name) tab must exist")
            let width = app.windows.firstMatch.frame.width
            func onScreen() -> Bool { tab.frame.minX >= 0 && tab.frame.maxX <= width && tab.isHittable }
            for _ in 0..<6 where !onScreen() {
                scrollStrip(app, tabNames: tabNames, rowY: tab.frame.midY, left: tab.frame.midX > width)
                RunLoop.current.run(until: Date().addingTimeInterval(1))
            }
            XCTAssertTrue(onScreen(), "\(name) tab must be reachable")
            tab.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        /// Wait until any element of `ready` appears; fail early if `failure` shows or after `timeout`.
        func waitForGeneration(_ ready: [XCUIElement], failure: XCUIElement, timeout: TimeInterval, step: String) {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if ready.contains(where: { $0.exists }) { return }
                XCTAssertFalse(failure.exists, "\(step) reported a failure")
                RunLoop.current.run(until: Date().addingTimeInterval(5))
            }
            XCTFail("\(step) did not finish within \(Int(timeout))s")
        }

        // 1. Home → New note → document/photo source → Photo Library.
        // A rerun after the free note was spent reopens the note it created.
        let newNote = webButton("New note")
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        let existing = app.webViews.descendants(matching: .any).matching(contains("Plant Life Cycle")).firstMatch
        if existing.waitForExistence(timeout: 5) {
            existing.tap()
        } else {
        newNote.tap()
        let documents = webButton("PDF, document or photo")
        XCTAssertTrue(documents.waitForExistence(timeout: 15), "The synthetic account must have its unused free note")
        documents.tap()
        let choose = webButton("Choose a file")
        XCTAssertTrue(choose.waitForExistence(timeout: 15))
        choose.tap()
        XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 10))
        app.buttons["Photo Library"].tap()
        // PHPicker runs out of process; its grid still appears in the app's tree.
        let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH %@", "Photo, September 16")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 20), "Seed the simulator library with ios/build/synthetic-plant-lesson.png")
        // The picker's remote view reports its cells as not hittable; a
        // coordinate tap still lands on the cell.
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let done = app.buttons["Done"]
        if done.waitForExistence(timeout: 5), done.isEnabled { done.tap() }
        let create = webButton("Create the note")
        XCTAssertTrue(create.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: create)
        waitForExpectations(timeout: 90)
        snap("01 Photo attached")
        create.tap()
        }

        // 2. Processing → ready. The workspace polls the lecture until the notes exist.
        let flashcardsTab = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Flashcards")).firstMatch
        XCTAssertTrue(flashcardsTab.waitForExistence(timeout: 120), "The note workspace must open after upload")
        snap("02 Processing")
        let failed = webText("Processing failed")
        let notesReady = { () -> Bool in
            let stages = ["being processed", "Reading the photos", "Writing the notes", "Preparing the notes",
                          "Marking the important", "Getting ready to process", "Uploading the material", "Adding images"]
            return !stages.contains { webText($0).exists }
        }
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline, !notesReady() {
            XCTAssertFalse(failed.exists, "Note generation failed")
            RunLoop.current.run(until: Date().addingTimeInterval(10))
        }
        XCTAssertTrue(notesReady(), "Notes did not finish within 10 minutes")
        snap("03 Generated note")

        // 3. Flashcards.
        tapTab("Flashcards")
        let createCards = webButton("Create flashcards")
        if createCards.waitForExistence(timeout: 20) { createCards.tap() }
        let anyCard = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Card ")).firstMatch
        waitForGeneration([anyCard, webText("Every card is done")], failure: webText("could not be created"), timeout: 300, step: "Flashcards")
        snap("04 Flashcards")
        let knew = webButton("Knew it")
        if knew.waitForExistence(timeout: 5) { knew.tap() }

        // 4. Quiz.
        tapTab("Quiz")
        let createQuiz = webButton("Create a quiz")
        if createQuiz.waitForExistence(timeout: 20) { createQuiz.tap() }
        waitForGeneration([webText("Question 1"), webText("Choose one answer")], failure: webText("could not be created"), timeout: 300, step: "Quiz")
        snap("05 Quiz")

        // 5. Mindmap, then export through the native share sheet.
        tapTab("Mindmap")
        let createMap = webButton("Create a mindmap")
        if createMap.waitForExistence(timeout: 20) { createMap.tap() }
        let saveImage = webButton("Save as image")
        waitForGeneration([saveImage, app.webViews.otherElements["Mindmap of this note"]], failure: webText("could not be drawn"), timeout: 300, step: "Mindmap")
        snap("06 Mindmap")
        XCTAssertTrue(saveImage.waitForExistence(timeout: 15))
        saveImage.tap()
        // The image share sheet lists Copy and Save Image up front; Save to
        // Files sits under More. The sheet itself is the evidence.
        let shareSheet = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "ActivityListView")).firstMatch
        XCTAssertTrue(shareSheet.waitForExistence(timeout: 20), "Mindmap export must open the native share sheet")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["Save Image", "Copy", "Save to Files"])).firstMatch.waitForExistence(timeout: 5))
        snap("07 Mindmap share sheet")
        let closeShare = app.buttons["Close"].firstMatch
        if closeShare.waitForExistence(timeout: 3) { closeShare.tap() } else { app.swipeDown() }
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: shareSheet)
        waitForExpectations(timeout: 10)

        // 6. Chat about the note.
        tapTab("Notes")
        let openChat = app.webViews.descendants(matching: .any).matching(contains("Chat about this note")).firstMatch
        XCTAssertTrue(openChat.waitForExistence(timeout: 15))
        openChat.tap()
        let suggestion = webButton("Summarise the lecture")
        if suggestion.waitForExistence(timeout: 10) {
            suggestion.tap()
        } else {
            let field = app.webViews.textViews.firstMatch.exists ? app.webViews.textViews.firstMatch : app.webViews.textFields.firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 10), "Chat input must open")
            field.tap()
            field.typeText("What is germination?")
            let send = webButton("Send message")
            XCTAssertTrue(send.waitForExistence(timeout: 5))
            send.tap()
        }
        let typing = webText("Memo AI is typing")
        _ = typing.waitForExistence(timeout: 15)
        let answered = NSPredicate(format: "exists == false")
        expectation(for: answered, evaluatedWith: typing)
        waitForExpectations(timeout: 180)
        XCTAssertFalse(webText("could not be generated").exists, "Chat answer failed")
        snap("08 Chat answer")
        let closeChat = webButton("Close chat")
        if closeChat.waitForExistence(timeout: 5) { closeChat.tap() }

        // 7. Read aloud starts playing inside WKWebView.
        let listen = webButton("Listen")
        for _ in 0..<4 where !(listen.exists && listen.isHittable) { app.webViews.firstMatch.swipeDown() }
        XCTAssertTrue(listen.waitForExistence(timeout: 15))
        listen.tap()
        let pause = webButton("Pause")
        XCTAssertTrue(pause.waitForExistence(timeout: 120), "Read-aloud must start playing")
        snap("09 Read aloud playing")
        pause.tap()
        let closeReader = webButton("Close the reader")
        if closeReader.waitForExistence(timeout: 5) { closeReader.tap() }

        // 8. Delete the note from the actions sheet and land on an empty home.
        let actions = app.webViews.buttons["Actions"]
        XCTAssertTrue(actions.waitForExistence(timeout: 15))
        actions.tap()
        let delete = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Delete")).firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 10))
        delete.tap()
        let confirm = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Delete note")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        snap("10 Delete confirmation")
        confirm.tap()
        XCTAssertTrue(newNote.waitForExistence(timeout: 60), "Deleting the note must return home")
        snap("11 Home after deletion")
    }

    // Loads real App Store products with no StoreKit fixture. This deliberately
    // stops before checkout; a displayed button is not a verified purchase.
    @MainActor func testPreviewRealSubscriptionCatalogue() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and signed-in synthetic account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        let close = app.webViews.buttons["Close the subscription offer"].firstMatch
        if !close.waitForExistence(timeout: 30) {
            let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 20))
            settings.tap()
            let choose = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Choose a plan")).firstMatch
            XCTAssertTrue(choose.waitForExistence(timeout: 15))
            for _ in 0..<5 where !choose.isHittable { app.webViews.firstMatch.swipeUp() }
            choose.tap()
        }
        // Eligible accounts show the trial CTA after the native catalogue loads.
        let payment = app.webViews.buttons.matching(NSPredicate(
            format: "label IN %@", ["Continue to payment", "Start the 3-day free trial"]
        )).firstMatch
        let ready = NSPredicate { _, _ in payment.exists && payment.isEnabled }
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 60)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Real StoreKit subscription catalogue"
        shot.lifetime = .keepAlways
        add(shot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "StoreKit paywall accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        XCTAssertEqual(result, .completed, "Real StoreKit prices must load before checkout is enabled")
        if close.exists { close.tap() }
    }

    // Real storefront prices must reach the wheel and both discounted plans.
    // This consumes only the synthetic account's daily spin, never a purchase.
    @MainActor func testPreviewWheelShowsRealHalfOffPrices() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and eligible synthetic account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        dismissInitialOffer(app)
        let promo = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "You got a discount!")).firstMatch
        XCTAssertTrue(promo.waitForExistence(timeout: 30))
        promo.tap()
        let claim = app.webViews.buttons["Claim the discount"].firstMatch
        let spin = app.webViews.buttons["Spin the wheel"].firstMatch
        if spin.waitForExistence(timeout: 10), spin.isEnabled { spin.tap() }
        XCTAssertTrue(claim.waitForExistence(timeout: 30))
        func snap(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        snap("Wheel with real Apple introductory prices")
        claim.tap()
        let yearly = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "64.99", "129.99")).firstMatch
        let monthly = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "9.99", "19.99")).firstMatch
        XCTAssertTrue(yearly.waitForExistence(timeout: 20), "US Sandbox yearly offer must show 64.99 then 129.99")
        XCTAssertTrue(monthly.exists, "US Sandbox monthly offer must show 9.99 then 19.99")
        yearly.tap()
        snap("Apple yearly half-off offer")
        monthly.tap()
        snap("Apple monthly half-off offer")
        XCTAssertTrue(app.webViews.buttons["Continue"].firstMatch.isEnabled)
        app.webViews.buttons["Close the offer"].firstMatch.tap()
    }

    // Visual review of the edge-to-edge layout on a staging Preview with a
    // signed-in synthetic account: home, the new-note sheet, a note with its
    // chat and actions sheets, and settings. Screenshots are the evidence.
    @MainActor func testPreviewSafeAreaReview() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and a signed-in synthetic account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        continueAfterFailure = false
        func snap(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        func contains(_ text: String) -> NSPredicate { NSPredicate(format: "label CONTAINS %@", text) }
        func webButton(_ text: String) -> XCUIElement { app.webViews.buttons.matching(contains(text)).firstMatch }
        let newNote = webButton("New note")
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        snap("R1 Home")
        newNote.tap()
        let cancel = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        if cancel.waitForExistence(timeout: 10) {
            snap("R2 New note sheet")
            cancel.tap()
        } else {
            snap("R2 New note (paywall)")
            let close = webButton("Close the subscription offer")
            XCTAssertTrue(close.waitForExistence(timeout: 10))
            close.tap()
            XCTAssertTrue(newNote.waitForExistence(timeout: 20), "Closing the offer must return home")
        }
        let existing = app.webViews.descendants(matching: .any).matching(contains("Plant Life Cycle")).firstMatch
        if existing.waitForExistence(timeout: 10) {
            existing.tap()
            let flashcards = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Flashcards")).firstMatch
            XCTAssertTrue(flashcards.waitForExistence(timeout: 30))
            snap("R3 Note")
            let openChat = app.webViews.descendants(matching: .any).matching(contains("Chat about this note")).firstMatch
            if openChat.waitForExistence(timeout: 10) {
                openChat.tap()
                _ = app.webViews.staticTexts.matching(contains("Ask me anything")).firstMatch.waitForExistence(timeout: 10)
                snap("R4 Chat sheet")
                let closeChat = webButton("Close chat")
                if closeChat.waitForExistence(timeout: 5) { closeChat.tap() }
            }
            let actions = app.webViews.buttons["Actions"]
            if actions.waitForExistence(timeout: 10) {
                actions.tap()
                _ = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Delete")).firstMatch.waitForExistence(timeout: 5)
                snap("R5 Actions sheet")
                let dismiss = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
                if dismiss.waitForExistence(timeout: 5) { dismiss.tap() }
            }
            flashcards.tap()
            _ = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Card ")).firstMatch.waitForExistence(timeout: 15)
            snap("R6 Flashcards")
            let back = app.webViews.buttons["Back"]
            if back.waitForExistence(timeout: 5) { back.tap() }
        }
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        settings.tap()
        XCTAssertTrue(app.webViews.switches["Dark"].waitForExistence(timeout: 15))
        snap("R7 Settings")
    }

    // Signed-out review on a fresh simulator: the sign-in screen must offer
    // Apple, Google and email with no back arrow, and the e-mail code login
    // must reach the AI-consent gate. The account comes from MEMO_QA_EMAIL and
    // its fixed review code from MEMO_QA_CODE (the Preview's
    // APP_REVIEW_LOGIN_CODE for that account); there is no password screen.
    @MainActor func testPreviewSignInScreenAndCodeLogin() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], let code = env["MEMO_QA_CODE"] else {
            throw XCTSkip("Requires a staging Preview and a synthetic review account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        continueAfterFailure = false
        func snap(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        func contains(_ text: String) -> NSPredicate { NSPredicate(format: "label CONTAINS %@", text) }
        // The first page follows the IP country (Slovenian here), so match both catalogues.
        func either(_ english: String, _ slovenian: String) -> NSPredicate {
            NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", english, slovenian)
        }
        let emailButton = app.webViews.buttons.matching(either("Continue with email", "Nadaljuj z e-po")).firstMatch
        if !emailButton.waitForExistence(timeout: 60), app.buttons["retry"].exists {
            app.buttons["retry"].tap()
            _ = emailButton.waitForExistence(timeout: 60)
        }
        XCTAssertTrue(emailButton.exists, "Sign-in must load on a clean simulator")
        snap("S1 Sign in")
        XCTAssertFalse(app.webViews.links.matching(either("Back", "Nazaj")).firstMatch.exists, "The app has no landing page to go back to")
        XCTAssertTrue(app.webViews.buttons.matching(contains("Google")).firstMatch.exists)
        XCTAssertTrue(app.webViews.buttons.matching(contains("Apple")).firstMatch.exists,
                      "Sign in with Apple must accompany Google (App Review 4.8)")
        let emailField = app.webViews.textFields.firstMatch
        // The button works only once React has hydrated; retry a few times.
        for _ in 0..<4 where !emailField.exists {
            emailButton.tap()
            _ = emailField.waitForExistence(timeout: 6)
        }
        XCTAssertTrue(emailField.exists, "Continue with email must open the email entry page")
        XCTAssertFalse(app.webViews.links.matching(either("Sign in with a password", "Prijava z geslom")).firstMatch.exists,
                       "Sign-in is by e-mail code only, as on the web")
        XCTAssertFalse(app.webViews.images.matching(contains("Memo")).firstMatch.exists, "The auth header carries no brand logo")
        snap("S2 Email entry")
        emailField.tap()
        emailField.typeText(email)
        let send = app.webViews.buttons.matching(either("Continue", "Nadaljuj")).firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()
        let codeField = app.webViews.textFields.firstMatch
        XCTAssertTrue(codeField.waitForExistence(timeout: 20), "Sending the code must open the code entry page")
        snap("S3 Code entry")
        codeField.tap()
        codeField.typeText(code)
        let submit = app.webViews.buttons.matching(either("Continue", "Nadaljuj")).firstMatch
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        submit.tap()
        // A first sign-in meets the AI-consent gate; an account that already
        // consented goes straight on.
        let allow = app.webViews.buttons.matching(either("Allow AI processing", "Dovoli obdelavo")).firstMatch
        if allow.waitForExistence(timeout: 30) {
            snap("S4 AI consent")
            // The server-rendered button only works once React has hydrated.
            for _ in 0..<4 where allow.exists {
                allow.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(6))
            }
            XCTAssertFalse(allow.exists, "Allowing AI processing must leave the consent screen")
        }
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: emailButton)
        waitForExpectations(timeout: 30)
        snap("S5 Signed in")
    }

    // Recording survives the app leaving the screen, on a staging Preview.
    //
    // This is the page's side of the recorder. The native half — that capture
    // keeps running with the phone locked, and that the Lock Screen banner
    // counts up while it does — is not reachable from XCUITest, which can
    // background an app but cannot lock the device.
    //
    // Backgrounding is the same failure the native recorder exists to fix:
    // `MediaRecorder` loses the microphone the moment WebKit suspends the web
    // content process, so before this the clock came back reading whatever it
    // said when the app went away. Nothing is created, so the account keeps its
    // free note. Grant the microphone first:
    // xcrun simctl privacy <udid> grant microphone eu.memoai.memo
    @MainActor func testPreviewRecordingSurvivesTheAppLeavingTheScreen() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], let code = env["MEMO_QA_CODE"] else {
            throw XCTSkip("Requires a staging Preview and a synthetic review account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        signInWithCode(app, email: email, code: code)
        passConsentGate(app)
        continueAfterFailure = false
        func snap(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        // A fresh simulator gets the Slovenian catalogue from its IP country.
        // Case-insensitively: the card's label is drawn uppercase by the
        // stylesheet, and that is the label the accessibility tree reports.
        func either(_ english: String, _ slovenian: String) -> NSPredicate {
            NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", english, slovenian)
        }
        func webButton(_ english: String, _ slovenian: String) -> XCUIElement {
            app.webViews.buttons.matching(either(english, slovenian)).firstMatch
        }

        // A signed-in account that has not subscribed meets the offer sheet on
        // the way in; the free note behind it is what this test records into.
        let closeOffer = webButton("Close the subscription offer", "Zapri ponudbo naročnine")
        if closeOffer.waitForExistence(timeout: 30) {
            for _ in 0..<4 where closeOffer.exists {
                closeOffer.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(4))
            }
        }
        let newNote = webButton("New note", "Nov zapisek")
        if !newNote.waitForExistence(timeout: 60) {
            snap("L0 No way in")
            return XCTFail("Requires a signed-in account with its free note unspent")
        }
        newNote.tap()
        // "New note" opens a picker of sources before the capture sheet itself.
        let recordSource = webButton("Record audio", "Posnemi zvok")
        for _ in 0..<4 where recordSource.waitForExistence(timeout: 10) {
            recordSource.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(3))
        }
        let start = webButton("Start recording", "Začni snemanje")
        if !start.waitForExistence(timeout: 20) {
            snap("L1 No recording control")
            return XCTFail("The capture sheet must offer recording")
        }
        // The app records with the screen off, so the guide that tells learners
        // to use another recorder and upload the file afterwards must not be on
        // this screen. It is still right in a browser, and still shown there.
        XCTAssertFalse(webButton("record with the screen off", "snemaš z ugasnjenim").exists,
                       "The app does not need the record-with-the-screen-off guide")
        snap("L1 Before recording")
        for _ in 0..<4 where start.exists {
            start.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(4))
        }

        /// The clock on the capture screen, as whole seconds.
        func elapsed() -> Int? {
            let clock = app.webViews.staticTexts.matching(
                NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$")).firstMatch
            guard clock.exists else { return nil }
            return clock.label.split(separator: ":").compactMap { Int($0) }.reduce(0) { $0 * 60 + $1 }
        }

        // Recording has started once the clock leaves 0:00 on its own.
        let started = Date()
        while Date().timeIntervalSince(started) < 30, (elapsed() ?? 0) < 2 {
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        guard let before = elapsed(), before >= 2 else {
            snap("L2 Recording did not start")
            return XCTFail("The clock must run once recording starts")
        }
        XCTAssertTrue(webButton("Pause", "Začasno ustavi").exists, "A running recording offers a pause")
        XCTAssertTrue(app.webViews.staticTexts.matching(
            either("you can lock your phone", "telefon lahko ugasneš")).firstMatch.exists,
            "The app's hint says the phone can be locked")
        snap("L2 Recording")

        // Away long enough that a page-side timer would visibly fall behind.
        let away = 15
        XCUIDevice.shared.press(.home)
        RunLoop.current.run(until: Date().addingTimeInterval(TimeInterval(away)))
        app.activate()
        // The page reads the app's own count when it comes back; give it a beat.
        let resumed = Date()
        while Date().timeIntervalSince(resumed) < 20, (elapsed() ?? 0) < before + away {
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        snap("L3 Back from the background")
        guard let after = elapsed() else { return XCTFail("The capture screen must survive the app leaving") }
        XCTAssertGreaterThanOrEqual(after - before, away - 2,
                                    "The clock must count the time the app spent off screen")

        let stop = webButton("Stop and create the note", "Ustavi in ustvari zapisek")
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        // The audio crosses the bridge in slices before the card can name it.
        let ready = app.webViews.staticTexts.matching(either("Recording ready", "Pripravljen posnetek")).firstMatch
        for _ in 0..<3 where !ready.exists {
            if stop.exists, stop.isHittable { stop.tap() }
            _ = ready.waitForExistence(timeout: 30)
        }
        if !ready.exists {
            snap("L4 Stop did not hand back the audio")
            return XCTFail("Stopping must hand the page the finished audio")
        }
        let file = app.webViews.staticTexts.matching(
            NSPredicate(format: "label ENDSWITH %@", ".m4a")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 10),
                      "The audio is the app's own m4a, not a MediaRecorder container")
        snap("L4 Recording ready")

        // Leave the account as it was found: no note, no spent free note.
        let cancel = app.webViews.buttons.matching(
            NSPredicate(format: "label == %@ OR label == %@", "Cancel", "Prekliči")).firstMatch
        if cancel.waitForExistence(timeout: 5) { cancel.tap() }
    }

    // Click-through of every screen on a staging Preview with a signed-in
    // synthetic account. Problems are collected, not fatal, so the run always
    // yields the full set of screenshots to review.
    @MainActor func testPreviewTour() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and a signed-in synthetic account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        continueAfterFailure = true
        var problems: [String] = []
        var shot = 0
        func snap(_ name: String) {
            shot += 1
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = String(format: "T%02d %@", shot, name)
            image.lifetime = .keepAlways
            add(image)
        }
        func contains(_ text: String) -> NSPredicate { NSPredicate(format: "label CONTAINS %@", text) }
        func exact(_ text: String) -> NSPredicate { NSPredicate(format: "label == %@", text) }
        func web(_ type: XCUIElement.ElementType, _ predicate: NSPredicate) -> XCUIElement {
            app.webViews.descendants(matching: type).matching(predicate).firstMatch
        }
        func settle(_ seconds: TimeInterval = 1.5) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
        /// Taps an element if it shows up; records a problem otherwise.
        @discardableResult func tap(_ what: String, _ element: XCUIElement, timeout: TimeInterval = 10, required: Bool = true) -> Bool {
            if element.waitForExistence(timeout: timeout) {
                if !element.isHittable { app.webViews.firstMatch.swipeUp(); settle(0.5) }
                if element.isHittable {
                    element.tap(); settle(); return true
                }
                if required { problems.append("\(what): present but not hittable") }
                return false
            }
            if required { problems.append("\(what): not found") }
            return false
        }
        func scrollTo(_ element: XCUIElement, down: Bool = true) -> Bool {
            for _ in 0..<6 {
                if element.exists && element.isHittable { return true }
                if down { app.webViews.firstMatch.swipeUp() } else { app.webViews.firstMatch.swipeDown() }
                settle(0.4)
            }
            return element.exists && element.isHittable
        }
        /// Leaves the current screen: the app's Back button, an open sheet's
        /// Close button, or the web view's edge-swipe back gesture.
        func back() {
            let button = web(.button, exact("Back"))
            let close = web(.button, exact("Close"))
            if button.exists && button.isHittable { button.tap() }
            else if close.exists && close.isHittable { close.tap() }
            else {
                let from = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
                from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 260, dy: 0)))
            }
            settle()
        }
        let tabNames = ["Notes", "Tutor", "Flashcards", "Podcast", "Quiz", "Mindmap", "Palace", "Test", "Speed read", "Transcript"]
        func tab(_ name: String) -> Bool {
            let chip = web(.button, exact(name))
            guard chip.waitForExistence(timeout: 10) else { problems.append("tab \(name): missing"); return false }
            let width = app.windows.firstMatch.frame.width
            func onScreen() -> Bool { chip.frame.minX >= 0 && chip.frame.maxX <= width && chip.isHittable }
            for _ in 0..<6 where !onScreen() {
                scrollStrip(app, tabNames: tabNames, rowY: chip.frame.midY, left: chip.frame.midX > width)
                settle(0.8)
            }
            guard onScreen() else { problems.append("tab \(name): unreachable"); return false }
            chip.tap(); settle(2); return true
        }

        // ---- Home -----------------------------------------------------------
        let newNote = web(.button, contains("New note"))
        XCTAssertTrue(newNote.waitForExistence(timeout: 30), "Home must load")
        snap("Home")
        let search = app.webViews.textFields.firstMatch
        if search.exists { search.tap(); settle(); snap("Home search keyboard") ; app.webViews.staticTexts["My notes"].tap(); settle() }
        if tap("Discount promo", web(.button, contains("You got a discount")), required: false) {
            snap("Discount wheel")
            tap("Spin", web(.button, contains("Spin the wheel")), timeout: 5, required: false)
            settle(6); snap("Discount wheel result")
            tap("Claim", web(.button, contains("Claim the discount")), timeout: 5, required: false)
            settle(3); snap("After claiming the discount")
            if !tap("Close offer", web(.button, contains("Close the offer")), timeout: 5, required: false) {
                tap("Close offer sheet", web(.button, exact("Close")), timeout: 5, required: false)
            }
            tap("Close offer paywall", web(.button, contains("Close the subscription offer")), timeout: 5, required: false)
            if !newNote.waitForExistence(timeout: 10) { problems.append("Discount flow: could not return home"); snap("Stuck after discount") }
        }
        if tap("Unlock Premium card", web(.button, contains("Unlock Premium")), required: false) {
            snap("Paywall from home")
            tap("Monthly plan", web(.button, contains("Monthly")), timeout: 5, required: false); snap("Paywall monthly selected")
            tap("Close paywall", web(.button, contains("Close the subscription offer")))
            _ = newNote.waitForExistence(timeout: 15)
        }
        if tap("New note", newNote) {
            snap("New note")
            if !tap("Close new-note paywall", web(.button, contains("Close the subscription offer")), timeout: 5, required: false) {
                tap("Cancel new note", web(.button, exact("Cancel")), timeout: 5, required: false)
            }
            _ = newNote.waitForExistence(timeout: 15)
        }

        // ---- Note ----------------------------------------------------------
        if tap("Existing note", web(.any, contains("Plant Life Cycle"))) {
            _ = web(.button, exact("Flashcards")).waitForExistence(timeout: 30)
            snap("Note top")
            app.webViews.firstMatch.swipeUp(); settle(); snap("Note scrolled")
            app.webViews.firstMatch.swipeDown(); settle()
            for name in ["Tutor", "Flashcards", "Podcast", "Quiz", "Mindmap", "Palace", "Test", "Speed read", "Transcript"] where tab(name) {
                snap("Tab \(name)")
            }
            _ = tab("Notes")
            if tap("Actions", app.webViews.buttons["Actions"]) {
                snap("Note actions sheet")
                if tap("Rename", web(.button, exact("Rename")), timeout: 5) {
                    snap("Rename sheet")
                    tap("Cancel rename", web(.button, exact("Cancel")), timeout: 5)
                }
                if tap("Actions again", app.webViews.buttons["Actions"]) && tap("Delete", web(.button, exact("Delete")), timeout: 5) {
                    snap("Delete confirmation")
                    tap("Cancel delete", web(.button, exact("Cancel")), timeout: 5)
                }
            }
            if tap("Chat bar", web(.any, contains("Chat about this note"))) {
                snap("Chat sheet")
                let field = app.webViews.textViews.firstMatch.exists ? app.webViews.textViews.firstMatch : app.webViews.textFields.firstMatch
                if field.waitForExistence(timeout: 5) {
                    field.tap(); settle(); snap("Chat keyboard")
                    // The sheet header must still be reachable with the keyboard up.
                    if !web(.button, contains("Close chat")).exists { problems.append("Chat close button hidden behind the keyboard") }
                    let header = web(.staticText, exact("Chat about this note"))
                    if header.exists { header.tap(); settle() }
                }
                tap("Close chat", web(.button, contains("Close chat")), timeout: 5, required: false)
                if web(.button, contains("Close chat")).exists { app.swipeDown() }
            }
            if tap("Listen", web(.button, exact("Listen"))) {
                if web(.button, exact("Pause")).waitForExistence(timeout: 90) { snap("Read aloud playing"); web(.button, exact("Pause")).tap() }
                else { problems.append("Read aloud did not start"); snap("Read aloud state") }
                tap("Close reader", web(.button, contains("Close the reader")), timeout: 5, required: false)
            }
            back()
        }

        // ---- Settings ------------------------------------------------------
        if tap("Settings", app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch, timeout: 20) {
            _ = app.webViews.switches["Dark"].waitForExistence(timeout: 15)
            snap("Settings top")
            app.webViews.switches["Dark"].tap(); settle(); snap("Settings dark")
            app.webViews.switches["System"].tap(); settle()
            app.webViews.firstMatch.swipeUp(); settle(); snap("Settings middle")
            app.webViews.firstMatch.swipeUp(); settle(); snap("Settings bottom")
            app.webViews.firstMatch.swipeDown(); app.webViews.firstMatch.swipeDown(); settle()
            func row(_ label: String, _ name: String, screenshot: String, then: (@MainActor () -> Void)? = nil) {
                let element = web(.any, contains(label))
                guard scrollTo(element) else { problems.append("settings row \(name): unreachable"); return }
                element.tap(); settle(2); snap(screenshot)
                if let then { then() } else { back() }
                if !app.webViews.switches["Dark"].waitForExistence(timeout: 10) {
                    _ = tap("Settings again", app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch, timeout: 10, required: false)
                    _ = app.webViews.switches["Dark"].waitForExistence(timeout: 10)
                }
            }
            row("Language", "language", screenshot: "Language") {
                // The settings row's subtitle also says "English"; the sheet's option comes last.
                if web(.any, exact("Slovenščina")).waitForExistence(timeout: 5),
                   let option = app.webViews.descendants(matching: .any).matching(exact("English")).allElementsBoundByIndex.last {
                    option.tap(); settle()
                }
            }
            row("Help centre", "help", screenshot: "Help centre") {
                if tap("Refund article", web(.any, contains("Refund policy")), timeout: 5, required: false) { snap("Help article"); back() }
                back()
            }
            row("Redeem a code", "redeem", screenshot: "Redeem a code (Apple help)")
            row("Privacy", "privacy", screenshot: "Privacy policy page")
            row("Suggest a feature", "feature", screenshot: "Suggest a feature")
            row("Choose a plan", "plan", screenshot: "Settings paywall") {
                tap("Close settings paywall", web(.button, contains("Close the subscription offer")), timeout: 5, required: false)
            }
            row("Restore purchases", "restore", screenshot: "Restore purchases") {
                let cancel = app.buttons["Cancel"]
                if cancel.waitForExistence(timeout: 8) { cancel.tap(); settle() }
                snap("After restore")
            }
            row("Manage Apple subscriptions", "manage", screenshot: "Manage Apple subscriptions") {
                let done = app.buttons["Done"]
                if done.waitForExistence(timeout: 8) { done.tap() } else if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() }
                settle()
            }
            row("Withdraw AI permission", "withdraw", screenshot: "Withdraw AI permission") {
                tap("Cancel withdraw", web(.button, exact("Cancel")), timeout: 5, required: false)
            }
            row("Delete account", "delete", screenshot: "Delete account sheet") {
                tap("Cancel delete account", web(.button, exact("Cancel")), timeout: 5, required: false)
            }
            row("Sign out", "signout", screenshot: "Sign out sheet") {
                tap("Cancel sign out", web(.button, exact("Cancel")), timeout: 5, required: false)
            }
            back()
        }
        snap("Home at the end")
        XCTAssertTrue(problems.isEmpty, "Tour problems:\n" + problems.joined(separator: "\n"))
    }

    // Puts the synthetic account back on English after a tour that changed it.
    @MainActor func testPreviewResetLanguageToEnglish() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and a signed-in synthetic account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        continueAfterFailure = false
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@", "Settings", "Postavke", "Nastavitve")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        settings.tap()
        let language = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Language", "Jezik")).firstMatch
        XCTAssertTrue(language.waitForExistence(timeout: 15))
        for _ in 0..<5 where !language.isHittable { app.webViews.firstMatch.swipeUp() }
        language.tap()
        // The sheet lists native language names; take the last "English" so a
        // settings-row subtitle with the same text is never the one tapped.
        XCTAssertTrue(app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Slovenščina")).firstMatch.waitForExistence(timeout: 10), "Language sheet must open")
        let english = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "English")).allElementsBoundByIndex.last
        XCTAssertNotNil(english)
        english?.tap()
        XCTAssertTrue(app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch.waitForExistence(timeout: 20)
                      || app.webViews.staticTexts["Settings"].waitForExistence(timeout: 20), "Settings must render in English again")
    }

    // Opens each remaining settings row (sheets, native prompts and in-app
    // pages) and gets back to Settings, relaunching if the way back is lost.
    @MainActor func testPreviewSettingsRows() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and a signed-in synthetic account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        continueAfterFailure = true
        var problems: [String] = []
        var shot = 0
        func snap(_ name: String) {
            shot += 1
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = String(format: "S%02d %@", shot, name)
            image.lifetime = .keepAlways
            add(image)
        }
        func settle(_ seconds: TimeInterval = 1.5) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
        func web(_ type: XCUIElement.ElementType, _ label: String) -> XCUIElement {
            app.webViews.descendants(matching: type).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
        }
        func openSettings() -> Bool {
            if app.webViews.switches["Dark"].waitForExistence(timeout: 5) { return true }
            let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
            if !settings.waitForExistence(timeout: 10) { app.terminate(); app.launch(); _ = settings.waitForExistence(timeout: 30) }
            guard settings.exists else { return false }
            settings.tap()
            return app.webViews.switches["Dark"].waitForExistence(timeout: 15)
        }
        app.launch()
        passConsentGate(app)
        XCTAssertTrue(openSettings(), "Settings must open")
        func row(_ label: String, _ name: String, dismiss: @MainActor () -> Void) {
            guard openSettings() else { problems.append("\(name): settings unavailable"); return }
            let element = web(.any, label)
            var reached = element.exists && element.isHittable
            for _ in 0..<8 where !reached { app.webViews.firstMatch.swipeUp(); settle(0.4); reached = element.exists && element.isHittable }
            guard reached else { problems.append("\(name): unreachable"); return }
            element.tap(); settle(2.5); snap(name); dismiss(); settle()
        }
        func tapWeb(_ label: String) { let e = web(.button, label); if e.waitForExistence(timeout: 5) && e.isHittable { e.tap() } }
        func back() { let b = web(.button, "Back"); if b.exists && b.isHittable { b.tap() } else { app.terminate(); app.launch() } }
        row("Suggest a feature", "Suggest a feature") { back() }
        row("Choose a plan", "Settings paywall") { tapWeb("Close the subscription offer") }
        row("Restore purchases", "Restore purchases") {
            let cancel = app.buttons["Cancel"]
            if cancel.waitForExistence(timeout: 8) { snap("Restore prompt"); cancel.tap() }
        }
        // "Manage Apple subscriptions" opens Apple's own sheet (an Apple Account
        // sign-in on the simulator) that cannot be dismissed from here; it is
        // covered by the layout review's settings screenshot instead.
        row("Withdraw AI permission", "Withdraw AI permission") { tapWeb("Cancel") }
        row("Delete account", "Delete account") { tapWeb("Cancel") }
        row("Sign out", "Sign out") { tapWeb("Cancel") }
        row("Share", "Share Memo") { settle(2); snap("After Share"); tapWeb("Cancel") }
        XCTAssertTrue(problems.isEmpty, "Settings rows problems:\n" + problems.joined(separator: "\n"))
    }

    @MainActor func testPreviewHelpUsesAppleBillingInstructions() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and a signed-in synthetic account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        continueAfterFailure = false
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        settings.tap()
        XCTAssertTrue(app.webViews.switches["Dark"].waitForExistence(timeout: 15))
        let redeem = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "Redeem a code")).firstMatch
        for _ in 0..<5 {
            if redeem.exists && redeem.isHittable { break }
            app.webViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(redeem.exists && redeem.isHittable)
        redeem.tap()
        let appleHelp = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Codes issued for website purchases cannot be entered")).firstMatch
        XCTAssertTrue(appleHelp.waitForExistence(timeout: 15))
        XCTAssertFalse(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Stripe Checkout")).firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Apple billing help"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    // Opt-in review against a staging Preview with a synthetic account already
    // signed in on this simulator. The ordinary fixture suite skips this test.
    @MainActor func testPreviewSettingsScrollAndTheme() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview and a signed-in synthetic account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        continueAfterFailure = false
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        let home = XCTAttachment(screenshot: app.screenshot())
        home.name = "Full-screen PWA home"
        home.lifetime = .keepAlways
        add(home)
        settings.tap()
        let darkControl = app.webViews.switches["Dark"]
        if !darkControl.waitForExistence(timeout: 15) {
            print(app.debugDescription)
            XCTFail("Dark theme control missing")
            return
        }
        app.webViews.switches["Light"].tap()
        XCTAssertEqual(app.webViews.switches["Light"].value as? String, "1")
        let light = XCTAttachment(screenshot: app.screenshot())
        light.name = "PWA settings light appearance"
        light.lifetime = .keepAlways
        add(light)
        darkControl.tap()
        XCTAssertEqual(darkControl.value as? String, "1")
        let dark = XCTAttachment(screenshot: app.screenshot())
        dark.name = "PWA settings dark appearance"
        dark.lifetime = .keepAlways
        add(dark)
        let restore = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch
        for _ in 0..<5 {
            if restore.exists && restore.isHittable { break }
            app.webViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(restore.exists && restore.isHittable, "Apple settings must be reachable by scrolling")
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Manage Apple subscriptions")).firstMatch.exists)
        let rows = XCTAttachment(screenshot: app.screenshot())
        rows.name = "PWA settings with Apple rows"
        rows.lifetime = .keepAlways
        add(rows)
        let system = app.webViews.switches["System"]
        for _ in 0..<5 {
            if system.isHittable { break }
            app.webViews.firstMatch.swipeDown()
        }
        system.tap()
        XCTAssertEqual(system.value as? String, "1")
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        let fixture = Bundle(for: Self.self).url(forResource: "fixture-url", withExtension: "txt")!
        app.launchEnvironment["MEMO_IOS_URL"] = try! String(contentsOf: fixture, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        continueAfterFailure = false
        XCTAssertTrue(app.webViews.staticTexts["Native bridge ready"].waitForExistence(timeout: 30))
        return app
    }

    @MainActor func testLaunchAndKeyboard() {
        let app = launch()
        let input = app.webViews.textFields["Note title"]
        input.tap()
        input.typeText("Synthetic lecture")
        XCTAssertEqual(input.value as? String, "Synthetic lecture")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor func testServerFailureAndRetry() {
        let app = launch()
        app.webViews.buttons["Simulate failure"].tap()
        XCTAssertTrue(app.buttons["retry"].waitForExistence(timeout: 10))
        app.buttons["retry"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Native bridge ready"].waitForExistence(timeout: 20))
    }

    @MainActor func testDocumentExport() {
        let app = launch()
        app.webViews.links["Export document"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Save to Files")).firstMatch.waitForExistence(timeout: 15))
    }

    @MainActor func testBlobExport() {
        let app = launch()
        app.webViews.buttons["Export blob"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Save to Files")).firstMatch.waitForExistence(timeout: 15))
    }

    @MainActor func testNativeMessagesFollowPwaLanguageAndSurviveRelaunch() {
        let app = launch()
        for (locale, expectedRetry) in [("sl", "Poskusi znova"), ("hr", "Pokušaj ponovno"),
            ("bs", "Pokušaj ponovo"), ("sr", "Pokušaj ponovo"), ("en", "Try again")] {
            app.webViews.buttons["Language \(locale)"].tap()
            app.webViews.buttons["Simulate failure"].tap()
            XCTAssertTrue(app.buttons["retry"].waitForExistence(timeout: 10))
            XCTAssertEqual(app.buttons["retry"].label, expectedRetry)
            app.terminate()
            app.launch()
            XCTAssertTrue(app.webViews.staticTexts["Native bridge ready"].waitForExistence(timeout: 30))
            app.webViews.buttons["Simulate failure"].tap()
            let retry = app.buttons["retry"]
            XCTAssertTrue(retry.waitForExistence(timeout: 10))
            XCTAssertEqual(retry.label, expectedRetry)
            retry.tap()
            XCTAssertTrue(app.webViews.staticTexts["Native bridge ready"].waitForExistence(timeout: 20))
        }
    }
}
