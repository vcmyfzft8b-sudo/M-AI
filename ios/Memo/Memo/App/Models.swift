import Foundation
import StoreKit
import SwiftUI

enum LectureStatus: String, Codable, CaseIterable, Identifiable {
    case uploading
    case queued
    case transcribing
    case generatingNotes = "generating_notes"
    case ready
    case failed

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .uploading: "Uploading"
        case .queued: "Queued"
        case .transcribing: "Transcribing"
        case .generatingNotes: "Generating notes"
        case .ready: "Ready"
        case .failed: "Failed"
        }
    }

    var tint: Color {
        switch self {
        case .ready: .green
        case .failed: .red
        case .queued, .uploading: .orange
        case .transcribing, .generatingNotes: .blue
        }
    }
}

enum LectureSourceType: String, Codable, CaseIterable, Identifiable {
    case audio
    case text
    case pdf
    case link
    case scan
    case manual

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .audio: "Audio"
        case .text: "Text"
        case .pdf: "PDF"
        case .link: "Link"
        case .scan: "Scan"
        case .manual: "Manual"
        }
    }
}

enum AccessTier: String, Codable {
    case paid
    case trial
}

enum BillingPlan: String, Codable, CaseIterable, Identifiable {
    case weekly
    case monthly
    case yearly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }
}

struct MemoSession: Codable, Equatable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String
    let expiresAt: Date
    let user: MemoUser

    var needsRefresh: Bool {
        expiresAt.timeIntervalSinceNow < 300
    }
}

struct MemoUser: Codable, Equatable, Identifiable {
    let id: String
    let email: String?
}

struct SupabaseSessionResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String
    let expiresIn: Int
    let user: SupabaseUser?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case user
    }

    func asMemoSession() -> MemoSession {
        MemoSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            tokenType: tokenType,
            expiresAt: Date().addingTimeInterval(TimeInterval(expiresIn)),
            user: MemoUser(id: user?.id ?? "", email: user?.email)
        )
    }
}

struct SupabaseUser: Codable {
    let id: String
    let email: String?
}

struct ProfileRow: Codable, Equatable, Identifiable {
    let id: String
    let email: String?
    let fullName: String?
    let onboardingCompletedAt: String?
    let ageRange: String?
    let educationLevel: String?
    let currentAverageGrade: String?
    let targetGrade: String?
    let studyGoal: String?
    let trialLectureId: String?
    let trialConsumedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case fullName = "full_name"
        case onboardingCompletedAt = "onboarding_completed_at"
        case ageRange = "age_range"
        case educationLevel = "education_level"
        case currentAverageGrade = "current_average_grade"
        case targetGrade = "target_grade"
        case studyGoal = "study_goal"
        case trialLectureId = "trial_lecture_id"
        case trialConsumedAt = "trial_consumed_at"
    }
}

struct BillingSubscriptionRow: Codable, Equatable, Identifiable {
    let id: String
    let plan: BillingPlan
    let status: String
    let currentPeriodEnd: String?
    let cancelAtPeriodEnd: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case plan
        case status
        case currentPeriodEnd = "current_period_end"
        case cancelAtPeriodEnd = "cancel_at_period_end"
    }

    var isActive: Bool {
        ["active", "trialing", "past_due"].contains(status)
    }
}

struct LectureRow: Codable, Equatable, Hashable, Identifiable {
    let id: String
    let userId: String?
    let title: String?
    let sourceType: String
    let accessTier: AccessTier?
    let durationSeconds: Int?
    let status: LectureStatus
    let languageHint: String?
    let errorMessage: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case sourceType = "source_type"
        case accessTier = "access_tier"
        case durationSeconds = "duration_seconds"
        case status
        case languageHint = "language_hint"
        case errorMessage = "error_message"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    var displayTitle: String {
        if let title, !title.isEmpty {
            return title
        }
        return "Neimenovan zapisek"
    }
}

struct LectureArtifactRow: Codable, Equatable {
    let lectureId: String
    let summary: String
    let keyTopics: [String]
    let structuredNotesMarkdown: String
    let editableNotesMarkdown: String?
    let editableNotesDoc: EditableNoteDoc?
    let editableNotesRevision: Int?
    let editableNotesUpdatedAt: String?
    let generatedAt: String

