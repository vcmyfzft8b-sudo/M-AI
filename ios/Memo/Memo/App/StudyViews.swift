import SwiftUI

// Study tab: Flashcards / Kviz / Test sub-modes, matching the web
// lecture-study-shell (status chip, segmented switch, completion cards).

enum StudyMode: String, CaseIterable, Identifiable {
    case flashcards
    case quiz
    case practiceTest

    var id: String { rawValue }

    var apiValue: String {
        switch self {
        case .flashcards: "flashcards"
        case .quiz: "quiz"
        case .practiceTest: "practice_test"
        }
    }

    init?(apiValue: String) {
        switch apiValue {
        case "flashcards": self = .flashcards
        case "quiz": self = .quiz
        case "practice_test": self = .practiceTest
        default: return nil
        }
    }

    var label: String {
        switch self {
        case .flashcards: "Flashcards"
        case .quiz: "Kviz"
        case .practiceTest: "Test"
        }
    }
}

struct StudyPanel: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lecture: LectureRow
    let detail: LectureDetail?
    @Binding var mode: StudyMode

    @State private var isGenerating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                if let status = activeMaterialStatus {
                    statusChip(status.label, status: status)
                }
                Spacer(minLength: 0)
                if mode == .practiceTest {
                    statusChip("Demo", status: nil)
                }
            }
            modeSwitch

            if let error = activeAsset?.errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
               !error.isEmpty {
                MemoBanner(kind: .error, message: error)
            }

            switch mode {
            case .flashcards:
                if let cards = detail?.flashcards, !cards.isEmpty {
                    FlashcardsView(
                        lectureID: lecture.id,
                        cards: cards,
                        initialState: detail?.studySession?.flashcardState
                    )
                } else {
                    emptyCard(
                        title: emptyTitle("Ustvari kartice, ko si pripravljen."),
                        subtitle: emptySubtitle("Ustvari učni komplet v istem jeziku in iz iste vsebine kot tvoji zapiski."),
                        buttonLabel: "Ustvari kartice",
                        generating: activeAsset?.status.isGenerating == true,
                        action: generateFlashcards
                    )
                }
            case .quiz:
                if let questions = detail?.quizQuestions, !questions.isEmpty {
                    QuizView(
                        lectureID: lecture.id,
                        questions: questions,
                        initialState: detail?.studySession?.quizState
                    )
                } else {
                    emptyCard(
                        title: emptyTitle("Ustvari kviz, ko si pripravljen."),
                        subtitle: emptySubtitle("Ustvari vprašanja z več izbirami v istem jeziku kot tvoji zapiski."),
                        buttonLabel: "Ustvari kviz",
                        generating: activeAsset?.status.isGenerating == true,
                        action: generateQuiz
                    )
                }
            case .practiceTest:
                if lecture.status == .ready {
                    PracticeTestView(
                        lecture: lecture,
                        questions: detail?.practiceTestQuestions ?? [],
                        attempts: detail?.practiceTestAttempts ?? [],
                        assetStatus: detail?.practiceTestAsset?.status
                    )
                } else {
                    emptyCard(
                        title: emptyTitle("Ustvari svoj prvi preizkus."),
                        subtitle: emptySubtitle("Najprej ustvari prvi nabor samostojnih odprtih vprašanj, nato preglej rezultate in po koncu začni nove preizkuse."),
                        buttonLabel: "Ustvari preizkus",
                        generating: activeAsset?.status.isGenerating == true,
                        action: {}
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .memoCard(cornerRadius: 20, padding: 18)
        .onAppear {
            #if DEBUG
            if let raw = ProcessInfo.processInfo.environment["MEMO_DEBUG_STUDY_MODE"],
               let debugMode = StudyMode(apiValue: raw) {
                mode = debugMode
                return
            }
            #endif
            if let saved = detail?.studySession?.activeStudyView,
               let restored = StudyMode(apiValue: saved) {
                mode = restored
            }
        }
        .onChange(of: mode) { _, next in
            Task { await appModel.persistActiveStudyMode(lectureID: lecture.id, mode: next) }
        }
    }

    private var activeAsset: StudyAssetRow? {
        switch mode {
        case .flashcards: detail?.studyAsset
        case .quiz: detail?.quizAsset
        case .practiceTest: detail?.practiceTestAsset
        }
    }

    private var activeMaterialStatus: StudyAssetStatus? {
        switch mode {
        case .flashcards:
            return detail?.flashcards.isEmpty == false ? .ready : detail?.studyAsset?.status
        case .quiz:
            return detail?.quizAsset?.status
        case .practiceTest:
            return detail?.practiceTestAsset?.status
        }
    }

    private func statusChip(_ label: String, status: StudyAssetStatus?) -> some View {
        let accent: Color = switch status {
        case .failed: theme.red
        case .queued, .generating: Color.orange
        case .ready: theme.green
        case nil: theme.secondaryLabel
        }
        return Text(label.uppercased())
            .font(.system(size: 12, weight: .bold))
            .tracking(1.3)
            .foregroundStyle(accent)
            .padding(.horizontal, 12)
            .frame(minHeight: 30)
            .background(accent.opacity(0.1), in: Capsule())
            .overlay(Capsule().stroke(accent.opacity(0.3), lineWidth: 1))
    }

    private var modeSwitch: some View {
        MemoGlassSegmentedPicker(
            items: StudyMode.allCases,
            selection: $mode,
            minHeight: 38,
            cornerRadius: 12
        ) { candidate, _ in
            Text(candidate.label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.label)
        }
    }

    private func emptyTitle(_ readyTitle: String) -> String {
        lecture.status == .ready
            ? readyTitle
            : "Učna orodja se odklenejo, ko je obdelava zapiska končana."
    }

    private func emptySubtitle(_ readySubtitle: String) -> String {
        lecture.status == .ready
            ? readySubtitle
            : "Najprej nastanejo zapiski. Nato lahko kartice ustvariš ročno."
    }

    private func emptyCard(
        title: String,
        subtitle: String,
        buttonLabel: String,
        generating: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 10) {
            if isGenerating || generating {
                StudyGenerationNotice(
                    stage: "Pripravljam učna orodja",
                    body: "Ustvarjanje teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut."
                )
            } else {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(theme.label)
                    .multilineTextAlignment(.center)
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.secondaryLabel)
                    .multilineTextAlignment(.center)
                if lecture.status == .ready {
                    Button {
                        action()
                    } label: {
                        Text(buttonLabel)
                    }
                    .buttonStyle(MemoPrimaryButtonStyle(minHeight: 48))
                    .padding(.top, 6)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .memoCard(cornerRadius: 20, padding: 18)
    }

    private func generateFlashcards() {
        isGenerating = true
        Task {
            await appModel.generateStudyAssets(lectureID: lecture.id)
            isGenerating = false
        }
    }

    private func generateQuiz() {
        isGenerating = true
        Task {
            await appModel.generateQuizAssets(lectureID: lecture.id)
            isGenerating = false
        }
    }
}

// MARK: - Study manager

struct StudyManagerSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let lecture: LectureRow
    let detail: LectureDetail?

    @State private var mode: StudyMode
    @State private var search = ""
    @State private var editingID: String?
    @State private var primaryText = ""
    @State private var secondaryText = ""
    @State private var quizOptions = ["", "", "", ""]
    @State private var correctOptionIndex = 0
    @State private var isSaving = false

    init(lecture: LectureRow, detail: LectureDetail?, initialMode: StudyMode) {
        self.lecture = lecture
        self.detail = detail
        _mode = State(initialValue: initialMode == .quiz ? .quiz : .flashcards)
    }

    private var currentDetail: LectureDetail? {
        guard appModel.selectedLectureDetail?.lecture.id == lecture.id else { return detail }
        return appModel.selectedLectureDetail
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(mode == .flashcards ? "FLASHCARDS" : "KVIZ")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1.3)
                        .foregroundStyle(theme.secondaryLabel)
                    Text(mode == .flashcards ? "Uredi kartice" : "Uredi vprašanja")
                        .font(.system(size: 23, weight: .bold))
                        .foregroundStyle(theme.label)
                }
                Spacer()
                MemoCloseButton(size: 34) { dismiss() }
            }
            .padding(.horizontal, 18)
            .padding(.top, 6)
            .padding(.bottom, 12)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    searchField
                    form
                    itemList
                }
                .padding(18)
                .padding(.bottom, 24)
            }
        }
        .background(theme.canvas.ignoresSafeArea())
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Text("🔎")
            TextField("Poišči...", text: $search)
                .textInputAutocapitalization(.sentences)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 42)
        .background(theme.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if editingID != nil {
                Button(mode == .flashcards ? "+ Nova kartica" : "+ Novo vprašanje") {
                    resetForm()
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.tint)
            }

            managerTextEditor(label: "Vprašanje", text: $primaryText)

            if mode == .flashcards {
                managerTextEditor(label: "Odgovor", text: $secondaryText)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Odgovori")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.secondaryLabel)
                    ForEach(quizOptions.indices, id: \.self) { index in
                        let letter = String(UnicodeScalar(65 + index)!)
                        HStack(spacing: 9) {
                            Button {
                                correctOptionIndex = index
                            } label: {
                                Image(systemName: correctOptionIndex == index ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(correctOptionIndex == index ? theme.green : theme.secondaryLabel)
                            }
                            .accessibilityLabel("Pravilen odgovor \(letter)")
                            TextField("Odgovor \(letter)", text: optionBinding(index))
                                .padding(.horizontal, 11)
                                .frame(minHeight: 42)
                                .background(theme.surfaceMuted)
                                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                        }
                    }
                }
                managerTextEditor(label: "Razlaga", text: $secondaryText)
            }

            Button {
                save()
            } label: {
                HStack(spacing: 8) {
                    if isSaving { ProgressView().tint(.white) } else { Text("✅") }
                    Text(saveLabel)
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle(minHeight: 48))
            .disabled(!formIsValid || isSaving)
        }
        .memoCard(cornerRadius: 18, padding: 14)
    }

    private func managerTextEditor(label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.secondaryLabel)
            TextEditor(text: text)
                .font(.system(size: 15.5))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 82)
                .padding(8)
                .background(theme.surfaceMuted)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    @ViewBuilder
    private var itemList: some View {
        VStack(alignment: .leading, spacing: 10) {
            if mode == .flashcards {
                ForEach(filteredFlashcards) { card in
                    managerItem(title: card.front, subtitle: card.back) {
                        editingID = card.id
                        primaryText = card.front
                        secondaryText = card.back
                    } delete: {
                        Task { _ = await appModel.deleteFlashcard(id: card.id) }
                    }
                }
            } else {
                ForEach(filteredQuestions) { question in
                    managerItem(
                        title: question.prompt,
                        subtitle: question.options.indices.contains(question.correctOptionIndex)
                            ? question.options[question.correctOptionIndex]
                            : question.options.first ?? ""
                    ) {
                        editingID = question.id
                        primaryText = question.prompt
                        secondaryText = question.explanation ?? ""
                        quizOptions = (question.options + ["", "", "", ""]).prefix(4).map { $0 }
                        correctOptionIndex = min(max(question.correctOptionIndex, 0), 3)
                    } delete: {
                        Task { _ = await appModel.deleteQuizQuestion(lectureID: lecture.id, id: question.id) }
                    }
                }
            }
        }
    }

    private func managerItem(
        title: String,
        subtitle: String,
        edit: @escaping () -> Void,
        delete: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            Button(action: edit) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.system(size: 15.5, weight: .semibold))
                        .foregroundStyle(theme.label)
                    Text(subtitle)
                        .font(.system(size: 14))
                        .foregroundStyle(theme.secondaryLabel)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Button(role: .destructive, action: delete) {
                Image(systemName: "trash")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.red)
                    .frame(width: 42, height: 42)
                    .background(theme.redSoft, in: Circle())
            }
            .accessibilityLabel("Izbriši")
        }
        .memoCard(cornerRadius: 15, padding: 10)
    }

    private var filteredFlashcards: [FlashcardRow] {
        let cards = currentDetail?.flashcards ?? []
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return query.isEmpty ? cards : cards.filter { "\($0.front) \($0.back)".lowercased().contains(query) }
    }

    private var filteredQuestions: [QuizQuestionRow] {
        let questions = currentDetail?.quizQuestions ?? []
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return query.isEmpty ? questions : questions.filter {
            "\($0.prompt) \($0.options.joined(separator: " ")) \($0.explanation ?? "")".lowercased().contains(query)
        }
    }

    private var formIsValid: Bool {
        let mainValid = !primaryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !secondaryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return mode == .flashcards ? mainValid : mainValid && quizOptions.allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private var saveLabel: String {
        if mode == .flashcards {
            return editingID == nil ? "Dodaj kartico" : "Shrani kartico"
        }
        return editingID == nil ? "Dodaj vprašanje" : "Shrani vprašanje"
    }

    private func optionBinding(_ index: Int) -> Binding<String> {
        Binding(get: { quizOptions[index] }, set: { quizOptions[index] = $0 })
    }

    private func resetForm() {
        editingID = nil
        primaryText = ""
        secondaryText = ""
        quizOptions = ["", "", "", ""]
        correctOptionIndex = 0
    }

    private func save() {
        isSaving = true
        Task {
            let success: Bool
            if mode == .flashcards {
                success = await appModel.saveFlashcard(
                    lectureID: lecture.id,
                    id: editingID,
                    front: primaryText,
                    back: secondaryText
                )
            } else {
                success = await appModel.saveQuizQuestion(
                    lectureID: lecture.id,
                    id: editingID,
                    prompt: primaryText,
                    options: quizOptions,
                    correctOptionIndex: correctOptionIndex,
                    explanation: secondaryText
                )
            }
            isSaving = false
            if success { resetForm() }
        }
    }
}

