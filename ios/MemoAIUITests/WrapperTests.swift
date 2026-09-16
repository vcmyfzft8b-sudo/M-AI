import XCTest

final class WrapperTests: XCTestCase {
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
                let chips = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", tabNames)).allElementsBoundByIndex
                guard let anchor = chips.first(where: { $0.isHittable }) else { break }
                if tab.frame.midX > width { anchor.swipeLeft() } else { anchor.swipeRight() }
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
        let saveToFiles = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Save to Files")).firstMatch
        XCTAssertTrue(saveToFiles.waitForExistence(timeout: 20), "Mindmap export must open the native share sheet")
        snap("07 Mindmap share sheet")
        let closeShare = app.buttons["Close"].firstMatch
        if closeShare.waitForExistence(timeout: 3) { closeShare.tap() } else { app.swipeDown() }

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
    // Apple, Google and email with no back arrow, and a password login must
    // reach the AI-consent gate. Credentials come from MEMO_QA_EMAIL/PASSWORD.
    @MainActor func testPreviewSignInScreenAndPasswordLogin() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], let password = env["MEMO_QA_PASSWORD"] else {
            throw XCTSkip("Requires a staging Preview and a synthetic password account")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        continueAfterFailure = false
        func snap(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        func contains(_ text: String) -> NSPredicate { NSPredicate(format: "label CONTAINS %@", text) }
        let emailButton = app.webViews.buttons.matching(contains("Continue with email")).firstMatch
        XCTAssertTrue(emailButton.waitForExistence(timeout: 30))
        snap("S1 Sign in")
        XCTAssertFalse(app.webViews.links["Back"].exists, "The app has no landing page to go back to")
        XCTAssertTrue(app.webViews.buttons.matching(contains("Continue with Google")).firstMatch.exists)
        XCTAssertTrue(app.webViews.buttons.matching(contains("Continue with Apple")).firstMatch.exists,
                      "Sign in with Apple must accompany Google (App Review 4.8)")
        emailButton.tap()
        let passwordLink = app.webViews.links.matching(contains("Sign in with a password")).firstMatch
        XCTAssertTrue(passwordLink.waitForExistence(timeout: 15))
        snap("S2 Email entry")
        passwordLink.tap()
        let emailField = app.webViews.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15))
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.webViews.secureTextFields.firstMatch
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        passwordField.tap()
        passwordField.typeText(password)
        snap("S3 Password form")
        let submit = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "sign in")).firstMatch
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        submit.tap()
        // A first sign-in meets the AI-consent gate; an account that already
        // consented goes straight on.
        let allow = app.webViews.buttons.matching(contains("Allow AI processing")).firstMatch
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
