import XCTest
import UIKit
import StoreKitTest

final class WrapperTests: XCTestCase {
    /// Walk the same anonymous onboarding as a fresh PWA install before login.
    /// The working-adult route avoids school-only questions; demo steps keep
    /// their ordinary Continue action instead of bypassing the survey cookie.
    @MainActor private func completeOnboarding(_ app: XCUIApplication, verifyKeyboard: Bool = false) {
        let start = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Get started", "Začnimo"])).firstMatch
        let progress = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["Setup progress", "Napredek nastavitve"])).firstMatch
        guard start.waitForExistence(timeout: 10) || progress.exists else {
            XCTAssertFalse(verifyKeyboard, "This test needs fresh anonymous onboarding")
            return
        }
        let choices = ["Instagram Reels", "For me", "Zame", "Working", "Zaposlen/a", "Learn 10× faster", "Učiti se 10x hitreje", "Audio notes", "Audio zapiski", "No, just help me in general", "Ne, pomagaj mi na splošno", "Casual — 10 min / day", "Sproščeno - 10 min / dan"]
        let deadline = Date().addingTimeInterval(180)
        var capturedWaitingState = false
        while Date() < deadline {
            if app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue with email", "Nadaljuj z e-pošto", "Close the subscription offer", "Zapri ponudbo naročnine"])).firstMatch.exists
                || app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "New note", "Nov zapisek")).firstMatch.exists {
                XCTAssertFalse(verifyKeyboard, "Onboarding ended before the keyboard check")
                return
            }
            XCTAssertFalse(app.webViews.staticTexts["Your answers could not be saved."].firstMatch.exists,
                           "Anonymous onboarding must save successfully before sign-in")
            if verifyKeyboard, app.webViews.textViews.firstMatch.exists {
                let answer = app.webViews.textViews.firstMatch
                answer.tap()
                XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
                answer.typeText("Synthetic practice answer")
                let next = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue", "Nadaljuj"])).firstMatch
                RunLoop.current.run(until: Date().addingTimeInterval(0.5))
                let keyboardTop = app.keyboards.firstMatch.frame.minY
                XCTAssertLessThanOrEqual(answer.frame.maxY, keyboardTop - 12)
                XCTAssertTrue(next.isHittable)
                XCTAssertLessThanOrEqual(next.frame.maxY, keyboardTop - 10)
                keepStudyScreenshot("Onboarding answer and Continue above keyboard", app: app)
                next.tap()
                expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
                waitForExpectations(timeout: 10)
                keepStudyScreenshot("Onboarding after keyboard dismissal", app: app)
                return
            }
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
        // An account without a subscription meets the offer on every cold
        // launch, and after a slow start it can arrive late. Wait until either
        // it can be closed or the home screen's Settings is reachable.
        let close = app.webViews.buttons.matching(NSPredicate(
            format: "label == %@ OR label == %@", "Close the subscription offer", "Zapri ponudbo naročnine")).firstMatch
        let settings = app.webViews.links.matching(NSPredicate(
            format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Settings", "Nastavitve")).firstMatch
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            if close.exists {
                close.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(2))
                continue
            }
            if settings.exists && settings.isHittable {
                // Give a late offer one more beat to show before moving on.
                RunLoop.current.run(until: Date().addingTimeInterval(2))
                if !close.exists { return }
                continue
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
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

    // Staging's retained note varies by fixture account; MEMO_QA_NOTE_TITLE picks it.
    @MainActor private func openPreviewStudyNote(title: String = ProcessInfo.processInfo.environment["MEMO_QA_NOTE_TITLE"] ?? "Plant Life Cycle") throws -> XCUIApplication {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a retained synthetic study note in staging")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        let note = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 30))
        // Newer notes push it down behind the dock; bring it into reach first.
        let dockTop = app.webViews.buttons["New note"].firstMatch.exists ? app.webViews.buttons["New note"].firstMatch.frame.minY : app.windows.firstMatch.frame.maxY
        for _ in 0..<6 where !note.isHittable || note.frame.maxY > dockTop - 8 { app.webViews.firstMatch.swipeUp() }
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

    @MainActor func testPreviewFlashcardEditingPersists() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_EMAIL"] == "ios-word-20260922@example.com" else {
            throw XCTSkip("Mutates only the dedicated synthetic circuit note")
        }
        let title = "Introduction to Electric Circuits"
        let front = "QA circuit: what does resistance oppose?"
        let originalBack = "The flow of current."
        let updatedBack = "The flow of electric current through a circuit."
        let app = try openPreviewStudyNote(title: title)
        defer { app.terminate() }
        func button(_ name: String) -> XCUIElement { app.webViews.buttons[name].firstMatch }
        func scrollTo(_ element: XCUIElement, coordinateTap: Bool = false) {
            XCTAssertTrue(element.waitForExistence(timeout: 15))
            // XCTest excludes the prediction strip from its keyboard rectangle.
            // Keep gestures and controls above that strip as well as the keys.
            func visible() -> Bool {
                // A swipe-revealed action sits on the last filtered row, which cannot
                // scroll higher; it only has to clear the keys it is tapped above.
                let strip: CGFloat = coordinateTap ? 0 : 44
                let bottom = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY - strip : app.windows.firstMatch.frame.maxY
                return (coordinateTap || element.isHittable) && element.frame.maxY <= bottom - 10 && element.frame.minY >= 60
            }
            for _ in 0..<6 where !visible() {
                let window = app.windows.firstMatch
                let bottom = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY - 64 : window.frame.maxY - 80
                let origin = window.coordinate(withNormalizedOffset: .zero)
                origin.withOffset(CGVector(dx: window.frame.width * 0.95, dy: bottom - 25))
                    .press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: window.frame.width * 0.95, dy: max(180, bottom - 200))))
            }
            XCTAssertTrue(visible(), "The complete control must be above the keyboard before tapping")
        }
        func findSavedCard() -> XCUIElement {
            let search = app.webViews.textFields["Search..."].firstMatch
            scrollTo(search)
            search.tap()
            search.typeText(front)
            let card = app.webViews.staticTexts[front].firstMatch
            scrollTo(card)
            return card
        }
        openStudyTab("Flashcards", in: app)
        let create = button("Create flashcards")
        if create.waitForExistence(timeout: 5) { create.tap() }
        XCTAssertTrue(button("Edit flashcards").waitForExistence(timeout: 300), "Real generated flashcards must become available")
        keepStudyScreenshot("Generated circuit flashcards on iPhone", app: app)
        button("Edit flashcards").tap()
        let question = app.webViews.textViews["Question"].firstMatch
        let answer = app.webViews.textViews["Answer"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 15))
        question.tap()
        question.typeText(front)
        answer.tap()
        answer.typeText(originalBack)
        XCTAssertGreaterThanOrEqual(app.keyboards.firstMatch.frame.minY - answer.frame.maxY, 10,
                                    "The flashcard answer must stay clear of the keyboard")
        keepStudyScreenshot("Flashcard answer above the keyboard", app: app)
        scrollTo(button("Add card"))
        button("Add card").tap()
        XCTAssertTrue(button("Add card").waitForExistence(timeout: 20))
        findSavedCard().tap()
        XCTAssertTrue(button("Save card").waitForExistence(timeout: 15))
        // Select the whole answer through iOS's editing menu. A plain tap can
        // put the caret at the start, where backspace removes nothing.
        answer.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        answer.press(forDuration: 1.2)
        let selectAllButton = app.buttons["Select All"].firstMatch
        let selectAllMenu = app.menuItems["Select All"].firstMatch
        let selectAll = selectAllButton.waitForExistence(timeout: 5) ? selectAllButton : selectAllMenu
        XCTAssertTrue(selectAll.waitForExistence(timeout: 5))
        selectAll.tap()
        answer.typeText(updatedBack)
        XCTAssertEqual(answer.value as? String, updatedBack)
        scrollTo(button("Save card"))
        button("Save card").tap()
        XCTAssertTrue(button("Add card").waitForExistence(timeout: 20))
        button("Close").tap()
        app.terminate()
        app.launch()
        let note = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 30))
        note.tap()
        openStudyTab("Flashcards", in: app)
        button("Edit flashcards").tap()
        let saved = findSavedCard()
        XCTAssertTrue(app.webViews.staticTexts[updatedBack].firstMatch.waitForExistence(timeout: 15),
                      "The edited answer must survive full app restart")
        keepStudyScreenshot("Edited flashcard survives iPhone relaunch", app: app)
        saved.swipeLeft()
        // WebKit reports the revealed action as not hittable under the
        // translated card. Tap its visible, measured center and verify removal.
        scrollTo(button("Delete"), coordinateTap: true)
        button("Delete").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: saved)], timeout: 20), .completed,
                       "Delete must remove only the filtered synthetic QA card")
        keepStudyScreenshot("Synthetic flashcard deleted", app: app)
    }

    @MainActor func testPreviewCircuitQuizGeneration() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_EMAIL"] == "ios-word-20260922@example.com" else {
            throw XCTSkip("Uses only the dedicated synthetic circuit note")
        }
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        defer { app.terminate() }
        openStudyTab("Quiz", in: app)
        let create = app.webViews.buttons["Create a quiz"].firstMatch
        if create.waitForExistence(timeout: 5) { create.tap() }
        XCTAssertTrue(app.webViews.staticTexts["Question 1"].firstMatch.waitForExistence(timeout: 300),
                      "The actual generated quiz must become available")
        XCTAssertTrue(app.webViews.buttons["Edit quiz"].firstMatch.exists)
        keepStudyScreenshot("Generated circuit quiz on iPhone", app: app)
    }

    @MainActor func testPreviewCircuitQuizRoundAndRecovery() throws {
        struct Question: Decodable {
            let prompt: String
            let options: [String]
            let correct_option_idx: Int
        }
        guard ProcessInfo.processInfo.environment["MEMO_QA_EMAIL"] == "ios-word-20260922@example.com",
              let json = ProcessInfo.processInfo.environment["MEMO_QA_QUIZ_QUESTIONS"]?.data(using: .utf8) else {
            throw XCTSkip("Requires actual generated questions from the synthetic circuit note")
        }
        let questions = try JSONDecoder().decode([Question].self, from: json)
        XCTAssertGreaterThan(questions.count, 1)
        let title = "Introduction to Electric Circuits"
        let app = try openPreviewStudyNote(title: title)
        defer { app.terminate() }
        func button(_ name: String) -> XCUIElement { app.webViews.buttons[name].firstMatch }
        func tapVisible(_ element: XCUIElement) {
            XCTAssertTrue(element.waitForExistence(timeout: 15))
            // Measure the actual dock, not an arbitrary reserved height. A
            // scroll over an already fully visible answer can become a tap
            // when the content is too short to scroll.
            let dock = button("Edit quiz")
            let bottom = dock.exists ? dock.frame.minY - 4 : app.windows.firstMatch.frame.maxY - 70
            for _ in 0..<6 where !element.isHittable || element.frame.maxY > bottom {
                let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
                origin.withOffset(CGVector(dx: 10, dy: bottom - 20)).press(forDuration: 0.1,
                    thenDragTo: origin.withOffset(CGVector(dx: 10, dy: 400)))
            }
            XCTAssertTrue(element.isHittable)
            element.tap()
        }
        openStudyTab("Quiz", in: app)
        XCTAssertTrue(app.webViews.staticTexts["Question 1"].firstMatch.waitForExistence(timeout: 20))
        var missed: Question?
        for index in 0..<questions.count {
            let question = try XCTUnwrap(questions.first { app.webViews.staticTexts[$0.prompt].firstMatch.exists },
                                        "The visible prompt must match an actual generated question")
            let answer = question.options[index == 0 ? (question.correct_option_idx + 1) % question.options.count : question.correct_option_idx]
            tapVisible(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", answer)).firstMatch)
            if index == 0 {
                missed = question
                XCTAssertTrue(app.webViews.staticTexts["Not quite."].firstMatch.waitForExistence(timeout: 10))
                keepStudyScreenshot("Quiz wrong-answer feedback on iPhone", app: app)
                tapVisible(button("Got it"))
            }
            let next = index + 1 < questions.count
                ? app.webViews.staticTexts["Question \(index + 2)"].firstMatch
                : app.webViews.staticTexts["Go over the questions you missed"].firstMatch
            XCTAssertTrue(next.waitForExistence(timeout: 15))
            if index == 1 {
                // Give the ordinary debounced save time to reach the server,
                // then verify recovery through a full process restart.
                RunLoop.current.run(until: Date().addingTimeInterval(7))
                app.terminate()
                app.launch()
                let note = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
                XCTAssertTrue(note.waitForExistence(timeout: 30))
                note.tap()
                openStudyTab("Quiz", in: app)
                XCTAssertTrue(next.waitForExistence(timeout: 20), "The current question must survive relaunch")
                keepStudyScreenshot("Quiz progress survives iPhone relaunch", app: app)
            }
        }
        keepStudyScreenshot("Quiz first round with one missed answer", app: app)
        tapVisible(button("Go over 1 missed question"))
        let retry = try XCTUnwrap(missed)
        XCTAssertTrue(app.webViews.staticTexts[retry.prompt].firstMatch.waitForExistence(timeout: 15))
        tapVisible(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", retry.options[retry.correct_option_idx])).firstMatch)
        XCTAssertTrue(app.webViews.staticTexts["Every question is done"].firstMatch.waitForExistence(timeout: 15))
        keepStudyScreenshot("Quiz completed after reviewing missed answer", app: app)
        tapVisible(button("Start the quiz over"))
        XCTAssertTrue(app.webViews.staticTexts["Question 1"].firstMatch.waitForExistence(timeout: 15))
    }

    @MainActor func testPreviewQuizExplanationUsesSelectedLanguage() throws {
        struct Question: Decodable {
            let prompt: String
            let options: [String]
            let correct_option_idx: Int
        }
        guard ProcessInfo.processInfo.environment["MEMO_QA_EMAIL"] == "ios-word-20260922@example.com",
              let json = ProcessInfo.processInfo.environment["MEMO_QA_QUIZ_QUESTIONS"]?.data(using: .utf8) else {
            throw XCTSkip("Requires actual generated questions from the synthetic circuit note")
        }
        let questions = try JSONDecoder().decode([Question].self, from: json)
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        defer { app.terminate() }
        openStudyTab("Quiz", in: app)
        XCTAssertTrue(app.webViews.buttons["Edit quiz"].firstMatch.waitForExistence(timeout: 20))
        let question = try XCTUnwrap(questions.first { app.webViews.staticTexts[$0.prompt].firstMatch.exists })
        let wrong = question.options[(question.correct_option_idx + 1) % question.options.count]
        app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", wrong)).firstMatch.tap()
        let why = app.webViews.buttons["See why"].firstMatch
        XCTAssertTrue(why.waitForExistence(timeout: 15))
        why.tap()
        let expected = "Help me understand why “\(question.options[question.correct_option_idx])” is the correct answer to “\(question.prompt)”."
        // XCTest's identifier subscript rejects strings over 128 characters;
        // a label predicate can match the full, untruncated chat message.
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", expected)).firstMatch.waitForExistence(timeout: 30),
                      "The quiz explanation must use the selected English language in the actual chat")
        RunLoop.current.run(until: Date().addingTimeInterval(5))
        keepStudyScreenshot("Quiz explanation opens English chat on iPhone", app: app)
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
        let title = ProcessInfo.processInfo.environment["MEMO_QA_NOTE_TITLE"] ?? "Plant Life Cycle"
        let app = try openPreviewStudyNote(title: title)
        defer { app.terminate() }
        openStudyTab("Podcast", in: app)
        let make = app.webViews.buttons["Make the episode"].firstMatch
        if make.waitForExistence(timeout: 10) {
            make.tap()
        } else {
            // Reuse the same format/length variant when an earlier run already
            // generated it; the product opens that cached episode.
            let newEpisode = app.webViews.buttons["New episode"].firstMatch
            XCTAssertTrue(newEpisode.waitForExistence(timeout: 10))
            newEpisode.tap()
        }
        let short = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Short")).firstMatch
        XCTAssertTrue(short.waitForExistence(timeout: 10), "The episode format/length chooser must open")
        if short.exists && short.isHittable { short.tap() }
        let makeButtons = app.webViews.buttons.matching(identifier: "Make the episode")
        let confirm = makeButtons.element(boundBy: makeButtons.count - 1)
        XCTAssertTrue(confirm.exists)
        confirm.tap()
        let play = app.webViews.buttons["Play"].firstMatch
        let pause = app.webViews.buttons["Pause"].firstMatch
        let position = app.webViews.sliders["Position in the episode"].firstMatch
        XCTAssertTrue(position.waitForExistence(timeout: 180), "The podcast script must finish")
        // Reopening a cached episode can autoplay before XCTest sees Play.
        if pause.exists { pause.tap() }
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        play.tap()
        XCTAssertTrue(pause.waitForExistence(timeout: 120))
        let initial = String(describing: position.value)
        RunLoop.current.run(until: Date().addingTimeInterval(8))
        XCTAssertNotEqual(String(describing: position.value), initial, "Podcast audio time must advance")
        keepStudyScreenshot("Podcast playing in the wrapper", app: app)
        pause.tap()
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        let paused = String(describing: position.value)
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCTAssertEqual(String(describing: position.value), paused, "Pausing must stop podcast progress")
        // WebKit range inputs don't expose XCTest's native scrubber endpoints.
        // Exercise the player's real seek control instead.
        app.webViews.buttons["Back 10 seconds"].firstMatch.tap()
        XCTAssertNotEqual(String(describing: position.value), paused, "Seeking back must change the episode position")
        XCTAssertTrue(play.exists, "Seeking while paused must remain paused")
        keepStudyScreenshot("Podcast paused and sought back", app: app)

        if ProcessInfo.processInfo.environment["MEMO_QA_CROSS_SEGMENT_SEEK"] == "1" {
            let clock = app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}:[0-9]{2}$")).firstMatch
            func elapsed() -> Int {
                clock.label.split(separator: ":").compactMap { Int($0) }.reduce(0) { $0 * 60 + $1 }
            }
            // Begin in the first turn, then use the actual range track to seek
            // beyond it. The circuit fixture's first turn lasts 17.478 seconds.
            for _ in 0..<20 where elapsed() > 0 {
                app.webViews.buttons["Back 10 seconds"].firstMatch.tap()
                XCTAssertTrue(play.exists)
            }
            XCTAssertEqual(elapsed(), 0)
            position.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
            RunLoop.current.run(until: Date().addingTimeInterval(6))
            XCTAssertGreaterThan(elapsed(), 18, "The seek must cross a turn boundary")
            XCTAssertTrue(play.exists, "A cross-turn seek must preserve Pause")
            XCTAssertFalse(pause.exists)
            let sought = String(describing: position.value)
            RunLoop.current.run(until: Date().addingTimeInterval(3))
            XCTAssertEqual(String(describing: position.value), sought)
            keepStudyScreenshot("Podcast cross-turn seek stays paused", app: app)
            play.tap()
            XCTAssertTrue(pause.waitForExistence(timeout: 30))
            let advancing = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                String(describing: position.value) != sought
            }, object: position)
            XCTAssertEqual(XCTWaiter.wait(for: [advancing], timeout: 30), .completed)
            pause.tap()
            keepStudyScreenshot("Podcast resumes from the sought turn", app: app)
        }
    }

    @MainActor func testPreviewReadAloudPlaybackControls() throws {
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        defer { app.terminate() }
        openStudyTab("Notes", in: app)
        func button(_ name: String, timeout: TimeInterval = 15) -> XCUIElement {
            let query = app.webViews.buttons.matching(identifier: name)
            let deadline = Date().addingTimeInterval(timeout)
            repeat {
                // Both dock layers stay mounted for their crossfade. Choose
                // the visible control, without querying unsupported AX keys.
                if let visible = query.allElementsBoundByIndex.first(where: { $0.isHittable }) {
                    return visible
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            } while Date() < deadline
            XCTFail("No visible \(name) control")
            return query.firstMatch
        }
        let listen = button("Listen")
        XCTAssertTrue(listen.waitForExistence(timeout: 15))
        listen.tap()
        let pause = button("Pause", timeout: 120)
        XCTAssertTrue(pause.waitForExistence(timeout: 120))
        XCTAssertEqual(app.webViews.buttons.matching(identifier: "Pause").count, 1,
                       "Inactive dock layers must not expose duplicate playback controls")
        let clock = app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}:[0-9]{2}$")).firstMatch
        func elapsed() -> Int {
            guard clock.exists else { return -1 }
            return clock.label.split(separator: ":").compactMap { Int($0) }.reduce(0) { $0 * 60 + $1 }
        }
        let moving = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in elapsed() >= 3 }, object: clock)
        XCTAssertEqual(XCTWaiter.wait(for: [moving], timeout: 30), .completed)
        pause.tap()
        let stopped = elapsed()
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCTAssertLessThanOrEqual(abs(elapsed() - stopped), 1, "Pause must stop read-aloud playback")
        keepStudyScreenshot("Read aloud paused on the iPhone", app: app)
        let resume = button("Resume")
        XCTAssertTrue(resume.waitForExistence(timeout: 10))
        resume.tap()
        let resumed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in elapsed() >= stopped + 2 }, object: clock)
        XCTAssertEqual(XCTWaiter.wait(for: [resumed], timeout: 30), .completed)
        keepStudyScreenshot("Read aloud resumed on the iPhone", app: app)
        button("Close the reader").tap()
        XCTAssertTrue(listen.waitForExistence(timeout: 10))
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
        let shownAt = Date()
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 60)
        print(String(format: "MEMO_QA: paywall prices ready after %.2f s", Date().timeIntervalSince(shownAt)))
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

    // Opt-in physical-device handoff. Navigate with XCTest, but leave provider
    // credentials and verification to the account owner. Reaching the provider
    // sheet is not a passing authentication result.
    @MainActor func testPreviewGoogleSignInHandoff() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_GOOGLE_SIGN_IN"] == "1",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Explicit staging Google authentication handoff only")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        dismissInitialOffer(app)
        // Keep this opt-in handoff observable even if CoreDevice disconnects
        // before Xcode finalizes its result bundle. These are test-runner files,
        // never files or screenshot behavior shipped in Memo itself.
        func capture(_ name: String, file: String) throws {
            let screenshot = XCUIScreen.main.screenshot()
            let attachment = XCTAttachment(screenshot: screenshot)
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            try screenshot.pngRepresentation.write(to: directory.appendingPathComponent(file))
        }
        try capture("Google test launch state", file: "google-launch.png")
        let settings = app.webViews.links.matching(NSPredicate(
            format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Settings", "Nastavitve")).firstMatch
        if settings.waitForExistence(timeout: 30) {
            let recovered = XCTAttachment(screenshot: app.screenshot())
            recovered.name = "Existing provider session recovered after relaunch"
            recovered.lifetime = .keepAlways
            add(recovered)
            print("MEMO_QA: existing signed-in session recovered")
            settings.tap()
            let labels = ["Sign out", "Odjava"]
            let signOut = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
            XCTAssertTrue(signOut.waitForExistence(timeout: 15))
            for _ in 0..<8 where !signOut.isHittable { app.webViews.firstMatch.swipeUp() }
            signOut.tap()
            XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(
                format: "label IN %@", ["Sign out?", "Se želiš odjaviti?"])).firstMatch.waitForExistence(timeout: 10))
            let confirmations = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", labels))
            confirmations.element(boundBy: confirmations.count - 1).tap()
        }
        completeOnboarding(app)
        let google = app.webViews.buttons.matching(NSPredicate(
            format: "label IN %@", ["Continue with Google", "Nadaljuj z Google"])).firstMatch
        XCTAssertTrue(google.waitForExistence(timeout: 30))
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(
            format: "label IN %@", ["Continue with Apple", "Nadaljuj z Apple"])).firstMatch.exists)
        google.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(8))
        try capture("Google authentication handoff on iPhone", file: "google-handoff.png")
        print("MEMO_QA: Google button tapped; waiting for account-owner authentication")
        let signedIn = app.webViews.buttons.matching(NSPredicate(
            format: "label CONTAINS %@ OR label CONTAINS %@", "New note", "Nov zapisek")).firstMatch
        let deadline = Date().addingTimeInterval(240)
        while Date() < deadline && !signedIn.exists {
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
        try capture("Google authentication result on iPhone", file: "google-result.png")
        guard signedIn.exists else {
            throw XCTSkip("Google flow opened; completed authentication was not observed")
        }
        print("MEMO_QA: Google sign-in returned to Memo home")
    }

    // Opens native Apple authentication on an explicitly selected, signed-out
    // test device. Authentication requires the designated test account; opening the sheet
    // must never be reported as a completed provider sign-in.
    @MainActor func testPreviewInspectAppleSignIn() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_APPLE_SIGN_IN"] == "1",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Explicit Apple authentication inspection only")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        let apple = app.webViews.buttons.matching(NSPredicate(
            format: "label IN %@", ["Continue with Apple", "Nadaljuj z Apple"]
        )).firstMatch
        XCTAssertTrue(apple.waitForExistence(timeout: 30), "Requires the signed-out login screen")
        apple.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(12))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "Native Apple sign-in boundary"
        shot.lifetime = .keepAlways
        add(shot)
        for (name, process) in [("Memo", app), ("System", XCUIApplication(bundleIdentifier: "com.apple.springboard"))] {
            let hierarchy = XCTAttachment(string: process.debugDescription)
            hierarchy.name = name + " Apple sign-in accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        throw XCTSkip("Captured Apple authentication boundary; test-account authentication is required")
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
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: directory.appendingPathComponent("sandbox-checkout.png"))
        for (name, process) in [("Memo", app), ("System", XCUIApplication(bundleIdentifier: "com.apple.springboard"))] {
            let hierarchy = XCTAttachment(string: process.debugDescription)
            hierarchy.name = name + " checkout accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        guard env["MEMO_QA_COMPLETE_CHECKOUT"] == "1" else {
            throw XCTSkip("Captured purchase boundary; completion must be verified separately")
        }
        print("MEMO_QA: Sandbox checkout opened; waiting for test-account authentication")
        let home = app.webViews.buttons.matching(NSPredicate(
            format: "label CONTAINS %@ OR label CONTAINS %@", "New note", "Nov zapisek")).firstMatch
        let deadline = Date().addingTimeInterval(300)
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        var confirmedTestPurchase = false
        var nextCapture = Date.distantPast
        while Date() < deadline {
            if app.state == .runningForeground && home.exists && home.isHittable && !payment.exists { break }
            // Only confirm Apple's explicitly free Sandbox sheet. Never enter
            // credentials or confirm a production purchase from this test.
            if !confirmedTestPurchase {
                for process in [app, system] {
                    let notice = process.staticTexts.matching(NSPredicate(
                        format: "label CONTAINS %@", "You will not be charged")).firstMatch
                    let subscribe = process.buttons["Subscribe"].firstMatch
                    if notice.exists && subscribe.exists && subscribe.isHittable {
                        subscribe.tap()
                        confirmedTestPurchase = true
                        print("MEMO_QA: Confirmed Apple's no-charge Sandbox purchase")
                        break
                    }
                }
            }
            if Date() >= nextCapture {
                try XCUIScreen.main.screenshot().pngRepresentation.write(to: directory.appendingPathComponent("sandbox-progress.png"))
                try (app.debugDescription + "\n" + system.debugDescription).write(
                    to: directory.appendingPathComponent("sandbox-progress.txt"), atomically: true, encoding: .utf8)
                nextCapture = Date().addingTimeInterval(20)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
        let completed = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        completed.name = "Sandbox checkout result"
        completed.lifetime = .keepAlways
        add(completed)
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: directory.appendingPathComponent("sandbox-result.png"))
        guard home.exists && home.isHittable && !payment.exists else {
            throw XCTSkip("Checkout opened; completed purchase was not observed")
        }
        // The route's persisted Sandbox entitlement is verified separately;
        // returning home alone is not evidence of renewal or restoration.
        print("MEMO_QA: Checkout returned to Memo home; verify the server entitlement")
    }

    // Run only after a real Sandbox entitlement has been independently verified.
    // The server record is checked again after the UI run; this test never seeds
    // a subscription or substitutes a StoreKit fixture.
    @MainActor func testPreviewRestorePurchasedSubscription() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_COMPLETE_CHECKOUT"] == "1",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires an explicitly verified Sandbox purchase")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        func openSettings() {
            let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
            let active = app.webViews.staticTexts["Apple subscription active"].firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 30))
            // A tap before the page hydrates is dropped; try again rather than fail.
            for _ in 0..<3 where !active.exists {
                if settings.exists { settings.tap() }
                _ = active.waitForExistence(timeout: 12)
            }
            XCTAssertTrue(active.exists)
        }
        openSettings()
        let restore = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch
        XCTAssertTrue(restore.waitForExistence(timeout: 10))
        for _ in 0..<8 where !restore.isHittable { app.webViews.firstMatch.swipeUp() }
        XCTAssertTrue(restore.isHittable)
        keepStudyScreenshot("Purchased Apple subscription before restore", app: app)
        restore.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        // On a device Apple's sync asks the tester for the Apple Account
        // password, so leave time for a person to type it.
        let ready = NSPredicate { _, _ in restore.exists && restore.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: restore)], timeout: 180), .completed)
        XCTAssertFalse(app.webViews.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "Your purchase could not be confirmed yet")).firstMatch.exists)
        XCTAssertTrue(app.webViews.staticTexts["Apple subscription active"].firstMatch.exists)
        keepStudyScreenshot("Purchased Apple subscription after restore", app: app)
        app.terminate()
        app.launch()
        openSettings()
        keepStudyScreenshot("Purchased Apple subscription after relaunch", app: app)
    }

    // A second Memo account on the same Apple Account must not inherit the
    // first account's subscription through Restore. Run only after a verified
    // purchase belongs to a different synthetic account.
    @MainActor func testPreviewRestoreKeepsPurchaseWithItsAccount() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_COMPLETE_CHECKOUT"] == "1",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a purchase owned by another synthetic account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        // Either Restore will do: the launch offer carries one as well as Settings.
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        let restore = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30) || restore.waitForExistence(timeout: 5))
        for _ in 0..<3 where !restore.exists {
            if settings.exists { settings.tap() }
            _ = restore.waitForExistence(timeout: 12)
        }
        let active = app.webViews.staticTexts["Apple subscription active"].firstMatch
        XCTAssertFalse(active.exists, "This account has no purchase of its own")
        for _ in 0..<8 where !restore.isHittable { app.webViews.firstMatch.swipeUp() }
        restore.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        let ready = NSPredicate { _, _ in restore.exists && restore.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: restore)], timeout: 180), .completed)
        keepStudyScreenshot("Restore on another Memo account", app: app)
        XCTAssertFalse(active.exists, "Restore must not move another account's subscription")
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@",
            "belongs to a different Memo account")).firstMatch.waitForExistence(timeout: 5),
            "The reader must learn which account owns the purchase, not be told to retry")
    }

    // A call or the Home button during launch suspends the app, and iOS
    // cancels its loads. Coming back must load Memo, not a connection error.
    @MainActor func testPreviewRecoversWhenLeftDuringLaunch() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging Preview")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        for round in 1...2 {
            app.terminate()
            app.launch()
            RunLoop.current.run(until: Date().addingTimeInterval(round == 1 ? 0.5 : 2))
            XCUIDevice.shared.press(.home)
            RunLoop.current.run(until: Date().addingTimeInterval(40))
            app.activate()
            let loaded = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label IN %@",
                ["Settings", "New note", "Continue with email", "Get started", "Close the subscription offer"])).firstMatch
            let failure = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "could not connect")).firstMatch
            let ok = loaded.waitForExistence(timeout: 30)
            keepStudyScreenshot("Round \(round): back after leaving during launch", app: app)
            XCTAssertTrue(ok && !failure.exists, "Round \(round): Memo must load after returning, not show a connection error")
        }
    }

    // A real Sandbox purchase through a creator code, for the attribution check.
    // Confirms only Apple's explicitly no-charge Sandbox sheet.
    @MainActor func testPreviewPurchaseWithCode() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_COMPLETE_CHECKOUT"] == "1", let code = env["MEMO_QA_PROMO_CODE"],
              let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Explicit Sandbox code purchase only")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        dismissInitialOffer(app)
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        let redeem = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "Redeem a code")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        for _ in 0..<3 where !redeem.exists {
            if settings.exists { settings.tap() }
            _ = redeem.waitForExistence(timeout: 12)
        }
        for _ in 0..<8 where !redeem.isHittable { app.webViews.firstMatch.swipeUp() }
        redeem.tap()
        let field = app.webViews.textFields["Discount code"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20)); field.tap()
        field.typeText(code)
        app.webViews.buttons["Check code"].firstMatch.tap()
        let yearly = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "(elementType == %d OR elementType == %d) AND (label CONTAINS %@ OR label CONTAINS %@)",
            XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue, "64,99", "64.99")).firstMatch
        XCTAssertTrue(yearly.waitForExistence(timeout: 45), "The code must unlock the half-price yearly offer")
        yearly.tap()
        keepStudyScreenshot("Code offer before purchase", app: app)
        let buy = app.webViews.buttons["Continue"].firstMatch
        XCTAssertTrue(buy.waitForExistence(timeout: 10)); buy.tap()
        let deadline = Date().addingTimeInterval(300)
        var confirmed = false
        let home = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
        while Date() < deadline {
            if app.state == .runningForeground && home.exists && home.isHittable { break }
            if !confirmed {
                for process in [app, system] {
                    let notice = process.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "You will not be charged")).firstMatch
                    let subscribe = process.buttons["Subscribe"].firstMatch
                    if notice.exists && subscribe.exists && subscribe.isHittable {
                        let sheet = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                        sheet.name = "Apple's Sandbox sheet for the code offer"
                        sheet.lifetime = .keepAlways
                        add(sheet)
                        subscribe.tap(); confirmed = true; break
                    }
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
        keepStudyScreenshot("After the code purchase", app: app)
        XCTAssertTrue(home.exists, "The purchase must return to Memo's home")
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

    @MainActor func testPreviewStudyNoteFromPublicArticle() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let link = env["MEMO_QA_PUBLIC_ARTICLE"], URL(string: link)?.scheme == "https" else {
            throw XCTSkip("Requires a staging Preview and a public test article")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        let newNote = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        newNote.tap()
        let source = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "link")).firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 15))
        source.tap()
        let input = app.webViews.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        input.tap()
        input.typeText(link)
        let create = app.webViews.buttons["Create the note"].firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 120))
        let content = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "evaporation")).firstMatch
        let deadline = Date().addingTimeInterval(300)
        while Date() < deadline && !content.exists {
            dismissNotificationNudge(app)
            XCTAssertFalse(app.webViews.staticTexts["Processing failed"].exists)
            RunLoop.current.run(until: Date().addingTimeInterval(5))
        }
        XCTAssertTrue(content.exists, "The public water-cycle article must become actual note content")
        dismissNotificationNudge(app)
        keepStudyScreenshot("Note generated from a public article", app: app)
    }

    // End to end on a device: start a note, accept notifications, leave the
    // app, and tap the "ready" notification when it arrives.
    @MainActor func testPreviewPushNotificationOpensNote() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let link = env["MEMO_QA_PUBLIC_ARTICLE"], URL(string: link)?.scheme == "https",
              env["MEMO_QA_PUSH"] == "1" else {
            throw XCTSkip("Requires a device, a staging Preview with APNs and a public article")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        let newNote = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        newNote.tap()
        let source = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "link")).firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 15))
        source.tap()
        let input = app.webViews.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        input.tap()
        input.typeText(link)
        let create = app.webViews.buttons["Create the note"].firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        // Memo's own question comes first; iOS asks only if the reader agrees.
        let notify = app.webViews.buttons["Notify me"].firstMatch
        if notify.waitForExistence(timeout: 45) {
            keepStudyScreenshot("Memo offers to notify when the note is ready", app: app)
            notify.tap()
            let allow = springboard.alerts.buttons["Allow"].firstMatch
            if allow.waitForExistence(timeout: 10) { allow.tap() }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCUIDevice.shared.press(.home)
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "is ready to study")).firstMatch
        let deadline = Date().addingTimeInterval(420)
        var seen = false
        while Date() < deadline {
            if banner.exists { seen = true; break }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        if !seen {
            // A banner shows for a few seconds; the Notification Center keeps it.
            let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.001))
            top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.6)))
            seen = banner.waitForExistence(timeout: 10)
        }
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "Note-ready notification on the device"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertTrue(seen, "The note-ready notification must arrive")
        // A banner slides away within seconds, so open it from the
        // Notification Center, where it stays until it is tapped.
        if !app.wait(for: .runningForeground, timeout: 1) {
            RunLoop.current.run(until: Date().addingTimeInterval(6))
            let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.001))
            top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.6)))
            let stored = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "is ready to study")).firstMatch
            XCTAssertTrue(stored.waitForExistence(timeout: 10), "The notification must stay in the Notification Center")
            // Tap the visible row itself (a label match can be an off-screen
            // copy); several Memo notifications stack and the first tap expands them.
            let row = springboard.buttons.matching(NSPredicate(format: "label CONTAINS %@", "is ready to study")).firstMatch
            for _ in 0..<3 where !app.wait(for: .runningForeground, timeout: 3) {
                if row.exists && row.isHittable { row.tap() }
                else { springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.31)).tap() }
            }
        }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 30), "Tapping it must open the note")
        keepStudyScreenshot("Note opened from its notification", app: app)
    }

    // Simulator: tapping a "notes ready" notification opens that note. The
    // runner injects the push with `simctl push` once the app is in the
    // background; the payload names the note by id, as the server's does.
    @MainActor func testPreviewNotificationTapOpensNoteSimulator() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_PUSH_SIM"] == "1", let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let title = env["MEMO_QA_NOTE_TITLE"], let link = env["MEMO_QA_PUBLIC_ARTICLE"] else {
            throw XCTSkip("Simulator notification tap only")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        // Memo asks about notifications only after a note is started.
        let newNote = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 30)); newNote.tap()
        let source = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "link")).firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 15)); source.tap()
        let input = app.webViews.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 15)); input.tap(); input.typeText(link)
        app.webViews.buttons["Create the note"].firstMatch.tap()
        let notify = app.webViews.buttons["Notify me"].firstMatch
        if notify.waitForExistence(timeout: 45) {
            notify.tap()
            let allow = springboard.alerts.buttons["Allow"].firstMatch
            if allow.waitForExistence(timeout: 10) { allow.tap() }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCUIDevice.shared.press(.home)
        print("MEMO_QA: READY_FOR_PUSH")
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "is ready to study")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 120), "The injected notification must show")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "Notification on the simulator"; shot.lifetime = .keepAlways; add(shot)
        banner.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "Tapping it must bring Memo back")
        let heading = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 30) && heading.waitForExistence(timeout: 10),
                      "Tapping it must open that note")
        keepStudyScreenshot("Note opened from its notification", app: app)
    }

    // The App Store tutor hour offered once the daily time is used up, with
    // StoreKit's own price (local StoreKit configuration, no purchase made).
    @MainActor func testPreviewTutorHourOffer() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_TUTOR_HOUR"] == "1", let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires an out-of-time synthetic subscriber on staging")
        }
        let config = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Offers", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: config)
        session.resetToDefaultState(); session.disableDialogs = true
        session.storefront = "SVN"; session.locale = Locale(identifier: "en_GB")
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        defer { app.terminate() }
        openStudyTab("Tutor", in: app)
        let meter = app.webViews.buttons.matching(NSPredicate(format: "label MATCHES %@", ".*[0-9]+%.*")).firstMatch
        if meter.waitForExistence(timeout: 20) { meter.tap() }
        let offer = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Add an hour for")).firstMatch
        XCTAssertTrue(offer.waitForExistence(timeout: 30), "A subscriber out of time is offered the Apple hour")
        XCTAssertTrue(offer.label.contains("2.00") || offer.label.contains("2,00"), "StoreKit's price, not a typed one: \(offer.label)")
        keepStudyScreenshot("Tutor hour offer (App Store)", app: app)
    }

    // A real Sandbox purchase of the tutor hour on a device. Confirms only
    // Apple's explicitly no-charge Sandbox sheet; the credit is verified on the server.
    @MainActor func testPreviewBuyTutorHour() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_COMPLETE_CHECKOUT"] == "1", env["MEMO_QA_TUTOR_HOUR"] == "1" else {
            throw XCTSkip("Explicit Sandbox tutor-hour purchase only")
        }
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        openStudyTab("Tutor", in: app)
        let meter = app.webViews.buttons.matching(NSPredicate(format: "label MATCHES %@", ".*[0-9]+%.*")).firstMatch
        if meter.waitForExistence(timeout: 20) { meter.tap() }
        let offer = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Add an hour for")).firstMatch
        XCTAssertTrue(offer.waitForExistence(timeout: 30))
        keepStudyScreenshot("Tutor hour offer on the iPhone", app: app)
        offer.tap()
        // A consumable asks for the side button, which only a person can press:
        // capture Apple's sheet, then wait for "You're all set" and dismiss it.
        var sawSheet = false
        var done = false
        let deadline = Date().addingTimeInterval(240)
        while Date() < deadline && !done {
            for process in [app, system] {
                let notice = process.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "You will not be charged")).firstMatch
                if !sawSheet && notice.exists {
                    sawSheet = true
                    let sheet = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    sheet.name = "Apple's Sandbox sheet for the tutor hour"; sheet.lifetime = .keepAlways; add(sheet)
                    print("MEMO_QA: CONFIRM_WITH_SIDE_BUTTON")
                }
                let ok = process.buttons["OK"].firstMatch
                if process.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "You’re all set")).firstMatch.exists
                    || process.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "You're all set")).firstMatch.exists {
                    if ok.exists { ok.tap() }
                    done = true; break
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        XCTAssertTrue(sawSheet, "Apple's Sandbox purchase sheet must appear")
        XCTAssertTrue(done, "The purchase must complete once confirmed")
        // The page reloads once the server has credited the hour.
        let topped = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Topped")).firstMatch
        let end = Date().addingTimeInterval(90)
        while Date() < end && !topped.exists {
            if meter.exists && meter.isHittable && !offer.exists { meter.tap() }
            RunLoop.current.run(until: Date().addingTimeInterval(3))
        }
        keepStudyScreenshot("After buying the tutor hour", app: app)
        XCTAssertTrue(topped.exists, "The bought hour must show as topped-up time")
    }

    // A tap on a "notes ready" notification that launches the app must land on
    // that note, not on the start page loaded right after it.
    @MainActor func testPreviewNotificationLaunchOpensNote() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let lecture = env["MEMO_QA_NOTIFICATION_LECTURE"], let title = env["MEMO_QA_NOTE_TITLE"] else {
            throw XCTSkip("Requires a staging note id")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launchEnvironment["MEMO_QA_NOTIFICATION_LECTURE"] = lecture
        app.launch()
        passConsentGate(app)
        let heading = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        let notes = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Notes", "Zapiski"])).firstMatch
        let opened = notes.waitForExistence(timeout: 40) && heading.waitForExistence(timeout: 10)
        RunLoop.current.run(until: Date().addingTimeInterval(4))
        keepStudyScreenshot("Launched from a note notification", app: app)
        XCTAssertTrue(opened && notes.exists, "The note must open and stay open, not give way to the start page")
    }

    // The reason a server gives for refusing a purchase must reach the paywall.
    // Xcode's local StoreKit completes the purchase; a preview whose Apple
    // billing is not configured refuses it (503), for both Buy and Restore.
    @MainActor func testPreviewPurchaseRefusalShowsReason() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_REFUSAL"] == "1", let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a preview that refuses Apple purchases")
        }
        let config = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Offers", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: config)
        session.resetToDefaultState(); session.clearTransactions(); session.disableDialogs = true
        session.storefront = "SVN"; session.locale = Locale(identifier: "en_GB")
        defer { session.clearTransactions() }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        let pay = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Continue to payment", "Start the 3-day free trial"])).firstMatch
        if !pay.waitForExistence(timeout: 30) {
            let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 20)); settings.tap()
            let choose = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Choose a plan")).firstMatch
            XCTAssertTrue(choose.waitForExistence(timeout: 15))
            for _ in 0..<5 where !choose.isHittable { app.webViews.firstMatch.swipeUp() }
            choose.tap()
        }
        let ready = NSPredicate { _, _ in pay.exists && pay.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 60), .completed)
        pay.tap()
        let reason = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "[server 503")).firstMatch
        let buyShowed = reason.waitForExistence(timeout: 45)
        keepStudyScreenshot("Refused purchase shows its reason", app: app)
        XCTAssertTrue(buyShowed, "A refused purchase must show the server's reason")
        let restore = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch
        if !restore.exists { app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch.tap() } else { restore.tap() }
        RunLoop.current.run(until: Date().addingTimeInterval(8))
        keepStudyScreenshot("Refused restore shows its reason", app: app)
        XCTAssertTrue(reason.waitForExistence(timeout: 30), "A refused restore must show the server's reason")
    }

    // Restore whose App Store sync is cancelled (the Apple sign-in on the
    // simulator) still checks the device's purchases and ends quietly.
    @MainActor func testPreviewRestoreCancelledSyncShowsReason() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_REFUSAL"] == "1", let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires a staging preview and an unpaid synthetic account")
        }
        let app = XCUIApplication()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        let restore = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch
        XCTAssertTrue(restore.waitForExistence(timeout: 40), "The launch offer carries Restore")
        restore.tap()
        // Apple's own sign-in: cancel it, as someone without the password would.
        for process in [springboard, app] {
            let cancel = process.buttons["Cancel"].firstMatch
            if cancel.waitForExistence(timeout: 20) { cancel.tap(); break }
        }
        // A cancel is the reader's choice: Restore ends quietly, with no
        // "could not be confirmed" notice and no reasonless failure.
        RunLoop.current.run(until: Date().addingTimeInterval(8))
        keepStudyScreenshot("Restore with a cancelled App Store sync", app: app)
        let notice = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "could not be confirmed")).firstMatch
        XCTAssertFalse(notice.exists, "Cancelling Apple's sign-in must not report a failure")
        XCTAssertTrue(restore.exists, "The offer stays open for another try")
    }

    // Device, PRODUCTION, the owner's signed-in review account: Restore on an
    // Apple ID whose subscription belongs to another Memo account must say so.
    // Cancels Apple's password sheet; never types a credential.
    @MainActor func testProductionRestoreOtherAccountMessage() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_PROD_RESTORE"] == "1" else {
            throw XCTSkip("Owner-run production check only")
        }
        let app = XCUIApplication()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.launch()
        let restore = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Restore purchases")).firstMatch
        if !restore.waitForExistence(timeout: 30) {
            let newNote = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
            XCTAssertTrue(newNote.waitForExistence(timeout: 20), "Must be signed in on production")
            newNote.tap()
            XCTAssertTrue(restore.waitForExistence(timeout: 20))
        }
        restore.tap()
        for _ in 0..<3 {
            var cancelled = false
            for process in [springboard, app] {
                let cancel = process.buttons["Cancel"].firstMatch
                if cancel.waitForExistence(timeout: 8) { cancel.tap(); cancelled = true; break }
            }
            if !cancelled { break }
        }
        let other = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "belongs to a different Memo account")).firstMatch
        let shown = other.waitForExistence(timeout: 60)
        keepStudyScreenshot("Production Restore on another account's purchase", app: app)
        XCTAssertTrue(shown, "The reader must learn the purchase belongs to another Memo account")
    }

    @MainActor func testPreviewStudyNoteFromPDF() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_PDF"] == "memo-qa-electric-circuits" else {
            throw XCTSkip("Requires an unused synthetic free note and the seeded circuits PDF")
        }
        try importCircuitDocument(fixtureName: "memo-qa-electric-circuits")
    }

    @MainActor func testPreviewStudyNoteFromOfficeDocument() throws {
        guard let fixture = ProcessInfo.processInfo.environment["MEMO_QA_OFFICE"],
              ["memo-qa-circuits-word", "memo-qa-circuits-slides"].contains(fixture) else {
            throw XCTSkip("Requires an unused synthetic free note and a seeded Word or PowerPoint fixture")
        }
        try importCircuitDocument(fixtureName: fixture)
    }

    @MainActor private func importCircuitDocument(fixtureName: String) throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires the shared staging Preview")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        func button(_ label: String) -> XCUIElement {
            app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
        }
        let newNote = button("New note")
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        newNote.tap()
        let documents = button("PDF, document or photo")
        XCTAssertTrue(documents.waitForExistence(timeout: 15))
        documents.tap()
        let choose = button("Choose a file")
        XCTAssertTrue(choose.waitForExistence(timeout: 15))
        choose.tap()
        keepStudyScreenshot("Document source menu", app: app)
        let files = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose File")).firstMatch
        XCTAssertTrue(files.waitForExistence(timeout: 10))
        files.tap()
        let browse = app.buttons["Browse"].firstMatch
        if browse.waitForExistence(timeout: 5) { browse.tap() }
        let local = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "On My iPhone")).firstMatch
        if local.waitForExistence(timeout: 5) { local.tap() }
        keepStudyScreenshot("Native document picker", app: app)
        let pdf = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", fixtureName)).firstMatch
        XCTAssertTrue(pdf.waitForExistence(timeout: 15), "The fixture must be visible in the native Files picker")
        pdf.tap()
        let open = app.buttons["Open"].firstMatch
        if open.waitForExistence(timeout: 3), open.isEnabled { open.tap() }
        let create = button("Create the note")
        XCTAssertTrue(create.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: create)
        waitForExpectations(timeout: 90)
        keepStudyScreenshot("Document attached through the native picker", app: app)
        create.tap()
        XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 120))
        let content = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "resistance")).firstMatch
        let deadline = Date().addingTimeInterval(420)
        while Date() < deadline && !content.exists {
            dismissNotificationNudge(app)
            XCTAssertFalse(app.webViews.staticTexts["Processing failed"].exists)
            RunLoop.current.run(until: Date().addingTimeInterval(5))
        }
        XCTAssertTrue(content.exists, "The document must produce actual electric-circuit notes")
        dismissNotificationNudge(app)
        keepStudyScreenshot("Notes generated from the circuits document", app: app)
    }

    @MainActor func testPreviewStudyNoteFromAudioFile() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              env["MEMO_QA_AUDIO"] == "memo-qa-electric-circuits-audio" else {
            throw XCTSkip("Requires staging, an unused synthetic free note and the seeded synthetic lecture audio")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        passConsentGate(app)
        dismissInitialOffer(app)
        func button(_ label: String) -> XCUIElement {
            app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
        }
        let newNote = button("New note")
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        newNote.tap()
        let documents = button("Upload audio")
        XCTAssertTrue(documents.waitForExistence(timeout: 15))
        documents.tap()
        let choose = button("Choose a file")
        XCTAssertTrue(choose.waitForExistence(timeout: 15))
        choose.tap()
        keepStudyScreenshot("Audio source menu", app: app)
        let files = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose File")).firstMatch
        if files.waitForExistence(timeout: 5) { files.tap() }
        let browse = app.buttons["Browse"].firstMatch
        if browse.waitForExistence(timeout: 5) { browse.tap() }
        let local = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "On My iPhone")).firstMatch
        if local.waitForExistence(timeout: 5) { local.tap() }
        keepStudyScreenshot("Native audio picker", app: app)
        let audio = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "memo-qa-electric-circuits-audio")).firstMatch
        XCTAssertTrue(audio.waitForExistence(timeout: 15), "The fixture must be visible in the native Files picker")
        audio.tap()
        let open = app.buttons["Open"].firstMatch
        if open.waitForExistence(timeout: 3), open.isEnabled { open.tap() }
        let create = button("Create the note")
        XCTAssertTrue(create.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: create)
        waitForExpectations(timeout: 90)
        keepStudyScreenshot("Audio file attached through the native picker", app: app)
        create.tap()
        XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 120))
        let content = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "resistance")).firstMatch
        let deadline = Date().addingTimeInterval(420)
        while Date() < deadline && !content.exists {
            dismissNotificationNudge(app)
            XCTAssertFalse(app.webViews.staticTexts["Processing failed"].exists)
            RunLoop.current.run(until: Date().addingTimeInterval(5))
        }
        XCTAssertTrue(content.exists, "The audio must be transcribed into actual electric-circuit notes")
        dismissNotificationNudge(app)
        keepStudyScreenshot("Notes generated from the audio lecture", app: app)
        openStudyTab("Transcript", in: app)
        let transcript = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "amperes")).firstMatch
        XCTAssertTrue(transcript.waitForExistence(timeout: 30), "The actual source transcription must be readable")
        keepStudyScreenshot("Transcript from the imported audio lecture", app: app)
    }

    /// Real library writes against a retained synthetic Preview account.
    /// Restore the note title and delete the temporary folder through the UI.
    @MainActor func testPreviewLibrarySearchRenameAndFolders() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_LIBRARY_WRITES"] == "1",
              let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires opt-in library writes on the dedicated staging account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        defer { app.terminate() }
        passConsentGate(app)
        dismissInitialOffer(app)
        let original = "Introduction to Electric Circuits"
        let renamed = "Circuits library QA"
        func button(_ text: String) -> XCUIElement {
            app.webViews.buttons.matching(NSPredicate(format: "label == %@", text)).firstMatch
        }
        func tap(_ text: String) {
            let target = button(text)
            XCTAssertTrue(target.waitForExistence(timeout: 20), text)
            target.tap()
        }
        func replace(_ field: XCUIElement, with text: String) {
            XCTAssertTrue(field.waitForExistence(timeout: 15))
            field.tap()
            let old = field.value as? String ?? ""
            if !old.isEmpty && old != field.placeholderValue {
                field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
                app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
            }
            if !text.isEmpty { app.typeText(text) }
            keepStudyScreenshot("Library field edited to \(text)", app: app)
        }
        func noteVisible(_ title: String) -> Bool {
            button("Actions for \(title)").waitForExistence(timeout: 20)
        }
        XCTAssertTrue(noteVisible(original))
        let search = app.webViews.searchFields["Search notes"].firstMatch
        replace(search, with: "Electric")
        XCTAssertTrue(noteVisible(original))
        replace(search, with: "zzqnonexistentlibrary")
        XCTAssertTrue(app.webViews.staticTexts["Try a shorter search term."].waitForExistence(timeout: 15))
        XCTAssertFalse(button("Actions for \(original)").exists)
        keepStudyScreenshot("Library search with no matches", app: app)
        replace(search, with: "")
        app.webViews.staticTexts["My notes"].firstMatch.tap()
        XCTAssertTrue(noteVisible(original))
        tap("Actions for \(original)")
        tap("Rename \(original)")
        replace(app.webViews.textFields["Note title"].firstMatch, with: renamed)
        tap("Save title")
        XCTAssertTrue(noteVisible(renamed))
        app.terminate()
        app.launch()
        dismissInitialOffer(app)
        XCTAssertTrue(noteVisible(renamed), "Renamed note must survive relaunch")
        keepStudyScreenshot("Renamed library note persisted", app: app)
        tap("Actions for \(renamed)")
        tap("Rename \(renamed)")
        replace(app.webViews.textFields["Note title"].firstMatch, with: original)
        tap("Save title")
        XCTAssertTrue(noteVisible(original))

        let allNotes = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "All notes")).firstMatch
        XCTAssertTrue(allNotes.waitForExistence(timeout: 15))
        allNotes.tap()
        tap("New folder")
        replace(app.webViews.textFields["Folder name"].firstMatch, with: "Library QA folder")
        tap("Done")
        let folderChip = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Library QA folder")).firstMatch
        XCTAssertTrue(folderChip.waitForExistence(timeout: 20))
        XCTAssertFalse(button("Actions for \(original)").exists, "New folder starts empty")
        folderChip.tap()
        tap("Options for folder Library QA folder")
        tap("Add lectures")
        let noteCheckbox = app.webViews.switches.matching(NSPredicate(format: "label CONTAINS %@", original)).firstMatch
        XCTAssertTrue(noteCheckbox.waitForExistence(timeout: 15))
        noteCheckbox.tap()
        keepStudyScreenshot("Add a note to its folder", app: app)
        tap("Done")
        XCTAssertTrue(noteVisible(original), "Selected note must appear in the folder")
        folderChip.tap()
        tap("Options for folder Library QA folder")
        tap("Rename folder")
        replace(app.webViews.textFields["Folder name"].firstMatch, with: "Library QA renamed")
        tap("Done")
        app.terminate()
        app.launch()
        dismissInitialOffer(app)
        let renamedChip = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Library QA renamed")).firstMatch
        XCTAssertTrue(renamedChip.waitForExistence(timeout: 25), "Folder rename and selection must persist")
        XCTAssertTrue(noteVisible(original), "Folder membership must survive relaunch")
        keepStudyScreenshot("Renamed folder persisted", app: app)
        renamedChip.tap()
        tap("Options for folder Library QA renamed")
        tap("Add lectures")
        XCTAssertTrue(noteCheckbox.waitForExistence(timeout: 15))
        XCTAssertEqual(noteCheckbox.value as? String, "1")
        noteCheckbox.tap()
        tap("Done")
        XCTAssertTrue(button("Actions for \(original)").waitForNonExistence(timeout: 15))
        renamedChip.tap()
        tap("Options for folder Library QA renamed")
        tap("Add lectures")
        XCTAssertTrue(noteCheckbox.waitForExistence(timeout: 15))
        XCTAssertEqual(noteCheckbox.value as? String, "0")
        noteCheckbox.tap()
        tap("Done")
        XCTAssertTrue(noteVisible(original))
        renamedChip.tap()
        tap("Options for folder Library QA renamed")
        tap("Delete folder")
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "The notes in it stay in All notes.")).firstMatch.waitForExistence(timeout: 10))
        tap("Delete folder")
        XCTAssertTrue(noteVisible(original), "Deleting a folder must preserve the note")
        keepStudyScreenshot("Library restored after folder deletion", app: app)
    }

    @MainActor func testPreviewLiveTutorSessionControls() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_LIVE_TUTOR"] == "1" else {
            throw XCTSkip("Requires an explicitly enabled real staging tutor session")
        }
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        defer { app.terminate() }
        openStudyTab("Tutor", in: app)
        let start = app.webViews.buttons["Start"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 30))
        keepStudyScreenshot("Live tutor before starting", app: app)
        start.tap()
        let explaining = app.webViews.staticTexts["Explaining"].firstMatch
        let connectionDeadline = Date().addingTimeInterval(120)
        while Date() < connectionDeadline && !explaining.exists {
            // WebKit asks after remote credentials arrive, which can be later
            // than the app's initial Start tap on older builds. Handle the real
            // system prompt whenever it appears, including before credentials.
            let permission = app.alerts.buttons["Allow"].firstMatch
            if permission.exists {
                let permissionDelay = min(40, max(0, Double(ProcessInfo.processInfo.environment["MEMO_QA_MIC_PERMISSION_DELAY"] ?? "0") ?? 0))
                if permissionDelay > 0 {
                    keepStudyScreenshot("Microphone permission before reserving tutor time", app: app)
                    RunLoop.current.run(until: Date().addingTimeInterval(permissionDelay))
                }
                permission.tap()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        XCTAssertTrue(explaining.exists, "Real tutor output must start after connection")
        let pause = app.webViews.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        keepStudyScreenshot("Live tutor explaining the imported lecture", app: app)
        pause.tap()
        let paused = app.webViews.staticTexts["Paused"].firstMatch
        XCTAssertTrue(paused.waitForExistence(timeout: 10))
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCTAssertTrue(paused.exists, "The tutor must stay paused")
        let resume = app.webViews.buttons["Continue"].firstMatch
        XCTAssertTrue(resume.isEnabled)
        keepStudyScreenshot("Live tutor paused", app: app)
        resume.tap()
        XCTAssertTrue(explaining.waitForExistence(timeout: 45), "Resuming must restart actual tutor output")
        let end = app.webViews.buttons["End"].firstMatch
        XCTAssertTrue(end.waitForExistence(timeout: 10))
        end.tap()
        XCTAssertTrue(start.waitForExistence(timeout: 15), "Ending must return the tutor to its idle controls")
        XCTAssertFalse(pause.exists)
        keepStudyScreenshot("Live tutor ended", app: app)
    }

    @MainActor func testPreviewSourceAudioPlayback() throws {
        guard ProcessInfo.processInfo.environment["MEMO_QA_AUDIO"] == "memo-qa-electric-circuits-audio" else {
            throw XCTSkip("Requires the retained synthetic audio lecture")
        }
        let app = try openPreviewStudyNote(title: "Introduction to Electric Circuits")
        openStudyTab("Transcript", in: app)
        let play = app.webViews.buttons["Play"].firstMatch
        let pause = app.webViews.buttons["Pause"].firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 30))
        let clock = app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}:[0-9]{2}$")).firstMatch
        func elapsed() -> Int {
            guard clock.exists else { return -1 }
            return clock.label.split(separator: ":").compactMap { Int($0) }.reduce(0) { $0 * 60 + $1 }
        }
        play.tap()
        XCTAssertTrue(pause.waitForExistence(timeout: 20))
        let advanced = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in elapsed() >= 3 }, object: clock)
        XCTAssertEqual(XCTWaiter.wait(for: [advanced], timeout: 30), .completed)
        pause.tap()
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        let pausedAt = elapsed()
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCTAssertLessThanOrEqual(abs(elapsed() - pausedAt), 1, "Pause must stop the source recording")
        app.webViews.buttons["Forward 10 seconds"].firstMatch.tap()
        XCTAssertLessThanOrEqual(abs(elapsed() - pausedAt - 10), 1)
        app.webViews.buttons["Back 10 seconds"].firstMatch.tap()
        XCTAssertLessThanOrEqual(abs(elapsed() - pausedAt), 1)
        app.webViews.buttons["Playback speed"].firstMatch.tap()
        keepStudyScreenshot("Source audio played, paused, skipped and changed speed", app: app)
    }

    @MainActor func testPreviewWithdrawAndRestoreAIConsent() throws {
        let env = ProcessInfo.processInfo.environment
        guard let preview = env["MEMO_IOS_URL"], URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], email.hasSuffix("@example.com") else {
            throw XCTSkip("Requires a signed-in synthetic account on staging")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        dismissInitialOffer(app)
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        settings.tap()
        XCTAssertTrue(app.webViews.staticTexts[email].firstMatch.waitForExistence(timeout: 15))
        let withdraw = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Withdraw AI permission")).firstMatch
        for _ in 0..<12 {
            if withdraw.exists && withdraw.isHittable { break }
            let window = app.windows.firstMatch
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).press(
                forDuration: 0.1,
                thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)),
                withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(withdraw.isHittable)
        withdraw.tap()
        let confirm = app.webViews.buttons["Withdraw permission"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        let allow = app.webViews.buttons["Allow AI processing"].firstMatch
        XCTAssertTrue(allow.waitForExistence(timeout: 30))
        app.terminate()
        app.launch()
        XCTAssertTrue(allow.waitForExistence(timeout: 30), "Withdrawal must survive relaunch")
        XCTAssertFalse(app.webViews.buttons["New note"].exists)
        keepStudyScreenshot("AI permission withdrawn and retained after relaunch", app: app)
        allow.tap()
        dismissInitialOffer(app)
        let newNote = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 30), "Explicit permission must restore study access")
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
        // Return home before opening Settings in the portrait layout.
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
        // The sheet closes with its ✕ ("Close"); "Cancel" was the old label.
        let cancel = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Close"])).firstMatch
        let sheet = app.webViews.buttons.matching(contains("Record audio")).firstMatch
        if sheet.waitForExistence(timeout: 10) && cancel.exists {
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

    /// Run only on the dedicated simulator after simctl revokes microphone access.
    @MainActor func testPreviewMicrophoneDenied() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_MIC_DENIED"] == "1",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true,
              let email = env["MEMO_QA_EMAIL"], let code = env["MEMO_QA_CODE"] else {
            throw XCTSkip("Requires denied microphone access on the isolated staging simulator")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        defer { app.terminate() }
        passConsentGate(app)
        completeOnboarding(app)
        signInWithCode(app, email: email, code: code)
        dismissInitialOffer(app)
        func button(_ english: String, _ slovenian: String) -> XCUIElement {
            app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", english, slovenian)).firstMatch
        }
        let newNote = button("New note", "Nov zapisek")
        XCTAssertTrue(newNote.waitForExistence(timeout: 30))
        newNote.tap()
        let record = button("Record audio", "Posnemi zvok")
        XCTAssertTrue(record.waitForExistence(timeout: 15))
        record.tap()
        let start = button("Start recording", "Začni snemanje")
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        start.tap()
        let help = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "iOS Settings", "Nastavitvah iOS")).firstMatch
        XCTAssertTrue(help.waitForExistence(timeout: 15), "Denied access must explain where to enable the microphone")
        XCTAssertTrue(start.isEnabled, "Denied access must release the busy state")
        XCTAssertFalse(button("Resume recording", "Nadaljuj snemanje").exists)
        keepStudyScreenshot("Microphone denied with recovery instructions", app: app)
        button("Cancel", "Prekliči").tap()
        XCTAssertTrue(newNote.waitForExistence(timeout: 15), "A denial must leave the app usable")
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

        if env["MEMO_QA_SIRI_INTERRUPTION"] == "1" {
            // Ask a read-only system question: no call, message, reminder or
            // settings mutation. Exercise a real competing audio session.
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: "What time is it?")
            RunLoop.current.run(until: Date().addingTimeInterval(6))
            app.activate()
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(elapsed()), before,
                                        "A Siri interruption must not discard the take")
            if resume.waitForExistence(timeout: 5) {
                let interruptedAt = try XCTUnwrap(elapsed())
                RunLoop.current.run(until: Date().addingTimeInterval(3))
                XCTAssertLessThanOrEqual(try XCTUnwrap(elapsed()) - interruptedAt, 1,
                                        "An interrupted recording must stay paused until resumed")
                snap("Siri interruption left the recording safely paused")
                resume.tap()
            }
            XCTAssertTrue(webButton("Pause", "Začasno ustavi").waitForExistence(timeout: 10))
            let restoredAt = try XCTUnwrap(elapsed())
            let advancing = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                (elapsed() ?? 0) >= restoredAt + 2
            }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [advancing], timeout: 15), .completed,
                           "Recording must advance after Siri releases the audio session")
            snap("Recording recovered after Siri")
            before = try XCTUnwrap(elapsed())
        }

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

        if env["MEMO_QA_UPLOAD_RECORDING"] == "1" {
            // The audio check: upload this take so its transcript can be read
            // back and compared with what was spoken next to the phone.
            let create = app.webViews.buttons.matching(
                NSPredicate(format: "label == %@ OR label == %@", "Create the note", "Create")).firstMatch
            XCTAssertTrue(create.waitForExistence(timeout: 10))
            create.tap()
            XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 120),
                          "The uploaded recording must open as a note")
            snap("L5 Recording uploaded")
            return
        }
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
        let language = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Language", "Jezik")).firstMatch
        // A tap before the page hydrates is dropped; try again rather than fail.
        for _ in 0..<3 where !language.exists {
            if settings.exists { settings.tap() }
            _ = language.waitForExistence(timeout: 12)
        }
        XCTAssertTrue(language.exists)
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

    // Uses the existing isolated PDF account, normal Settings picker and real
    // server refresh. No injected locale, fabricated session or native bridge.
    @MainActor func testPreviewAllSettingsLanguagesPersist() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_EMAIL"] == "ios-pdf-20260922@example.com",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires the signed-in synthetic PDF account on staging")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        defer { app.terminate() }
        // A new preview host has no session cookie yet: sign in the same
        // synthetic account rather than depending on an earlier run.
        let signedIn = app.webViews.links.matching(NSPredicate(
            format: "label MATCHES %@", "(Settings|Nastavitve|Postavke|Podešavanja).*")).firstMatch
        if !signedIn.waitForExistence(timeout: 15), let code = env["MEMO_QA_CODE"] {
            completeOnboarding(app)
            XCTAssertTrue(signInWithCode(app, email: "ios-pdf-20260922@example.com", code: code))
            completeOnboarding(app)
        }
        passConsentGate(app)
        dismissInitialOffer(app)
        let settingsNames = ["Settings", "Nastavitve", "Postavke", "Podešavanja"]
        func openSettings() {
            // This unpaid fixture sees the normal offer again after cold launch.
            let close = app.webViews.buttons.matching(NSPredicate(format: "label IN %@",
                ["Close the subscription offer", "Zapri ponudbo naročnine", "Zatvori ponudu pretplate"])).firstMatch
            if close.waitForExistence(timeout: 8) {
                for _ in 0..<4 where close.exists {
                    close.tap()
                    RunLoop.current.run(until: Date().addingTimeInterval(2))
                }
            }
            let link = app.webViews.links.matching(NSPredicate(
                format: "label MATCHES %@", "(Settings|Nastavitve|Postavke|Podešavanja).*"
            )).firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 30)); link.tap()
            XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(
                format: "label IN %@", settingsNames)).firstMatch.waitForExistence(timeout: 15))
        }
        func languageRow() -> XCUIElement {
            let row = app.webViews.buttons.matching(NSPredicate(
                format: "label CONTAINS %@ OR label CONTAINS %@", "Language", "Jezik"
            )).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            for _ in 0..<7 where !row.isHittable { app.webViews.firstMatch.swipeUp() }
            XCTAssertTrue(row.isHittable)
            return row
        }
        openSettings()
        for (locale, title, redeem, field) in [
            ("Slovenščina", "Nastavitve", "Unovči kodo", "Koda za popust"),
            ("Hrvatski", "Postavke", "Iskoristi kod", "Kod za popust"),
            ("Bosanski", "Postavke", "Iskoristi kod", "Kod za popust"),
            ("Srpski", "Podešavanja", "Iskoristi kod", "Kod za popust"),
            ("English", "Settings", "Redeem a code", "Discount code")
        ] {
            languageRow().tap()
            let option = app.webViews.descendants(matching: .any).matching(NSPredicate(
                format: "label == %@", locale))
            XCTAssertTrue(option.firstMatch.waitForExistence(timeout: 10))
            // Last exact match is the option, not the existing row subtitle.
            option.allElementsBoundByIndex.last!.tap()
            let row = languageRow()
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            let applied = NSPredicate { _, _ in row.label.contains(locale) }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: applied, object: row)], timeout: 20), .completed)
            app.terminate(); app.launch()
            openSettings()
            XCTAssertTrue(app.webViews.staticTexts[title].exists)
            XCTAssertTrue(languageRow().label.contains(locale), "Language must survive relaunch: \(locale)")
            keepStudyScreenshot("Settings language persists — \(locale)", app: app)
            let redeemLink = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", redeem)).firstMatch
            XCTAssertTrue(redeemLink.exists)
            for _ in 0..<7 where !redeemLink.isHittable { app.webViews.firstMatch.swipeUp() }
            redeemLink.tap()
            XCTAssertTrue(app.webViews.textFields[field].waitForExistence(timeout: 20))
            keepStudyScreenshot("Apple code form translated — \(locale)", app: app)
            let back = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Back", "Nazaj", "Natrag", "Nazad"])).firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 10)); back.tap()
        }
    }

    // A reviewer may force-quit seconds after changing a setting. Each round
    // switches language, kills the app about two seconds later and checks the
    // relaunch is still signed in and in the chosen language.
    @MainActor func testPreviewRelaunchRightAfterLanguageChange() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_EMAIL"] == "ios-pdf-20260922@example.com",
              let preview = env["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires the signed-in synthetic PDF account on staging")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        var problems: [String] = []
        func settingsLink() -> XCUIElement {
            app.webViews.links.matching(NSPredicate(
                format: "label MATCHES %@", "(Settings|Nastavitve|Postavke|Podešavanja).*")).firstMatch
        }
        func reachSettings() -> Bool {
            let close = app.webViews.buttons.matching(NSPredicate(format: "label IN %@",
                ["Close the subscription offer", "Zapri ponudbo naročnine", "Zatvori ponudu pretplate"])).firstMatch
            if close.waitForExistence(timeout: 10) { close.tap() }
            guard settingsLink().waitForExistence(timeout: 30) else { return false }
            settingsLink().tap()
            return app.webViews.staticTexts.matching(NSPredicate(format: "label IN %@",
                ["Settings", "Nastavitve", "Postavke", "Podešavanja"])).firstMatch.waitForExistence(timeout: 15)
        }
        app.launch()
        passConsentGate(app)
        guard reachSettings() else { return XCTFail("Settings must open at the start") }
        for (round, language) in ["Slovenščina", "English", "Srpski", "English", "Hrvatski", "English", "Bosanski", "English", "Srpski", "English"].enumerated() {
            let row = app.webViews.buttons.matching(NSPredicate(
                format: "label CONTAINS %@ OR label CONTAINS %@", "Language", "Jezik")).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            for _ in 0..<7 where !row.isHittable { app.webViews.firstMatch.swipeUp() }
            row.tap()
            let option = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", language))
            XCTAssertTrue(option.firstMatch.waitForExistence(timeout: 10))
            option.allElementsBoundByIndex.last!.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(2))
            app.terminate()
            app.launch()
            let title = ["English": "Settings", "Slovenščina": "Nastavitve", "Hrvatski": "Postavke", "Bosanski": "Postavke", "Srpski": "Podešavanja"][language]!
            if !reachSettings() {
                keepStudyScreenshot("Round \(round + 1): relaunch after choosing \(language)", app: app)
                problems.append("round \(round + 1) (\(language)): relaunch did not reach Settings")
                app.terminate(); app.launch()
                guard reachSettings() else { problems.append("second relaunch also failed"); break }
            } else if !app.webViews.staticTexts[title].exists {
                problems.append("round \(round + 1): language is not \(language) after relaunch")
            }
        }
        XCTAssertTrue(problems.isEmpty, "Relaunch problems:\n" + problems.joined(separator: "\n"))
    }

    // Opens each remaining settings row (sheets, native prompts and in-app
    // pages) and gets back to Settings, relaunching if the way back is lost.
    @MainActor func testAppleDiscountCodePrices() throws {
        let env = ProcessInfo.processInfo.environment
        guard let origin = env["MEMO_CODE_QA_URL"], let host = URL(string: origin)?.host,
              host == "localhost" || host.hasSuffix(".vercel.app"),
              let email = env["MEMO_QA_EMAIL"], email == "ios-pdf-20260922@example.com",
              let code = env["MEMO_QA_CODE"] else {
            throw XCTSkip("Requires the isolated staging PDF account and code-enabled server")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = origin
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        // The isolated simulator may retain a different synthetic study login.
        // Switch through Settings so this test cannot accidentally reuse a paid account.
        let previousSettings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Settings", "Nastavitve")).firstMatch
        if previousSettings.waitForExistence(timeout: 15) {
            previousSettings.tap()
            let signOut = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Sign out", "Odjava"])).firstMatch
            XCTAssertTrue(signOut.waitForExistence(timeout: 15))
            for _ in 0..<8 where !signOut.isHittable { app.webViews.firstMatch.swipeUp() }
            signOut.tap()
            let confirm = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Sign out", "Odjava"]))
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            confirm.element(boundBy: confirm.count - 1).tap()
        }
        completeOnboarding(app)
        _ = signInWithCode(app, email: email, code: code)
        passConsentGate(app)
        dismissInitialOffer(app)
        let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Settings", "Nastavitve")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 30)); settings.tap()
        let redeem = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Redeem", "Unovči")).firstMatch
        XCTAssertTrue(redeem.waitForExistence(timeout: 20))
        for _ in 0..<8 where !redeem.isHittable { app.webViews.firstMatch.swipeUp() }
        redeem.tap()
        let field = app.webViews.textFields.matching(NSPredicate(format: "label IN %@", ["Discount code", "Koda za popust"])).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20)); field.tap()
        field.typeText("INVALID_MEMO_QA")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(field.frame.maxY, app.keyboards.firstMatch.frame.minY - 10)
        let check = app.webViews.buttons.matching(NSPredicate(format: "label IN %@", ["Check code", "Preveri kodo"])).firstMatch
        check.tap()
        let invalid = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "This code or offer is not available", "Ta koda ali ponudba ni na voljo")).firstMatch
        XCTAssertTrue(invalid.waitForExistence(timeout: 30))
        field.tap()
        field.press(forDuration: 1.2)
        let selectAllButton = app.buttons["Select All"].firstMatch
        let selectAllMenu = app.menuItems["Select All"].firstMatch
        let selectAll = selectAllButton.waitForExistence(timeout: 5) ? selectAllButton : selectAllMenu
        XCTAssertTrue(selectAll.waitForExistence(timeout: 5)); selectAll.tap()
        field.typeText("MEMO50")
        XCTAssertEqual(field.value as? String, "MEMO50")
        check.tap()
        // WebKit exposes aria-pressed plan buttons as a single accessible
        // button/switch, with both prices in its label rather than StaticText.
        let plans = app.webViews.descendants(matching: .any).matching(NSPredicate(
            format: "elementType IN %@",
            [XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue]))
        let yearly = plans.matching(NSPredicate(format: "(label CONTAINS %@ OR label CONTAINS %@) AND (label CONTAINS %@ OR label CONTAINS %@)", "64.99", "64,99", "129.99", "129,99")).firstMatch
        XCTAssertTrue(yearly.waitForExistence(timeout: 45), "The actual StoreKit first-year and renewal prices must both appear")
        let monthly = plans.matching(NSPredicate(format: "(label CONTAINS %@ OR label CONTAINS %@) AND (label CONTAINS %@ OR label CONTAINS %@)", "9.99", "9,99", "19.99", "19,99")).firstMatch
        XCTAssertTrue(monthly.exists)
        // Inspect prices only. This test must never confirm a paid subscription.
        keepStudyScreenshot("Verified code with actual Apple prices", app: app)
    }

    @MainActor func testPreviewKeyboardEverywhere() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires the signed-in synthetic staging account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        defer { app.terminate() }
        passConsentGate(app)
        let signIn = app.webViews.buttons.matching(NSPredicate(
            format: "label IN %@", ["Continue with email", "Nadaljuj z e-pošto"])).firstMatch
        if signIn.exists {
            let env = ProcessInfo.processInfo.environment
            guard env["MEMO_QA_EMAIL"] == "ios-word-20260922@example.com",
                  let code = env["MEMO_QA_CODE"] else {
                return XCTFail("A signed-out device needs the synthetic Word account credentials")
            }
            XCTAssertTrue(signInWithCode(app, email: "ios-word-20260922@example.com", code: code))
            passConsentGate(app)
        }
        dismissInitialOffer(app)
        func button(_ label: String) -> XCUIElement { app.webViews.buttons[label].firstMatch }
        func checkField(_ field: XCUIElement, name: String, composer: Bool = false) {
            XCTAssertTrue(field.waitForExistence(timeout: 20), name)
            field.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), name)
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            let gap = app.keyboards.firstMatch.frame.minY - field.frame.maxY
            XCTAssertGreaterThanOrEqual(gap, 10, "\(name) must clear the keyboard")
            if composer { XCTAssertLessThan(gap, 80, "\(name) must remain beside the keyboard") }
            keepStudyScreenshot(name, app: app)
        }
        let search = app.webViews.searchFields["Search notes"].firstMatch
        checkField(search, name: "Home search above keyboard")
        app.webViews.staticTexts["My notes"].firstMatch.tap()
        let original = "Introduction to Electric Circuits"
        button("Actions for \(original)").tap()
        button("Rename \(original)").tap()
        checkField(app.webViews.textFields["Note title"].firstMatch, name: "Rename sheet above keyboard")
        button("Cancel").tap()
        button("Chat with your notes").tap()
        checkField(app.webViews.textFields["Ask anything about your notes"].firstMatch, name: "Library chat above keyboard", composer: true)
        let close = button("Close")
        XCTAssertTrue(close.isHittable)
        close.tap()
        let note = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", original)).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 20))
        note.tap()
        let chat = button("Chat about this note")
        XCTAssertTrue(chat.waitForExistence(timeout: 30))
        chat.tap()
        checkField(app.webViews.textFields["Type your question"].firstMatch, name: "Note chat above keyboard", composer: true)
        XCTAssertTrue(button("Close").isHittable)
        button("Close").tap()
        XCTAssertTrue(chat.waitForExistence(timeout: 20))
    }

    @MainActor func testPreviewAnalyticsChoice() throws {
        guard let preview = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
              URL(string: preview)?.host?.hasSuffix(".vercel.app") == true else {
            throw XCTSkip("Requires the dedicated signed-in staging account")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = preview
        app.launch()
        defer { app.terminate() }
        func openChoice() -> XCUIElement {
            passConsentGate(app)
            dismissInitialOffer(app)
            let settings = app.webViews.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 30))
            settings.tap()
            let row = app.webViews.otherElements.matching(NSPredicate(format: "label CONTAINS %@", "Optional analytics")).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 20))
            for _ in 0..<7 where !row.isHittable { app.webViews.firstMatch.swipeUp() }
            keepStudyScreenshot("Optional analytics fits the Settings list", app: app)
            row.tap()
            let choice = app.webViews.switches["Optional analytics"]
            XCTAssertTrue(choice.waitForExistence(timeout: 20))
            for _ in 0..<7 where !choice.isHittable { app.webViews.firstMatch.swipeUp() }
            XCTAssertTrue(choice.isHittable)
            return choice
        }
        let choice = openChoice()
        let originallyEnabled = choice.value as? String == "1"
        // Browser tests cover the fresh default. This device may already hold
        // the owner's explicit choice, which must survive our verification.
        if originallyEnabled { choice.tap() }
        XCTAssertEqual(choice.value as? String, "0")
        keepStudyScreenshot("Optional analytics disabled", app: app)
        choice.tap()
        XCTAssertEqual(choice.value as? String, "1")
        app.webViews.buttons["Done"].tap()
        XCUIDevice.shared.press(.home)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        app.terminate(); app.launch()
        let persisted = openChoice()
        XCTAssertEqual(persisted.value as? String, "1", "Consent must survive relaunch")
        persisted.tap()
        XCTAssertEqual(persisted.value as? String, "0")
        keepStudyScreenshot("Optional analytics withdrawn", app: app)
        app.webViews.buttons["Done"].tap()
        XCUIDevice.shared.press(.home)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        app.terminate(); app.launch()
        let finalChoice = openChoice()
        XCTAssertEqual(finalChoice.value as? String, "0", "Withdrawal must survive relaunch")
        if originallyEnabled && ProcessInfo.processInfo.environment["MEMO_QA_ANALYTICS_RESTORE_OFF"] != "1" {
            finalChoice.tap()
        }
    }

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
            dismissInitialOffer(app)
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
            // Rows above the last one visited (Sign out sits near the top) need the other way.
            for _ in 0..<10 where !reached { app.webViews.firstMatch.swipeDown(); settle(0.4); reached = element.exists && element.isHittable }
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
        dismissInitialOffer(app)
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
        // The redeem article is now the Apple code form itself.
        let appleHelp = app.webViews.textFields["Discount code"].firstMatch
        XCTAssertTrue(appleHelp.waitForExistence(timeout: 15))
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "cancel it in your Apple")).firstMatch.exists
            || app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Apple")).firstMatch.exists,
            "The code form must describe Apple billing")
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

    @MainActor func testLocalOfflineColdLaunch() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["MEMO_QA_OFFLINE_PROXY"] == "https://localhost:3459",
              let token = env["MEMO_QA_OFFLINE_CONTROL"],
              let email = env["MEMO_QA_EMAIL"], email == "ios-word-20260922@example.com",
              let code = env["MEMO_QA_CODE"] else {
            throw XCTSkip("Requires the isolated TLS proxy and synthetic staging account")
        }
        continueAfterFailure = false
        let origin = "https://localhost:3459"
        func connection(_ offline: Bool) async throws {
            var request = URLRequest(url: URL(string: origin + "/__qa_network")!)
            request.setValue(token, forHTTPHeaderField: "X-Memo-QA-Control")
            request.setValue(offline ? "1" : "0", forHTTPHeaderField: "X-Memo-QA-Offline")
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = origin
        try await connection(false)
        do {
            app.launch()
            completeOnboarding(app)
            _ = signInWithCode(app, email: email, code: code)
            passConsentGate(app)
            completeOnboarding(app)
            dismissInitialOffer(app)
            let note = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Introduction to Electric Circuits")).firstMatch
            XCTAssertTrue(note.waitForExistence(timeout: 60))
            note.tap()
            XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 30))
            // Allow the real service worker to cache the shell and build assets.
            try await Task.sleep(nanoseconds: 20_000_000_000)
            try await connection(true)
            app.terminate()
            app.launch()
            XCTAssertTrue(note.waitForExistence(timeout: 45), "A cold launch must recover the cached library at the native entry URL")
            keepStudyScreenshot("Offline cold launch opens the saved library", app: app)
            note.tap()
            XCTAssertTrue(app.webViews.buttons["Notes"].firstMatch.waitForExistence(timeout: 30))
            XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "resistance")).firstMatch.exists)
            keepStudyScreenshot("Cached note remains readable offline", app: app)
            openStudyTab("Tutor", in: app)
            XCTAssertTrue(app.webViews.staticTexts["The walkthrough needs a connection"].firstMatch.waitForExistence(timeout: 15))
            openStudyTab("Podcast", in: app)
            XCTAssertTrue(app.webViews.staticTexts["The episode needs a connection"].firstMatch.waitForExistence(timeout: 15))
            keepStudyScreenshot("Live features explain the missing connection", app: app)
            try await connection(false)
            app.terminate()
            app.launch()
            let newNote = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New note")).firstMatch
            XCTAssertTrue(newNote.waitForExistence(timeout: 45))
            newNote.tap()
            XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Record audio")).firstMatch.waitForExistence(timeout: 15), "Reconnection must restore normal paid-account creation")
            keepStudyScreenshot("Online creation returns after reconnecting", app: app)
            app.terminate()
        } catch {
            try? await connection(false)
            app.terminate()
            throw error
        }
    }

    @MainActor func testLocalOnboardingKeyboard() throws {
        guard let origin = ProcessInfo.processInfo.environment["MEMO_KEYBOARD_QA_URL"],
              URL(string: origin)?.host == "localhost" else {
            throw XCTSkip("Requires the task's local Next server")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = origin
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        completeOnboarding(app, verifyKeyboard: true)
    }

    /// Runs the shared sheet controller against a real UIKit keyboard. The
    /// local fixture saves per-frame geometry for show, field switch and hide.
    @MainActor func testLocalKeyboardMotion() throws {
        guard let origin = ProcessInfo.processInfo.environment["MEMO_KEYBOARD_QA_URL"],
              URL(string: origin)?.host == "localhost" else {
            throw XCTSkip("Start scripts/ios/keyboard-motion-fixture.mjs")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["MEMO_IOS_URL"] = origin
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let first = app.webViews.textFields["First field"]
        XCTAssertTrue(first.waitForExistence(timeout: 30))
        for cycle in 0..<3 {
            first.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            first.typeText("Memo")
            let second = app.webViews.textViews["Second field"]
            second.tap()
            second.typeText("Keyboard motion")
            XCTAssertLessThan(second.frame.maxY, app.keyboards.firstMatch.frame.minY)
            keepStudyScreenshot("Keyboard motion cycle \(cycle)", app: app)
            app.webViews.buttons["Dismiss keyboard"].tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
            waitForExpectations(timeout: 10)
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
        keepStudyScreenshot("Keyboard dismissed", app: app)
        app.webViews.links["Chat composer"].tap()
        let chat = app.webViews.textFields["Ask Memo"]
        XCTAssertTrue(chat.waitForExistence(timeout: 15))
        for _ in 0..<3 {
            chat.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            chat.typeText("Synthetic question")
            let gap = app.keyboards.firstMatch.frame.minY - chat.frame.maxY
            XCTAssertGreaterThanOrEqual(gap, 10)
            XCTAssertLessThan(gap, 60, "The composer must stay next to the keyboard")
            keepStudyScreenshot("Chat composer above keyboard", app: app)
            app.webViews.buttons["Dismiss keyboard"].tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
            waitForExpectations(timeout: 10)
            RunLoop.current.run(until: Date().addingTimeInterval(2))
        }
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
