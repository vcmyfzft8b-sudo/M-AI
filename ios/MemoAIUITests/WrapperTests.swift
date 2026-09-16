import XCTest

final class WrapperTests: XCTestCase {
    /// A signed-in synthetic account that withdrew AI permission meets the
    /// consent gate at launch; allow it again (retrying until React hydrates).
    @MainActor private func passConsentGate(_ app: XCUIApplication) {
        let allow = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Allow AI processing", "Dovoli obdelavo")).firstMatch
        guard allow.waitForExistence(timeout: 8) else { return }
        for _ in 0..<4 where allow.exists {
            allow.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(6))
        }
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
        let passwordLink = app.webViews.links.matching(either("Sign in with a password", "Prijava z geslom")).firstMatch
        // The button works only once React has hydrated; retry a few times.
        for _ in 0..<4 where !passwordLink.exists {
            emailButton.tap()
            _ = passwordLink.waitForExistence(timeout: 6)
        }
        XCTAssertTrue(passwordLink.exists, "Continue with email must open the email entry page")
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
        let submit = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "sign in", "prijav")).firstMatch
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
        row("Share", "Share Memo") { settle(2); snap("After Share"); let cancel = app.buttons["Cancel"]; if cancel.exists { cancel.tap() } }
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