// MARK: - Completion card

struct StudyCompletionCard: View {
    @Environment(\.memoTheme) private var theme
    var eyebrow: String?
    let title: String
    var subtitle: String?
    let percentage: Int
    let percentageLabel: String
    let primaryMetricLabel: String
    let primaryMetricValue: String
    var actionLabel: String
    var action: () -> Void

    private var accent: Color {
        if percentage >= 85 {
            return theme.green
        }
        if percentage >= 60 {
            return theme.tint
        }
        return Color.orange
    }

    var body: some View {
        VStack(spacing: 14) {
            if let eyebrow, !eyebrow.isEmpty {
                Text(eyebrow.uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .tracking(1.4)
                    .foregroundStyle(accent)
            }
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(theme.label)
                .multilineTextAlignment(.center)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.secondaryLabel)
            }

            ZStack {
                Circle()
                    .stroke(theme.surfaceMuted, lineWidth: 11)
                Circle()
                    .trim(from: 0, to: CGFloat(min(max(percentage, 0), 100)) / 100)
                    .stroke(accent, style: StrokeStyle(lineWidth: 11, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 3) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 19))
                        .foregroundStyle(accent)
                    Text("\(percentage)%")
                        .font(.system(size: 27, weight: .bold))
                        .foregroundStyle(theme.label)
                    Text(percentageLabel)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.secondaryLabel)
                }
            }
            .frame(width: 148, height: 148)
            .padding(.vertical, 6)

            VStack(spacing: 3) {
                Text(primaryMetricLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.secondaryLabel)
                Text(primaryMetricValue)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(theme.label)
            }

            Button {
                action()
            } label: {
                Text("🔄 " + actionLabel)
            }
            .buttonStyle(MemoSecondaryButtonStyle(minHeight: 48))
        }
        .frame(maxWidth: .infinity)
        .memoCard(cornerRadius: 20, padding: 20)
    }
}