    enum CodingKeys: String, CodingKey {
        case lectureId = "lecture_id"
        case summary
        case keyTopics = "key_topics"
        case structuredNotesMarkdown = "structured_notes_md"
        case editableNotesMarkdown = "editable_notes_md"
        case editableNotesDoc = "editable_notes_doc"
        case editableNotesRevision = "editable_notes_revision"
        case editableNotesUpdatedAt = "editable_notes_updated_at"
        case generatedAt = "generated_at"
    }

    var bestNotesMarkdown: String {
        let editable = editableNotesMarkdown?.trimmingCharacters(in: .whitespacesAndNewlines)
        return editable?.isEmpty == false ? editable! : structuredNotesMarkdown
    }
}

struct NoteAnnotation: Codable, Equatable, Identifiable {
    let id: String
    let kind: String
    let startWordIndex: Int
    let endWordIndex: Int
    let colorId: String?
    let createdAt: String
}

struct NoteMediaBlock: Codable, Equatable, Identifiable {
    let id: String
    let mediaId: String
    let afterBlockId: String
    let widthPercent: Double?
    let xPercent: Double?
    let createdAt: String
}

struct EditableNoteDoc: Codable, Equatable {
    let version: Int
    let baseNotesHash: String
    let updatedAt: String
    let annotations: [NoteAnnotation]
    let mediaBlocks: [NoteMediaBlock]
}

struct NoteMediaAsset: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let userId: String
    let storagePath: String
    let mimeType: String
    let byteSize: Int
    let originalFileName: String?
    let createdAt: String
    let signedUrl: String

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case userId = "user_id"
        case storagePath = "storage_path"
        case mimeType = "mime_type"
        case byteSize = "byte_size"
        case originalFileName = "original_file_name"
        case createdAt = "created_at"
        case signedUrl
    }

    var signedURL: URL? { URL(string: signedUrl) }
}

struct TranscriptSegmentRow: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let idx: Int
    let startMs: Int
    let endMs: Int
    let speakerLabel: String?
    let text: String

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case idx
        case startMs = "start_ms"
        case endMs = "end_ms"
        case speakerLabel = "speaker_label"
        case text
    }
}

struct FlashcardRow: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let idx: Int
    let front: String
    let back: String
    let hint: String?
    let difficulty: String
    let sourceLocator: String?
    var progress: FlashcardProgressRow?

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case idx
        case front
        case back
        case hint
        case difficulty
        case sourceLocator = "source_locator"
        case progress
    }

    var isReviewed: Bool {
        (progress?.reviewCount ?? 0) > 0
    }
}

struct FlashcardProgressRow: Codable, Equatable {
    let userId: String
    let flashcardId: String
    let confidenceBucket: String
    let reviewCount: Int
    let lastReviewedAt: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case flashcardId = "flashcard_id"
        case confidenceBucket = "confidence_bucket"
        case reviewCount = "review_count"
        case lastReviewedAt = "last_reviewed_at"
    }
}

struct FlashcardProgressResponse: Codable, Equatable {
    let progress: FlashcardProgressRow
}

struct FlashcardMutationResponse: Codable, Equatable {
    let flashcard: FlashcardRow
}

struct QuizQuestionRow: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let idx: Int
    let prompt: String
    let options: [String]
    let correctOptionIndex: Int
    let explanation: String?
    let sourceLocator: String?

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case idx
        case prompt
        case options = "options_json"
        case correctOptionIndex = "correct_option_idx"
        case explanation
        case sourceLocator = "source_locator"
    }
}

struct QuizQuestionMutationResponse: Codable, Equatable {
    let question: QuizQuestionRow
}

struct PracticeTestQuestionRow: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let idx: Int
    let prompt: String
    let answerGuide: String
    let difficulty: String
    let sourceLocator: String?
    let sourceUnitIndex: Int?
    let conceptKey: String?

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case idx
        case prompt
        case answerGuide = "answer_guide"
        case difficulty
        case sourceLocator = "source_locator"
        case sourceUnitIndex = "source_unit_idx"
        case conceptKey = "concept_key"
    }
}

