import XCTest

@testable import MemoWeb

final class RecordingSessionTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    private func at(_ seconds: TimeInterval) -> Date {
        t0.addingTimeInterval(seconds)
    }

    func testElapsedRunsWhileRecording() {
        var session = RecordingSession()
        session.start(at: t0)

        XCTAssertEqual(session.elapsed(at: at(0)), 0)
        XCTAssertEqual(session.elapsed(at: at(30)), 30)
        XCTAssertFalse(session.isPaused)
    }

    func testPauseFreezesElapsed() {
        var session = RecordingSession()
        session.start(at: t0)
        session.pause(at: at(30))

        XCTAssertTrue(session.isPaused)
        // Time passing while paused must not accumulate.
        XCTAssertEqual(session.elapsed(at: at(30)), 30)
        XCTAssertEqual(session.elapsed(at: at(90)), 30)
    }

    func testResumeContinuesFromWhereItStopped() {
        var session = RecordingSession()
        session.start(at: t0)
        session.pause(at: at(30))
        session.resume(at: at(90))

        XCTAssertFalse(session.isPaused)
        XCTAssertEqual(session.elapsed(at: at(90)), 30)
        XCTAssertEqual(session.elapsed(at: at(100)), 40)
    }

    func testRepeatedPausesAccumulate() {
        var session = RecordingSession()
        session.start(at: t0)
        session.pause(at: at(10))   // 10 banked
        session.resume(at: at(20))
        session.pause(at: at(35))   // 25 banked
        session.resume(at: at(50))

        XCTAssertEqual(session.elapsed(at: at(55)), 30)
    }

    func testRedundantTransitionsAreIgnored() {
        var session = RecordingSession()
        session.start(at: t0)

        // A duplicate capture-state notification must not double-count or reset the clock.
        session.resume(at: at(10))
        XCTAssertEqual(session.elapsed(at: at(20)), 20)

        session.pause(at: at(20))
        session.pause(at: at(40))
        XCTAssertEqual(session.elapsed(at: at(40)), 20)
    }

    func testRestartClearsPreviousSession() {
        var session = RecordingSession()
        session.start(at: t0)
        session.pause(at: at(60))

        session.start(at: at(100))
        XCTAssertEqual(session.elapsed(at: at(110)), 10)
    }

    func testClockGoingBackwardsCannotProduceNegativeElapsed() {
        // Device clock changes and NTP corrections should never render as a negative timer.
        var session = RecordingSession()
        session.start(at: at(100))

        XCTAssertEqual(session.elapsed(at: at(40)), 0)
    }
}
