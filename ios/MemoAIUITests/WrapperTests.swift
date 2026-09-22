import XCTest
import UIKit

final class WrapperTests: XCTestCase {
    /// Walk the same anonymous onboarding as a fresh PWA install before login.
    /// The working-adult route avoids school-only questions; demo steps keep
    /// their ordinary Continue action instead of bypassing the survey cookie.
    @MainActor private func completeOnboarding(_ app: XCUIApplication) {
        let start = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Get started", "Začnimo"])).firstMatch
        let progress = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["Setup progress", "Napredek nastavitve"])).firstMatch
        guard start.waitForExistence(timeout: 10) || progress.exists else { return }
        let choices = ["Instagram Reels", "For me", "Zame", "Working", "Zaposlen/a", "Learn 10× faster", "Učiti se 10x hitreje", "Audio notes", "Audio zapiski", "No, just help me in general", "Ne, pomagaj mi na splošno", "Casual — 10 min / day", "Sproščeno - 10 min / dan"]
        let deadline = Date().addingTimeInterval(180)
        var capturedWaitingState = false
        while Date() < deadline {
            if app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue with email", "Nadaljuj z e-pošto", "Close the subscription offer", "Zapri ponudbo naročnine"])).firstMatch.exists
                || app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "New note", "Nov zapisek")).firstMatch.exists { return }
            XCTAssertFalse(app.webViews.staticTexts["Your answers could not be saved."].firstMatch.exists,
                           "Anonymous onboarding must save successfully before sign-in")
            let cta = ["Get started", "Začnimo", "Make my first note", "Ustvari prvi zapisek", "Continue", "Nadaljuj"].map {
                app.webViews.buttons.matching(NSPredicate(format: "label == %@", $0)).firstMatch
            }
            // WebKit exposes aria-pressed options as switches, not buttons.
            let options = choices.flatMap { choice in
                let label = NSPredicate(format: "label CONTAINS %@", choice)
                // The tablet rail repeats prior answers as static text. Only
                // the real selectable controls can advance this question.
                return [app.webViews.buttons.matching(label).firstMatch,
                        app.webViews.switches.matching(label).firstMatch,
                        app.webViews.radioButtons.matching(label).firstMatch]
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

    @MainActor private func dismissNotificationNudge(_ app: XCUIApplication) {
        let prompt = app.webViews.staticTexts["Shall we tell you when it’s done?"].firstMatch
        if prompt.exists {
            let decline = app.webViews.buttons["No thanks"].firstMatch
            XCTAssertTrue(decline.exists)
            decline.tap()
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
        completeOnboarding(app)
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
        completeOnboarding(app)
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue with Google", "Nadaljuj z Google"])).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue with Apple", "Nadaljuj z Apple"])).firstMatch.exists)
        XCTAssertTrue(signInWithCode(app, email: email, code: code), "The staging review account must sign in")
        completeOnboarding(app)
        dismissInitialOffer(app)
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "New note", "Nov zapisek")).firstMatch.waitForExistence(timeout: 30))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Staging study account signed in"
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// A signed-in synthetic account that withdrew AI permission meets the
    /// consent gate at launch; allow it again (retrying until React hydrates).
    @MainActor private func passConsentGate(_ app: XCUIApplication) {
        let allow = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Allow AI processing", "Dovoli obdelavo")).firstMatch
        let home = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "New note", "Nov zapisek")).firstMatch
        // Wait for whichever page follows the launch cover: home, or the gate.
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline, !allow.exists, !home.exists,
              !app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["Setup progress", "Napredek nastavitve"])).firstMatch.exists,
              !app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue with email", "Nadaljuj z e-pošto", "Close the subscription offer", "Zapri ponudbo naročnine"])).firstMatch.exists {
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
        let from = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.7 : 0.4, dy: y))
        let to = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.4 : 0.7, dy: y))
        from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
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
        /// The tab strip is a horizontally scrolling chip row: drag it from a
        /// visible chip until the wanted chip is on screen.
        func tapTab(_ name: String) {
            openStudyTab(name, in: app)
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
            dismissNotificationNudge(app)
            XCTAssertFalse(failed.exists, "Note generation failed")
            RunLoop.current.run(until: Date().addingTimeInterval(10))
        }
        XCTAssertTrue(notesReady(), "Notes did not finish within 10 minutes")
        dismissNotificationNudge(app)
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
        let playbackClock = app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}:[0-9]{2}$")).firstMatch
        let advancing = NSPredicate { _, _ in
            guard playbackClock.exists else { return false }
            return playbackClock.label.split(separator: ":").compactMap { Int($0) }.reduce(0) { $0 * 60 + $1 } >= 2
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: advancing, object: playbackClock)], timeout: 30), .completed,
                       "Read-aloud playback time must advance, not merely display Pause")
        snap("09 Read aloud playing")
        pause.tap()
        let closeReader = webButton("Close the reader")
        if closeReader.waitForExistence(timeout: 5) { closeReader.tap() }

        if ProcessInfo.processInfo.environment["MEMO_QA_KEEP_NOTE"] == "1" {
            snap("10 Note retained for further study-tool checks")
            return
        }
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

    @MainActor private func openPreviewStudyNote() throws -> XCUIApplication {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires the retained synthetic Plant Life Cycle note in staging")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        let note = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Plant Life Cycle")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 30))
        note.tap()
        XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 30))
        dismissNotificationNudge(app)
        return app
    }

    @MainActor private func openStudyTab(_ name: String, in app: XCUIApplication) {
        let names = ["Notes", "Tutor", "Flashcards", "Podcast", "Quiz", "Mindmap", "Palace", "Test", "Speed read", "Transcript"]
        let tab = app.webViews.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 15))
        let width = app.windows.firstMatch.frame.width
        for _ in 0..<12 {
            let frame = tab.frame
            // WebKit's clipped edge chips can throw from isHittable rather
            // than return false. Move the whole chip inside the strip, then
            // tap its observed centre as a person would.
            if frame.width > 1 && frame.minX >= 12 && frame.maxX <= width - 12 {
                app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
                return
            }
            let visible = names.enumerated().compactMap { index, label -> (Int, CGRect)? in
                let candidate = app.webViews.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
                guard candidate.exists else { return nil }
                let candidateFrame = candidate.frame
                return candidateFrame.width > 1 && candidateFrame.minX >= 12 && candidateFrame.maxX <= width - 12
                    ? (index, candidateFrame) : nil
            }.first
            let targetIndex = names.firstIndex(of: name) ?? 0
            let left = visible.map { targetIndex > $0.0 } ?? (frame.midX >= width / 2)
            scrollStrip(app, tabNames: names, rowY: visible?.1.midY ?? frame.midY, left: left)
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTFail("\(name) tab must be reachable")
    }

    @MainActor private func keepStudyScreenshot(_ name: String, app: XCUIApplication) {
        // Capture the screen after rotation: app.screenshot() can retain its
        // portrait crop while the iPad's window has rotated to landscape.
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    @MainActor func testPreviewSpeedReaderAdvancesAndPauses() throws {
        let app = try openPreviewStudyNote()
        openStudyTab("Speed read", in: app)
        let start = app.webViews.buttons["Start reading"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        let position = app.webViews.sliders["Position in the note"].firstMatch
        XCTAssertTrue(position.exists)
        let before = String(describing: position.value)
        start.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        let pause = app.webViews.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.exists)
        pause.tap()
        XCTAssertNotEqual(String(describing: position.value), before, "Playback must move through the note")
        let paused = String(describing: position.value)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertEqual(String(describing: position.value), paused, "Pause must stop the words advancing")
        keepStudyScreenshot("Speed reader after play and pause", app: app)
    }

    @MainActor func testPreviewPracticeTestSubmission() throws {
        let app = try openPreviewStudyNote()
        openStudyTab("Test", in: app)
        let answer = app.webViews.textViews["Your answer:"].firstMatch
        let readyBy = Date().addingTimeInterval(180)
        while Date() < readyBy && !answer.exists {
            let start = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Create a test", "Start a new test"])).firstMatch
            if start.exists && start.isEnabled { start.tap() }
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
        XCTAssertTrue(answer.exists, "Questions must be generated")
        var submitted = false
        for index in 0..<30 {
            if index == 0 {
                // A resumed draft may already mark this question unknown.
                if !answer.isEnabled {
                    app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "I don't know")).firstMatch.tap()
                }
                answer.tap()
                answer.typeText("A seed absorbs water and germinates. Roots grow down into the soil, and the shoot grows toward light. Leaves use photosynthesis to support the plant's growth.")
                app.webViews.firstMatch.swipeUp()
            } else {
                let unknown = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "I don't know")).firstMatch
                XCTAssertTrue(unknown.exists)
                if answer.isEnabled { unknown.tap() }
            }
            let submit = app.webViews.buttons["Submit the test"].firstMatch
            if submit.exists {
                XCTAssertTrue(submit.isEnabled)
                submit.tap()
                submitted = true
                break
            }
            let next = app.webViews.buttons["Next"].firstMatch
            XCTAssertTrue(next.exists)
            for _ in 0..<3 where !next.isHittable { app.webViews.firstMatch.swipeUp() }
            next.tap()
        }
        XCTAssertTrue(submitted)
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "points scored")).firstMatch.waitForExistence(timeout: 180), "The submitted test must return graded results")
        keepStudyScreenshot("Practice test graded result", app: app)
    }

    @MainActor func testPreviewMemoryPalaceOpens() throws {
        let app = try openPreviewStudyNote()
        openStudyTab("Palace", in: app)
        let prepare = app.webViews.buttons["Prepare study game"].firstMatch
        if prepare.waitForExistence(timeout: 10) { prepare.tap() }
        let start = app.webViews.buttons["Start game"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 180))
        start.tap()
        let leave = app.webViews.buttons["Back to the note"].firstMatch
        XCTAssertTrue(leave.waitForExistence(timeout: 30))
        XCTAssertFalse(app.webViews.staticTexts["This device can't run the 3D palace. The flashcards work everywhere."].exists)
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        keepStudyScreenshot("Memory palace rendered in the wrapper", app: app)
        let from = app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.78))
        from.press(forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: 0, dy: -70)))
        keepStudyScreenshot("Memory palace after movement", app: app)
        leave.tap()
        XCTAssertTrue(app.webViews.buttons["Palace"].firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor func testPreviewPodcastPlaybackAdvances() throws {
        let app = try openPreviewStudyNote()
        openStudyTab("Podcast", in: app)
        let make = app.webViews.buttons["Make the episode"].firstMatch
        XCTAssertTrue(make.waitForExistence(timeout: 15))
        make.tap()
        let short = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Short")).firstMatch
        XCTAssertTrue(short.waitForExistence(timeout: 10), "The episode format/length chooser must open")
        if short.exists && short.isHittable { short.tap() }
        let makeButtons = app.webViews.buttons.matching(identifier: "Make the episode")
        let confirm = makeButtons.element(boundBy: makeButtons.count - 1)
        XCTAssertTrue(confirm.exists)
        confirm.tap()
        let play = app.webViews.buttons["Play"].firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 180), "The podcast script must finish")
        play.tap()
        let pause = app.webViews.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 120))
        let position = app.webViews.sliders["Position in the episode"].firstMatch
        XCTAssertTrue(position.exists)
        let initial = String(describing: position.value)
        RunLoop.current.run(until: Date().addingTimeInterval(8))
        XCTAssertNotEqual(String(describing: position.value), initial, "Podcast audio time must advance")
        keepStudyScreenshot("Podcast playing in the wrapper", app: app)
        pause.tap()
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

    // Opt-in inspection of Apple's actual Sandbox purchase sheet. No local
    // StoreKit configuration and no fabricated entitlement are used here.
    @MainActor func testPreviewInspectSandboxCheckout() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_CHECKOUT"] == "1",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Explicit Sandbox checkout inspection only")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        let close = app.webViews.buttons["Close the subscription offer"].firstMatch
        if !close.waitForExistence(timeout: 15) {
            let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 20))
            settings.tap()
            let choose = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Choose a plan")).firstMatch
            XCTAssertTrue(choose.waitForExistence(timeout: 15))
            for _ in 0..<5 where !choose.isHittable { app.webViews.firstMatch.swipeUp() }
            choose.tap()
        }
        let payment = app.webViews.buttons.matching(NSPredicate(
            format: "label IN %@", ["Continue to payment", "Start the 3-day free trial"]
        )).firstMatch
        let ready = NSPredicate { _, _ in payment.exists && payment.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: payment)], timeout: 30), .completed)
        payment.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(12))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "Actual Sandbox checkout boundary"
        shot.lifetime = .keepAlways
        add(shot)
        for (name, process) in [("Memo", app), ("System", XCUIApplication(bundleIdentifier: "com.apple.springboard"))] {
            let hierarchy = XCTAttachment(string: process.debugDescription)
            hierarchy.name = name + " checkout accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        throw XCTSkip("Captured purchase boundary; completion must be verified separately")
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
    /// Destructive opt-in for the synthetic Preview account only. The server's
    /// three-hour upload-drain window is verified separately, never shortened.
    @MainActor func testPreviewDeleteSyntheticStudyAccount() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], email.hasSuffix("@example.com"),
              env["MEMO_QA_DELETE_ACCOUNT"] == email else {
            throw XCTSkip("Requires explicit deletion of a synthetic Preview account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 20))
        settings.tap()
        XCTAssertTrue(app.webViews.staticTexts[email].firstMatch.waitForExistence(timeout: 15), "Never delete an unexpected account")
        let delete = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Delete account")).firstMatch
        for _ in 0..<12 {
            if delete.exists && delete.isHittable { break }
            let from = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
            from.press(forDuration: 0.1, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(delete.isHittable)
        delete.tap()
        let confirm = app.webViews.buttons["Delete permanently"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        keepStudyScreenshot("Account deletion disclosure", app: app)
        confirm.tap()
        XCTAssertTrue(app.webViews.staticTexts["Account deletion requested"].firstMatch.waitForExistence(timeout: 30))
        keepStudyScreenshot("Account deletion requested in the wrapper", app: app)
    }

    @MainActor func testPreviewRemainsPortraitWhenDeviceRotates() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.terminate()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
        for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight, .portraitUpsideDown, .portrait] {
            XCUIDevice.shared.orientation = orientation
            RunLoop.current.run(until: Date().addingTimeInterval(2))
            let frame = app.windows.firstMatch.frame
            XCTAssertLessThan(frame.width, frame.height, "Memo must remain portrait after device rotation")
            let webFrame = app.webViews.firstMatch.frame
            XCTAssertLessThan(webFrame.width, webFrame.height, "The PWA viewport must also remain portrait")
        }
        keepStudyScreenshot(UIDevice.current.userInterfaceIdiom == .pad ? "iPad portrait lock" : "iPhone portrait lock", app: app)
    }

    @MainActor func testPreviewTabletLayouts() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("Dedicated iPad layout check") }
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = try openPreviewStudyNote()
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            RunLoop.current.run(until: Date().addingTimeInterval(3))
            let frame = app.windows.firstMatch.frame
            XCTAssertLessThan(frame.width, frame.height, "The app stays portrait even when the device is sideways")
            let notes = app.webViews.buttons["Notes"].firstMatch
            XCTAssertTrue(notes.isHittable)
            XCTAssertGreaterThanOrEqual(notes.frame.minX, frame.minX)
            XCTAssertLessThanOrEqual(notes.frame.maxX, frame.maxX)
            keepStudyScreenshot(orientation.isLandscape ? "iPad note with device sideways" : "iPad note portrait", app: app)
        }
        openStudyTab("Flashcards", in: app)
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Card ")).firstMatch.waitForExistence(timeout: 15))
        keepStudyScreenshot("iPad flashcards portrait", app: app)
        // The PWA desktop layout exposes Settings in its navigation rail;
        // the phone-only Back button is intentionally absent on a wide iPad.
        let back = app.webViews.buttons["Back"].firstMatch
        if back.exists { back.tap() }
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 20))
        settings.tap()
        XCTAssertTrue(app.webViews.switches["Dark"].waitForExistence(timeout: 15))
        keepStudyScreenshot("iPad settings portrait", app: app)
    }

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
        completeOnboarding(app)
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
        guard var before = elapsed(), before >= 2 else {
            snap("L2 Recording did not start")
            return XCTFail("The clock must run once recording starts")
        }
        XCTAssertTrue(webButton("Pause", "Začasno ustavi").exists, "A running recording offers a pause")
        XCTAssertTrue(app.webViews.staticTexts.matching(
            either("you can lock your phone", "telefon lahko ugasneš")).firstMatch.exists,
            "The app's hint says the phone can be locked")
        snap("L2 Recording")
        webButton("Pause", "Začasno ustavi").tap()
        let resume = webButton("Resume recording", "Nadaljuj snemanje")
        XCTAssertTrue(resume.waitForExistence(timeout: 10))
        let pausedAt = try XCTUnwrap(elapsed())
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCTAssertLessThanOrEqual(try XCTUnwrap(elapsed()) - pausedAt, 1,
                                 "Paused time must not be added to the recording")
        snap("L2a Paused recording")
        resume.tap()
        XCTAssertTrue(webButton("Pause", "Začasno ustavi").waitForExistence(timeout: 10))
        before = try XCTUnwrap(elapsed())

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
        passConsentGate(app)
        dismissInitialOffer(app)
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