struct PracticeTestAttemptAnswerRow: Codable, Equatable, Identifiable {
    let id: String
    let attemptId: String
    let practiceTestQuestionId: String?
    let idx: Int
    let questionPrompt: String?
    let answerGuideSnapshot: String?
    let typedAnswer: String?
    let declaredUnknown: Bool
    let score: Int?
    let gradingRationale: String?
    let strengths: String?
    let missingPoints: String?
    let expectedAnswer: String?
    let gradingConfidence: String?

    enum CodingKeys: String, CodingKey {
        case id
        case attemptId = "attempt_id"
        case practiceTestQuestionId = "practice_test_question_id"
        case idx
        case questionPrompt = "question_prompt"
        case answerGuideSnapshot = "answer_guide_snapshot"
        case typedAnswer = "typed_answer"
        case declaredUnknown = "declared_unknown"
        case score
        case gradingRationale = "grading_rationale"
        case strengths
        case missingPoints = "missing_points"
        case expectedAnswer = "expected_answer"
        case gradingConfidence = "grading_confidence"
    }
}

struct PracticeTestAttemptRow: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let userId: String
    let status: String
    let questionCount: Int
    let totalScore: Int?
    let maxScore: Int?
    let percentage: Double?
    let gradedAt: String?
    let createdAt: String
    let updatedAt: String
    let answers: [PracticeTestAttemptAnswerRow]

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case userId = "user_id"
        case status
        case questionCount = "question_count"
        case totalScore = "total_score"
        case maxScore = "max_score"
        case percentage
        case gradedAt = "graded_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case answers
    }
}

struct PracticeTestHistorySummary: Codable, Equatable {
    let attemptCount: Int
    let averagePercentage: Double?
    let bestPercentage: Double?
    let lowestPercentage: Double?
    let latestPercentage: Double?
}

struct FlashcardSessionResult: Codable, Equatable {
    let attempts: Int
    let firstConfidence: String
    let latestConfidence: String
}

struct FlashcardRoundSummary: Codable, Equatable {
    let cycle: Int
    let total: Int
    let known: Int
    let missed: Int
}

struct PersistedFlashcardSessionState: Codable, Equatable {
    let reviewQueue: [String]
    let repeatQueue: [String]
    let activeFlashcardIndex: Int
    let reviewCycle: Int
    let cycleCardCount: Int
    let roundSummary: FlashcardRoundSummary?
    let sessionResults: [String: FlashcardSessionResult]

    enum CodingKeys: String, CodingKey {
        case reviewQueue, repeatQueue, activeFlashcardIndex, reviewCycle
        case cycleCardCount, roundSummary, sessionResults
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(reviewQueue, forKey: .reviewQueue)
        try container.encode(repeatQueue, forKey: .repeatQueue)
        try container.encode(activeFlashcardIndex, forKey: .activeFlashcardIndex)
        try container.encode(reviewCycle, forKey: .reviewCycle)
        try container.encode(cycleCardCount, forKey: .cycleCardCount)
        if let roundSummary {
            try container.encode(roundSummary, forKey: .roundSummary)
        } else {
            try container.encodeNil(forKey: .roundSummary)
        }
        try container.encode(sessionResults, forKey: .sessionResults)
    }
}

struct QuizRoundSummary: Codable, Equatable {
    let cycle: Int
    let total: Int
    let correct: Int
    let missed: Int
    let missedQuestionIds: [String]
}

struct PersistedQuizSessionState: Codable, Equatable {
    let quizQueue: [String]
    let quizRound: Int
    let quizRoundCount: Int
    let roundSummary: QuizRoundSummary?
    let activeQuestionIndex: Int
    let selections: [String: Int]
    let optionOrders: [String: [Int]]

    enum CodingKeys: String, CodingKey {
        case quizQueue, quizRound, quizRoundCount, roundSummary
        case activeQuestionIndex, selections, optionOrders
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(quizQueue, forKey: .quizQueue)
        try container.encode(quizRound, forKey: .quizRound)
        try container.encode(quizRoundCount, forKey: .quizRoundCount)
        if let roundSummary {
            try container.encode(roundSummary, forKey: .roundSummary)
        } else {
            try container.encodeNil(forKey: .roundSummary)
        }
        try container.encode(activeQuestionIndex, forKey: .activeQuestionIndex)
        try container.encode(selections, forKey: .selections)
        try container.encode(optionOrders, forKey: .optionOrders)
    }
}