// MARK: - Flashcards

struct FlashcardsView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lectureID: String
    let cards: [FlashcardRow]
    let initialState: PersistedFlashcardSessionState?

    @State private var queue: [FlashcardRow] = []
    @State private var index = 0
    @State private var flipped = false
    @State private var knownIDs: Set<String> = []
    @State private var missedIDs: Set<String> = []
    @State private var round = 1
    @State private var roundComplete = false
    @State private var dragOffset: CGSize = .zero
    @State private var sessionResults: [String: FlashcardSessionResult] = [:]

    var body: some View {
        VStack(spacing: 14) {
            if roundComplete {
                completion
            } else if let card = currentCard {
                cardView(card)
                controls
            }
        }
        .onAppear(perform: restoreOrReset)
    }

    private var currentCard: FlashcardRow? {
        queue.indices.contains(index) ? queue[index] : nil
    }

    private func restoreOrReset() {
        guard let saved = initialState else {
            resetDeck(persist: false)
            return
        }
        let cardsByID = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, $0) })
        let restored = saved.reviewQueue.compactMap { cardsByID[$0] }
        guard !restored.isEmpty else {
            resetDeck(persist: false)
            return
        }
        queue = restored
        index = min(max(saved.activeFlashcardIndex, 0), restored.count - 1)
        flipped = false
        round = max(saved.reviewCycle, 1)
        roundComplete = saved.roundSummary != nil
        sessionResults = saved.sessionResults
        knownIDs = Set(saved.sessionResults.compactMap {
            $0.value.latestConfidence == "easy" || $0.value.latestConfidence == "good" ? $0.key : nil
        })
        missedIDs = Set(saved.repeatQueue)
    }

    private func resetDeck(persist: Bool = true) {
        queue = cards
        index = 0
        flipped = false
        knownIDs = []
        missedIDs = []
        round = 1
        roundComplete = false
        sessionResults = [:]
        if persist { persistState() }
    }

    private func cardView(_ card: FlashcardRow) -> some View {
        ZStack {
            face(text: card.front, footer: "Pokaži odgovor", header: "\(index + 1) / \(queue.count)")
                .opacity(flipped ? 0 : 1)
                .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
            face(text: card.back, footer: "Nazaj na vprašanje", header: "\(index + 1) / \(queue.count)")
                .opacity(flipped ? 1 : 0)
                .rotation3DEffect(.degrees(flipped ? 0 : -180), axis: (x: 0, y: 1, z: 0))
        }
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .onTapGesture {
            withAnimation(.spring(duration: 0.4)) {
                flipped.toggle()
            }
        }
        .offset(dragOffset)
        .rotationEffect(.degrees(Double(dragOffset.width) / 24))
        .overlay {
            if abs(dragOffset.width) > 30 {
                Text(dragOffset.width > 0 ? "✅" : "❌")
                    .font(.system(size: 44))
                    .opacity(min(abs(dragOffset.width) / 120, 1))
            }
        }
        .highPriorityGesture(
            DragGesture(minimumDistance: 8, coordinateSpace: .local)
                .onChanged { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    dragOffset = CGSize(width: value.translation.width, height: value.translation.height * 0.08)
                }
                .onEnded { value in
                    let horizontal = abs(value.translation.width) > abs(value.translation.height)
                    let projectedWidth = value.predictedEndTranslation.width
                    if horizontal, abs(projectedWidth) >= 80 {
                        let bucket = projectedWidth > 0 ? "easy" : "again"
                        withAnimation(.easeOut(duration: 0.16)) {
                            dragOffset = CGSize(width: projectedWidth > 0 ? 520 : -520, height: value.translation.height * 0.08)
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
                            dragOffset = .zero
                            answer(card, bucket: bucket)
                        }
                    } else {
                        withAnimation(.spring(duration: 0.3)) {
                            dragOffset = .zero
                        }
                    }
                }
        )
    }

    private func face(text: String, footer: String, header: String) -> some View {
        VStack(spacing: 12) {
            HStack {
                Text(header)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.secondaryLabel)
                Spacer()
                if round > 1 {
                    Text("Krog \(round)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.secondaryLabel)
                }
            }
            Spacer()
            Text(text)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(theme.label)
                .multilineTextAlignment(.center)
            Spacer()
            Text(footer)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.tint)
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 300)
        .background(theme.surfaceSolid)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(theme.separator, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.06), radius: 14, y: 6)
    }

    private var controls: some View {
        HStack(spacing: 12) {
            controlButton(systemName: "arrow.left", label: "Prejšnja kartica") {
                guard index > 0 else {
                    return
                }
                index -= 1
                flipped = false
                persistState()
            }
            .disabled(index == 0)

            Button {
                if let card = currentCard {
                    answer(card, bucket: "again")
                }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                    Text("\(missedIDs.count)")
                        .font(.system(size: 16, weight: .bold))
                }
                .foregroundStyle(theme.red)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(theme.redSoft)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .accessibilityLabel("Nisem vedel")

            Button {
                if let card = currentCard {
                    answer(card, bucket: "easy")
                }
            } label: {
                HStack(spacing: 7) {
                    Text("\(knownIDs.count)")
                        .font(.system(size: 16, weight: .bold))
                    Image(systemName: "checkmark")
                        .font(.system(size: 16, weight: .bold))
                }
                .foregroundStyle(theme.green)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(theme.greenSoft)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .accessibilityLabel("Vedel sem")

            controlButton(systemName: "arrow.right", label: "Naslednja kartica") {
                if let card = currentCard {
                    answer(card, bucket: "again")
                }
            }
        }
    }

    private func controlButton(systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.label)
                .frame(width: 52, height: 52)
                .background(theme.surfaceMuted)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .accessibilityLabel(label)
    }

    private func answer(_ card: FlashcardRow, bucket: String) {
        if bucket == "easy" {
            MemoHaptics.notification(.success)
            knownIDs.insert(card.id)
            missedIDs.remove(card.id)
        } else {
            MemoHaptics.notification(.warning)
            missedIDs.insert(card.id)
        }
        let previous = sessionResults[card.id]
        sessionResults[card.id] = FlashcardSessionResult(
            attempts: (previous?.attempts ?? 0) + 1,
            firstConfidence: previous?.firstConfidence ?? bucket,
            latestConfidence: bucket
        )
        Task {
            await appModel.reviewFlashcard(id: card.id, confidenceBucket: bucket)
        }
        withAnimation(.easeOut(duration: 0.2)) {
            flipped = false
            if index + 1 < queue.count {
                index += 1
            } else {
                roundComplete = true
            }
        }
        persistState()
    }

    private var completion: some View {
        let missed = queue.filter { missedIDs.contains($0.id) }
        let knownCount = queue.count - missed.count
        let percent = queue.isEmpty ? 100 : Int((Double(knownCount) / Double(queue.count) * 100).rounded())

        return StudyCompletionCard(
            eyebrow: missed.isEmpty ? "Zaključeno" : "Krog \(round) zaključen",
            title: missed.isEmpty ? "Vse kartice so predelane" : "Ponovi kartice, ki si jih zgrešil",
            percentage: missed.isEmpty ? 100 : percent,
            percentageLabel: missed.isEmpty ? "Komplet opravljen" : "Rezultat kroga",
            primaryMetricLabel: "Pravilno v tem krogu",
            primaryMetricValue: "\(knownCount)/\(queue.count)",
            actionLabel: missed.isEmpty ? "Začni komplet znova" : repeatLabel(missed.count)
        ) {
            if missed.isEmpty {
                resetDeck()
            } else {
                queue = missed
                index = 0
                flipped = false
                missedIDs = []
                knownIDs = []
                round += 1
                roundComplete = false
                persistState()
            }
        }
    }

    private func repeatLabel(_ count: Int) -> String {
        let word: String
        switch count % 100 {
        case 1: word = "zgrešeno kartico"
        case 2: word = "zgrešeni kartici"
        case 3, 4: word = "zgrešene kartice"
        default: word = "zgrešenih kartic"
        }
        return "Ponovi \(count) \(word)"
    }

    private func persistState() {
        let summary: FlashcardRoundSummary? = roundComplete
            ? FlashcardRoundSummary(
                cycle: round,
                total: queue.count,
                known: max(0, queue.count - missedIDs.count),
                missed: missedIDs.count
            )
            : nil
        let state = PersistedFlashcardSessionState(
            reviewQueue: queue.map(\.id),
            repeatQueue: Array(missedIDs),
            activeFlashcardIndex: index,
            reviewCycle: round,
            cycleCardCount: queue.count,
            roundSummary: summary,
            sessionResults: sessionResults
        )
        Task { await appModel.persistFlashcardStudyState(lectureID: lectureID, state: state) }
    }
}