struct PersistedPracticeTestSessionState: Codable, Equatable {
    let currentAttemptId: String?
    let attemptQuestionIds: [String]
    let textAnswers: [String: String]
    let unknownQuestionIds: [String]
    let latestViewedAttemptId: String?
    let submittedAt: String?

    enum CodingKeys: String, CodingKey {
        case currentAttemptId, attemptQuestionIds, textAnswers
        case unknownQuestionIds, latestViewedAttemptId, submittedAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let currentAttemptId {
            try container.encode(currentAttemptId, forKey: .currentAttemptId)
        } else {
            try container.encodeNil(forKey: .currentAttemptId)
        }
        try container.encode(attemptQuestionIds, forKey: .attemptQuestionIds)
        try container.encode(textAnswers, forKey: .textAnswers)
        try container.encode(unknownQuestionIds, forKey: .unknownQuestionIds)
        if let latestViewedAttemptId {
            try container.encode(latestViewedAttemptId, forKey: .latestViewedAttemptId)
        } else {
            try container.encodeNil(forKey: .latestViewedAttemptId)
        }
        if let submittedAt {
            try container.encode(submittedAt, forKey: .submittedAt)
        } else {
            try container.encodeNil(forKey: .submittedAt)
        }
    }
}

struct StudySession: Codable, Equatable {
    let userId: String
    let lectureId: String
    let activeStudyView: String
    let flashcardState: PersistedFlashcardSessionState?
    let quizState: PersistedQuizSessionState?
    let practiceTestState: PersistedPracticeTestSessionState?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case lectureId = "lecture_id"
        case activeStudyView = "active_study_view"
        case flashcardState = "flashcard_state"
        case quizState = "quiz_state"
        case practiceTestState = "practice_test_state"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct PracticeTestSubmissionResult: Codable, Equatable {
    let totalScore: Int
    let maxScore: Int
    let percentage: Double
}

struct APIActionResponse: Codable, Equatable {
    let ok: Bool
}

struct PracticeTestStartResponse: Codable, Equatable {
    let id: String
}

struct PracticeTestWebSubmissionResponse: Codable, Equatable {
    let ok: Bool
    let result: PracticeTestSubmissionResult
}

struct PracticeTestSubmissionResponse: Codable, Equatable {
    let ok: Bool
    let result: PracticeTestSubmissionResult
    let attempt: PracticeTestAttemptRow
}

struct ChatMessageRow: Codable, Equatable, Identifiable {
    let id: String
    let lectureId: String
    let userId: String
    let role: String
    let content: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case lectureId = "lecture_id"
        case userId = "user_id"
        case role
        case content
        case createdAt = "created_at"
    }
}

struct LibraryFolderRow: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case createdAt = "created_at"
    }
}

struct FolderLectureRow: Codable, Equatable {
    let folderId: String
    let lectureId: String

    enum CodingKeys: String, CodingKey {
        case folderId = "folder_id"
        case lectureId = "lecture_id"
    }
}

struct OnboardingAnswers: Codable, Equatable {
    var ageRange = "19_22"
    var educationLevel = "university"
    var currentAverageGrade = ""
    var targetGrade = ""
    var studyGoal = ""