// MARK: - Quiz

struct QuizView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lectureID: String
    let questions: [QuizQuestionRow]
    let initialState: PersistedQuizSessionState?

    @State private var queue: [QuizQuestionRow] = []
    @State private var index = 0
    @State private var selectedOption: Int?
    @State private var correctCount = 0
    @State private var missed: [QuizQuestionRow] = []
    @State private var round = 1
    @State private var roundComplete = false
    @State private var optionOrders: [String: [Int]] = [:]
    @State private var selections: [String: Int] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if roundComplete {
                completion
            } else if let question = currentQuestion {
                HStack {
                    Text("\(index + 1) / \(queue.count)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.secondaryLabel)
                    Spacer()
                    if round > 1 {
                        Text("Krog \(round)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.secondaryLabel)
                    }
                }

                Text(question.prompt)
                    .font(.system(size: 17.5, weight: .semibold))
                    .foregroundStyle(theme.label)

                VStack(spacing: 9) {
                    ForEach(Array(displayOrder(question).enumerated()), id: \.offset) { displayIndex, optionIndex in
                        optionButton(
                            question: question,
                            optionIndex: optionIndex,
                            letter: String(UnicodeScalar(65 + displayIndex)!)
                        )
                    }
                }

                if let selected = selectedOption {
                    feedback(question: question, selected: selected)
                }

                actions(question)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .memoCard(cornerRadius: 20, padding: 18)
        .onAppear(perform: restoreOrReset)
    }

    private var currentQuestion: QuizQuestionRow? {
        queue.indices.contains(index) ? queue[index] : nil
    }

    private func restoreOrReset() {
        guard let saved = initialState else {
            resetQuiz(persist: false)
            return
        }
        let byID = Dictionary(uniqueKeysWithValues: questions.map { ($0.id, $0) })
        let restored = saved.quizQueue.compactMap { byID[$0] }
        guard !restored.isEmpty else {
            resetQuiz(persist: false)
            return
        }
        queue = restored
        index = min(max(saved.activeQuestionIndex, 0), restored.count - 1)
        round = max(saved.quizRound, 1)
        roundComplete = saved.roundSummary != nil
        selections = saved.selections
        optionOrders = saved.optionOrders.filter { id, order in
            guard let question = byID[id] else { return false }
            return Set(order) == Set(question.options.indices)
        }
        selectedOption = selections[restored[index].id]
        missed = restored.filter {
            guard let choice = selections[$0.id] else { return false }
            return choice != $0.correctOptionIndex
        }
        correctCount = restored.filter { selections[$0.id] == $0.correctOptionIndex }.count
    }

    private func resetQuiz(persist: Bool = true) {
        queue = questions
        index = 0
        selectedOption = nil
        correctCount = 0
        missed = []
        round = 1
        roundComplete = false
        optionOrders = [:]
        selections = [:]
        if persist { persistState() }
    }

    private func displayOrder(_ question: QuizQuestionRow) -> [Int] {
        if let order = optionOrders[question.id] {
            return order
        }
        let order = Array(question.options.indices).shuffled()
        optionOrders[question.id] = order
        return order
    }

    private func optionButton(question: QuizQuestionRow, optionIndex: Int, letter: String) -> some View {
        let isAnswered = selectedOption != nil
        let isSelected = selectedOption == optionIndex
        let isCorrect = optionIndex == question.correctOptionIndex

        var borderColor = theme.separator
        var fill = theme.surfaceMuted.opacity(0.5)
        if isAnswered {
            if isCorrect {
                borderColor = theme.green
                fill = theme.greenSoft
            } else if isSelected {
                borderColor = theme.red
                fill = theme.redSoft
            }
        } else if isSelected {
            borderColor = theme.tint
        }

        return Button {
            guard selectedOption == nil else {
                return
            }
            selectedOption = optionIndex
            selections[question.id] = optionIndex
            if optionIndex == question.correctOptionIndex {
                correctCount += 1
            } else {
                missed.append(question)
            }
            persistState()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Text(letter)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.secondaryLabel)
                    .frame(width: 26, height: 26)
                    .background(theme.surfaceMuted)
                    .clipShape(Circle())
                Text(question.options[optionIndex])
                    .font(.system(size: 15.5))
                    .foregroundStyle(theme.label)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(borderColor, lineWidth: 1.5)
            )
        }
        .disabled(selectedOption != nil)
    }

    private func feedback(question: QuizQuestionRow, selected: Int) -> some View {
        let correct = selected == question.correctOptionIndex
        return VStack(alignment: .leading, spacing: 5) {
            Text(correct ? "Pravilno" : "Napačno")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(correct ? theme.green : theme.red)
            if let explanation = question.explanation, !explanation.isEmpty {
                Text(explanation)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.secondaryLabel)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(correct ? theme.greenSoft : theme.redSoft)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func actions(_ question: QuizQuestionRow) -> some View {
        HStack(spacing: 10) {
            Button("Nazaj") {
                guard index > 0 else {
                    return
                }
                index -= 1
                selectedOption = selections[queue[index].id]
                persistState()
            }
            .buttonStyle(MemoSecondaryButtonStyle(minHeight: 46))
            .disabled(index == 0)

            Button(index == queue.count - 1 ? "Zaključi" : "Naprej") {
                if index + 1 < queue.count {
                    index += 1
                    selectedOption = selections[queue[index].id]
                } else {
                    roundComplete = true
                }
                persistState()
            }
            .buttonStyle(MemoPrimaryButtonStyle(minHeight: 46))
            .disabled(selectedOption == nil)
        }
    }

    private var completion: some View {
        let total = queue.count
        let percent = total == 0 ? 100 : Int((Double(correctCount) / Double(total) * 100).rounded())

        return StudyCompletionCard(
            eyebrow: missed.isEmpty ? "Zaključeno" : "Krog \(round) zaključen",
            title: missed.isEmpty ? "Vsa vprašanja so predelana" : "Ponovi vprašanja, ki si jih zgrešil",
            percentage: missed.isEmpty ? 100 : percent,
            percentageLabel: missed.isEmpty ? "Komplet opravljen" : "Rezultat kroga",
            primaryMetricLabel: missed.isEmpty ? "Predelana vprašanja" : "Pravilno v tem krogu",
            primaryMetricValue: missed.isEmpty ? "\(total)/\(total)" : "\(correctCount)/\(total)",
            actionLabel: missed.isEmpty ? "Začni kviz znova" : repeatLabel(missed.count)
        ) {
            if missed.isEmpty {
                resetQuiz()
            } else {
                queue = missed
                missed = []
                index = 0
                selectedOption = nil
                correctCount = 0
                selections = [:]
                round += 1
                roundComplete = false
                persistState()
            }
        }
    }

    private func repeatLabel(_ count: Int) -> String {
        let word: String
        switch count % 100 {
        case 1: word = "zgrešeno vprašanje"
        case 2: word = "zgrešeni vprašanji"
        case 3, 4: word = "zgrešena vprašanja"
        default: word = "zgrešenih vprašanj"
        }
        return "Ponovi \(count) \(word)"
    }

    private func persistState() {
        let summary: QuizRoundSummary? = roundComplete
            ? QuizRoundSummary(
                cycle: round,
                total: queue.count,
                correct: correctCount,
                missed: missed.count,
                missedQuestionIds: missed.map(\.id)
            )
            : nil
        let state = PersistedQuizSessionState(
            quizQueue: queue.map(\.id),
            quizRound: round,
            quizRoundCount: queue.count,
            roundSummary: summary,
            activeQuestionIndex: index,
            selections: selections,
            optionOrders: optionOrders
        )
        Task { await appModel.persistQuizStudyState(lectureID: lectureID, state: state) }
    }
}

// MARK: - Practice test (persisted and server graded)

struct PracticeTestView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lecture: LectureRow
    let questions: [PracticeTestQuestionRow]
    let attempts: [PracticeTestAttemptRow]
    let assetStatus: StudyAssetStatus?

    private struct AnswerState: Equatable {
        var text = ""
        var dontKnow = false
    }

    @State private var currentAttempt: PracticeTestAttemptRow?
    @State private var answers: [String: AnswerState] = [:]
    @State private var isStarting = false
    @State private var isSubmitting = false
    @State private var showBreakdown = false
    @State private var persistenceTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let attempt = currentAttempt {
                if attempt.status == "graded" {
                    results(attempt)
                } else {
                    answerList(attempt)
                }
            } else {
                startCard
            }
        }
        .onAppear(perform: restoreAttempt)
        .onChange(of: answers) { _, _ in schedulePersistence() }
        .onDisappear {
            persistenceTask?.cancel()
            persistState()
        }
    }

    private var availableAttempts: [PracticeTestAttemptRow] {
        appModel.selectedLectureDetail?.practiceTestAttempts ?? attempts
    }

    private var startCard: some View {
        VStack(spacing: 12) {
            if assetStatus?.isGenerating == true {
                StudyGenerationNotice(
                    stage: assetStatus == .queued ? "Pripravljam preizkus" : "Ustvarjam preizkus",
                    body: "Ustvarjanje teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut."
                )
            } else {
                if questions.isEmpty {
                    Text(assetStatus == .failed
                         ? "Ustvarjanje preizkusa ni uspelo."
                         : availableAttempts.contains(where: { $0.status == "graded" })
                            ? "Začni nov preizkus, ko si pripravljen."
                            : "Ustvari svoj prvi preizkus.")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.label)
                        .multilineTextAlignment(.center)
                    Text(availableAttempts.contains(where: { $0.status == "graded" })
                         ? "Vsak nov preizkus prinese nov naključen nabor odprtih vprašanj."
                         : "Najprej ustvari prvi nabor samostojnih odprtih vprašanj, nato preglej rezultate in po koncu začni nove preizkuse.")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.secondaryLabel)
                        .multilineTextAlignment(.center)
                }
                Button {
                    startAttempt()
                } label: {
                    HStack(spacing: 8) {
                        if isStarting { ProgressView().tint(.white) }
                        Text(
                            questions.isEmpty && !availableAttempts.contains(where: { $0.status == "graded" })
                                ? "Ustvari preizkus"
                                : "Začni nov preizkus"
                        )
                    }
                }
                .buttonStyle(MemoPrimaryButtonStyle(minHeight: 48))
                .disabled(isStarting)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, questions.isEmpty ? 20 : 4)
        .memoCard(cornerRadius: 18, padding: questions.isEmpty ? 16 : 0)
    }

    private func answerList(_ attempt: PracticeTestAttemptRow) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(attempt.answers.sorted(by: { $0.idx < $1.idx })) { answer in
                VStack(alignment: .leading, spacing: 10) {
                    Text("Vprašanje \(answer.idx + 1)")
                        .font(.system(size: 12.5, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(theme.secondaryLabel)
                        .textCase(.uppercase)
                    Text(prompt(for: answer))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.label)

                    TextEditor(text: binding(answer.id).text)
                        .font(.system(size: 15))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 96)
                        .padding(8)
                        .background(theme.surfaceMuted)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(alignment: .topLeading) {
                            if state(answer.id).text.isEmpty {
                                Text("Sem napiši svoj odgovor...")
                                    .font(.system(size: 15))
                                    .foregroundStyle(theme.tertiaryLabel)
                                    .padding(.top, 16)
                                    .padding(.leading, 13)
                                    .allowsHitTesting(false)
                            }
                        }
                        .disabled(state(answer.id).dontKnow || isSubmitting)

                    Button {
                        var next = state(answer.id)
                        next.dontKnow.toggle()
                        if next.dontKnow { next.text = "" }
                        answers[answer.id] = next
                    } label: {
                        HStack(spacing: 9) {
                            Image(systemName: state(answer.id).dontKnow ? "checkmark.square.fill" : "square")
                                .font(.system(size: 18))
                                .foregroundStyle(state(answer.id).dontKnow ? theme.tint : theme.tertiaryLabel)
                            Text("Ne vem")
                                .font(.system(size: 14.5))
                                .foregroundStyle(theme.label)
                        }
                    }
                    .disabled(isSubmitting)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .memoCard(cornerRadius: 18, padding: 16)
            }

            Button {
                submit(attempt)
            } label: {
                HStack(spacing: 8) {
                    if isSubmitting { ProgressView().tint(.white) }
                    Text(isSubmitting ? "Ocenjujem..." : "Oddaj preizkus")
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle())
            .disabled(!allAnswered(attempt) || isSubmitting)
        }
    }

    private func results(_ attempt: PracticeTestAttemptRow) -> some View {
        let percentage = Int((attempt.percentage ?? 0).rounded())
        let attemptNumber = max(1, availableAttempts.firstIndex(where: { $0.id == attempt.id }).map { $0 + 1 } ?? availableAttempts.count)
        return VStack(spacing: 14) {
            StudyCompletionCard(
                eyebrow: nil,
                title: "Preizkus je zaključen",
                subtitle: "Poskus \(attemptNumber)",
                percentage: percentage,
                percentageLabel: "Rezultat",
                primaryMetricLabel: "Dosežene točke",
                primaryMetricValue: "\(attempt.totalScore ?? 0)/\(attempt.maxScore ?? attempt.answers.count * 5)",
                actionLabel: "Začni nov preizkus"
            ) {
                currentAttempt = nil
                answers = [:]
                startAttempt()
            }

            DisclosureGroup("Podrobnosti poskusa", isExpanded: $showBreakdown) {
                VStack(spacing: 10) {
                    ForEach(attempt.answers.sorted(by: { $0.idx < $1.idx })) { answer in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("Vprašanje \(answer.idx + 1)")
                                    .font(.system(size: 13, weight: .bold))
                                Spacer()
                                Text("\(answer.score ?? 0)/5")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle((answer.score ?? 0) >= 4 ? theme.green : theme.tint)
                            }
                            Text(prompt(for: answer))
                                .font(.system(size: 15, weight: .semibold))
                            if let typed = answer.typedAnswer, !typed.isEmpty {
                                Text("Tvoj odgovor: \(typed)")
                                    .font(.system(size: 14))
                                    .foregroundStyle(theme.secondaryLabel)
                            } else {
                                Text("Tvoj odgovor: Ne vem")
                                    .font(.system(size: 14))
                                    .foregroundStyle(theme.secondaryLabel)
                            }
                            if let rationale = answer.gradingRationale, !rationale.isEmpty {
                                Text(rationale)
                                    .font(.system(size: 14))
                                    .foregroundStyle(theme.label)
                            }
                            if let expected = answer.expectedAnswer, !expected.isEmpty {
                                Text("Pričakovani odgovor: \(expected)")
                                    .font(.system(size: 13.5))
                                    .foregroundStyle(theme.tint)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .memoCard(cornerRadius: 14, padding: 13)
                    }
                }
                .padding(.top, 10)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.label)
            .padding(14)
            .background(theme.surfaceMuted)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func restoreAttempt() {
        let saved = appModel.selectedLectureDetail?.studySession?.practiceTestState
        if let savedID = saved?.currentAttemptId,
           let inProgress = availableAttempts.first(where: { $0.id == savedID && $0.status == "in_progress" })
            ?? availableAttempts.last(where: { $0.status == "in_progress" }) {
            currentAttempt = inProgress
            answers = Dictionary(uniqueKeysWithValues: inProgress.answers.map {
                let key = $0.practiceTestQuestionId ?? $0.id
                return (
                    $0.id,
                    AnswerState(
                        text: saved?.textAnswers[key] ?? $0.typedAnswer ?? "",
                        dontKnow: saved?.unknownQuestionIds.contains(key) ?? $0.declaredUnknown
                    )
                )
            })
        } else if let inProgress = availableAttempts.last(where: { $0.status == "in_progress" }) {
            currentAttempt = inProgress
            answers = Dictionary(uniqueKeysWithValues: inProgress.answers.map {
                ($0.id, AnswerState(text: $0.typedAnswer ?? "", dontKnow: $0.declaredUnknown))
            })
        } else if let viewedID = saved?.latestViewedAttemptId,
                  let viewed = availableAttempts.first(where: { $0.id == viewedID && $0.status == "graded" }) {
            currentAttempt = viewed
        } else if let latest = availableAttempts.last(where: { $0.status == "graded" }) {
            currentAttempt = latest
        }
    }

    private func startAttempt() {
        isStarting = true
        Task {
            defer { isStarting = false }
            if let attempt = await appModel.startPracticeTest(lectureID: lecture.id) {
                currentAttempt = attempt
                answers = [:]
                showBreakdown = false
                persistState()
            }
        }
    }

    private func submit(_ attempt: PracticeTestAttemptRow) {
        isSubmitting = true
        let payload: [[String: Any]] = attempt.answers.map { answer in
            let state = state(answer.id)
            return [
                "answerId": answer.id,
                "typedAnswer": state.text,
                "declaredUnknown": state.dontKnow
            ]
        }
        Task {
            defer { isSubmitting = false }
            if let graded = await appModel.submitPracticeTest(
                lectureID: lecture.id,
                attemptID: attempt.id,
                answers: payload
            ) {
                currentAttempt = graded
                showBreakdown = true
                persistState()
            }
        }
    }

    private func prompt(for answer: PracticeTestAttemptAnswerRow) -> String {
        answer.questionPrompt
            ?? questions.first(where: { $0.id == answer.practiceTestQuestionId })?.prompt
            ?? "Vprašanje ni na voljo."
    }

    private func state(_ id: String) -> AnswerState {
        answers[id] ?? AnswerState()
    }

    private func binding(_ id: String) -> (text: Binding<String>, dontKnow: Binding<Bool>) {
        (
            text: Binding(
                get: { answers[id]?.text ?? "" },
                set: { value in
                    var next = answers[id] ?? AnswerState()
                    next.text = value
                    answers[id] = next
                }
            ),
            dontKnow: Binding(
                get: { answers[id]?.dontKnow ?? false },
                set: { value in
                    var next = answers[id] ?? AnswerState()
                    next.dontKnow = value
                    answers[id] = next
                }
            )
        )
    }

    private func allAnswered(_ attempt: PracticeTestAttemptRow) -> Bool {
        attempt.answers.allSatisfy { answer in
            let value = state(answer.id)
            return value.dontKnow || !value.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func schedulePersistence() {
        persistenceTask?.cancel()
        persistenceTask = Task {
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await MainActor.run { persistState() }
        }
    }

    private func persistState() {
        let attempt = currentAttempt
        let textAnswers = Dictionary(uniqueKeysWithValues: (attempt?.answers ?? []).map { answer in
            let key = answer.practiceTestQuestionId ?? answer.id
            return (key, state(answer.id).text)
        })
        let unknown = (attempt?.answers ?? []).compactMap { answer -> String? in
            guard state(answer.id).dontKnow else { return nil }
            return answer.practiceTestQuestionId ?? answer.id
        }
        let snapshot = PersistedPracticeTestSessionState(
            currentAttemptId: attempt?.status == "in_progress" ? attempt?.id : nil,
            attemptQuestionIds: (attempt?.answers ?? []).compactMap(\.practiceTestQuestionId),
            textAnswers: textAnswers,
            unknownQuestionIds: unknown,
            latestViewedAttemptId: attempt?.status == "graded" ? attempt?.id : nil,
            submittedAt: attempt?.status == "graded" ? attempt?.gradedAt : nil
        )
        Task { await appModel.persistPracticeTestStudyState(lectureID: lecture.id, state: snapshot) }
    }
}