    var isComplete: Bool {
        !currentAverageGrade.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !targetGrade.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !studyGoal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum StudyAssetStatus: String, Codable, Equatable {
    case queued
    case generating
    case ready
    case failed

    var label: String {
        switch self {
        case .queued: "Priprava"
        case .generating: "Ustvarjanje"
        case .ready: "Pripravljeno"
        case .failed: "Napaka"
        }
    }

    var isGenerating: Bool {
        self == .queued || self == .generating
    }
}

struct StudyAssetRow: Codable, Equatable {
    let lectureId: String
    let status: StudyAssetStatus
    let errorMessage: String?
    let generatedAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case lectureId = "lecture_id"
        case status
        case errorMessage = "error_message"
        case generatedAt = "generated_at"
        case updatedAt = "updated_at"
    }
}

struct LectureDetail: Codable, Equatable {
    var lecture: LectureRow
    var artifact: LectureArtifactRow?
    var transcript: [TranscriptSegmentRow]
    var flashcards: [FlashcardRow]
    var quizQuestions: [QuizQuestionRow]
    var practiceTestQuestions: [PracticeTestQuestionRow]
    var studyAsset: StudyAssetRow?
    var quizAsset: StudyAssetRow?
    var practiceTestAsset: StudyAssetRow?
    var practiceTestAttempts: [PracticeTestAttemptRow]?
    var practiceTestHistorySummary: PracticeTestHistorySummary?
    var chatMessages: [ChatMessageRow]
    var noteMedia: [NoteMediaAsset]?
    var studySession: StudySession?
    /// Signed URL for the original uploaded recording, mirroring the web
    /// workspace's audio tab.
    var audioUrl: String?

    /// True while any study asset is queued or generating server-side.
    var hasPendingStudyGeneration: Bool {
        [studyAsset, quizAsset, practiceTestAsset].contains { asset in
            asset?.status == .queued || asset?.status == .generating
        }
    }
}

struct CreateLectureResponse: Codable {
    let lectureId: String
    let path: String?
    let token: String?
}

struct NoteMediaUploadResponse: Codable {
    let mediaId: String
    let path: String
    let token: String
    let mimeType: String
    let maxBytes: Int
}

struct NoteMediaMutationResponse: Codable {
    let doc: EditableNoteDoc
    let revision: Int
    let media: NoteMediaAsset?
    let deletedMediaId: String?
}

struct ScanUploadTarget: Codable, Identifiable {
    var id: Int { index }

    let index: Int
    let path: String
    let token: String
}

struct ScanUploadResponse: Codable {
    let uploads: [ScanUploadTarget]
}

struct LocalScanUploadFile {
    let index: Int
    let fileName: String
    let mimeType: String
    let data: Data
}

struct APIErrorResponse: Codable {
    let error: String?
    let code: String?
}

struct NoteTTSStatus: Codable, Equatable {
    let available: Bool
    let reason: String?
    let tier: String
    let limitSeconds: Int
    let secondsUsed: Int
    let remainingSeconds: Int
    let hasUnlimitedUsage: Bool?
    let chunkCount: Int
    let totalWords: Int

    var remainingFraction: Double {
        guard hasUnlimitedUsage != true, limitSeconds > 0 else { return 1 }
        return min(max(Double(remainingSeconds) / Double(limitSeconds), 0), 1)
    }
}

struct NoteTTSAlignment: Codable, Equatable {
    let wordIndex: Int
    let startMs: Int
    let endMs: Int
}

struct NoteTTSChunk: Codable, Equatable {
    let audioUrl: String
    let chunkIndex: Int
    let chunkCount: Int
    let wordStartIndex: Int
    let wordEndIndex: Int
    let durationMs: Int
    let alignment: [NoteTTSAlignment]
    let limitSeconds: Int
    let secondsUsed: Int
    let remainingSeconds: Int
    let hasUnlimitedUsage: Bool?

    var audioURL: URL? { URL(string: audioUrl) }
}

struct NoteTTSRequestError: Codable {
    let error: String?
    let code: String?
    let tier: String?
    let limitSeconds: Int?
    let secondsUsed: Int?
    let remainingSeconds: Int?
    let hasUnlimitedUsage: Bool?
}

struct ChatAnswerResponse: Codable {
    let answer: ChatMessageRow?
}

enum MemoError: LocalizedError, Equatable {
    case missingConfiguration(String)
    case invalidResponse
    case http(status: Int, message: String)
    /// HTTP 402 from the API. The web client redirects to the paywall in this
    /// case, so the native app presents its StoreKit paywall instead.
    case billingRequired(message: String, code: String?)
    case storeKit(String)
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .missingConfiguration(let key):
            "Missing iOS configuration value: \(key)."
        case .invalidResponse:
            "The server returned an invalid response."
        case .http(_, let message):
            message
        case .billingRequired(let message, _):
            message
        case .storeKit(let message):
            message
        case .unsupported(let message):
            message
        }
    }
}

extension DateFormatter {
    static let memoShortDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
}
