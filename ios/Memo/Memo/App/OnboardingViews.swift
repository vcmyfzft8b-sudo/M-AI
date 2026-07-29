import SwiftUI

// Native recreation of the web onboarding survey (onboarding-paywall.tsx).
// The survey uses its own near-fixed dark palette with a purple accent,
// matching `memo-onboarding-shell` on the web.

private enum OnboardingPalette {
    static let accent = Color(hex: 0xB28CFF)
    static let accentStrong = Color(hex: 0x7C3AED)
    static let background = Color.black
    static let card = Color(hex: 0x1C1C1E)
    static let cardSoft = Color(hex: 0x242426)
    static let text = Color.white
    static let muted = Color(hex: 0x9B99A3)
    static let progressTrack = Color(hex: 0x231A35)
    static let optionIcon = Color(hex: 0x2C2C2E)
}

private struct OnboardingOption: Identifiable {
    let id: String
    let emoji: String
    let label: String
    var detail: String?
}

struct OnboardingView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var step = 0
    @State private var isSaving = false

    // Answers
    @State private var discoverySource: String?
    @State private var audience: String?
    @State private var role: String?
    @State private var school: String?
    @State private var year: String?
    @State private var studyField: String?
    @State private var motivation: String?
    @State private var currentGrade: Double = 4.0
    @State private var currentGradeTouched = false
    @State private var targetGrade: Double = 4.5
    @State private var targetGradeTouched = false
    @State private var favoriteFeature: String?
    @State private var subjectFocus: String?
    @State private var dailyGoal: String?

    private let totalSteps = 15

    var body: some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 20)
                .padding(.top, 8)

            ScrollView(showsIndicators: false) {
                stepContent
                    .padding(.horizontal, 20)
                    .padding(.top, 26)
                    .padding(.bottom, 24)
            }

            actionArea
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OnboardingPalette.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .animation(.easeOut(duration: 0.24), value: step)
    }

    // MARK: - Chrome

    private var topBar: some View {
        HStack(spacing: 14) {
            MemoBackIconButton(foreground: OnboardingPalette.text) {
                goBack()
            }
            .opacity(step == 0 ? 0 : 1)
            .disabled(step == 0)

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(OnboardingPalette.progressTrack)
                    Capsule()
                        .fill(OnboardingPalette.accentStrong)
                        .frame(width: proxy.size.width * CGFloat(step + 1) / CGFloat(totalSteps))
                        .animation(.easeOut(duration: 0.3), value: step)
                }
            }
            .frame(height: 14)

            Color.clear.frame(width: 40, height: 40)
        }
    }

    // MARK: - Steps

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case 0:
            optionStep(
                title: "Kako si izvedel/a za Memo AI?",
                options: [
                    .init(id: "instagram", emoji: "📸", label: "Instagram Reels"),
                    .init(id: "tiktok", emoji: "🎵", label: "TikTok"),
                    .init(id: "chatgpt", emoji: "🤖", label: "ChatGPT"),
                    .init(id: "friend", emoji: "💬", label: "Prijatelj"),
                    .init(id: "other", emoji: "✏️", label: "Drugo")
                ],
                selection: $discoverySource
            )
        case 1:
            optionStep(
                title: "Za koga je Memo AI?",
                options: [
                    .init(id: "me", emoji: "🌱", label: "Zame"),
                    .init(id: "family", emoji: "🌳", label: "Zame + družina"),
                    .init(id: "someone_else", emoji: "🎁", label: "Za nekoga drugega (ne zame)")
                ],
                selection: $audience
            )
        case 2:
            optionStep(
                title: "Kaj te najbolje opiše?",
                options: [
                    .init(id: "worker", emoji: "💼", label: "Zaposlen/a", detail: "Sestanki, glasovni zapiski in drugo"),
                    .init(id: "elementary", emoji: "📘", label: "Osnovnošolec", detail: "Učenje, domače naloge in priprava na teste"),
                    .init(id: "high_school", emoji: "📚", label: "Dijak", detail: "Zapiski, testi in matura"),
                    .init(id: "university", emoji: "🎓", label: "Študent", detail: "Predavanja, izpiti/testi in študijsko gradivo"),
                    .init(id: "parent", emoji: "👨‍👩‍👧", label: "Starš", detail: "Preizkus za otroka ali darilo naročnine"),
                    .init(id: "teacher", emoji: "🧑‍🏫", label: "Učitelj/profesor", detail: "Snemanje predavanj, deljenje zapiskov ali drugo")
                ],
                selection: $role
            )
        case 3:
            optionStep(title: "Kje se šolaš?", options: schoolOptions, selection: $school)
        case 4:
            optionStep(
                title: role == "elementary" ? "Kateri razred si?" : "Kateri letnik si?",
                options: yearOptions,
                selection: $year
            )
        case 5:
            optionStep(
                title: "Katero je tvoje glavno področje študija?",
                options: [
                    .init(id: "arts", emoji: "🎨", label: "Umetnost in humanistika"),
                    .init(id: "economics", emoji: "💼", label: "Ekonomija"),
                    .init(id: "cs", emoji: "💻", label: "Računalništvo"),
                    .init(id: "math", emoji: "📐", label: "Matematika"),
                    .init(id: "education", emoji: "📚", label: "Pedagoške smeri"),
                    .init(id: "engineering", emoji: "⚙️", label: "Inženirstvo in tehnologija"),
                    .init(id: "health", emoji: "🏥", label: "Zdravstvo in medicina"),
                    .init(id: "law", emoji: "⚖️", label: "Pravo"),
                    .init(id: "science", emoji: "🔬", label: "Naravoslovje"),
                    .init(id: "social", emoji: "🌍", label: "Družboslovje")
                ],
                selection: $studyField
            )
        case 6:
            socialProofStep
        case 7:
            optionStep(
                title: "Kaj te pripelje v Memo AI?",
                options: [
                    .init(id: "grades", emoji: "💯", label: "Izboljšati ocene"),
                    .init(id: "faster", emoji: "📗", label: "Učiti se 10x hitreje"),
                    .init(id: "follow", emoji: "🎙️", label: "Bolje slediti predavanjem"),
                    .init(id: "details", emoji: "📈", label: "Ne zamuditi podrobnosti na predavanju"),
                    .init(id: "other", emoji: "✍️", label: "Nekaj drugega")
                ],
                selection: $motivation,
                autoAdvance: false
            )
        case 8:
            gradeStep(
                title: "Kakšna je tvoja povprečna ocena zdaj?",
                subtitle: "Približek je v redu.",
                value: $currentGrade,
                touched: $currentGradeTouched
            )
        case 9:
            gradeStep(
                title: "Kakšna je tvoja ciljna povprečna ocena?",
                subtitle: nil,
                value: $targetGrade,
                touched: $targetGradeTouched
            )
        case 10:
            testimonialStep
        case 11:
            progressStoryStep
        case 12:
            featureGridStep
        case 13:
            optionStep(
                title: "Imaš v mislih določen predmet ali izpit/test, pri katerem naj ti Memo AI pomaga?",
                options: [
                    .init(id: "subject", emoji: "📗", label: "Da, določen predmet"),
                    .init(id: "exam", emoji: "📅", label: "Da, prihajajoči izpit/test"),
                    .init(id: "other", emoji: "👀", label: "Da, nekaj drugega"),
                    .init(id: "general", emoji: "📈", label: "Ne, pomagaj mi na splošno")
                ],
                selection: $subjectFocus
            )
        default:
            optionStep(
                title: "Kakšen je tvoj dnevni študijski cilj?",
                options: [
                    .init(id: "casual", emoji: "🍃", label: "Sproščeno - 10 min / dan"),
                    .init(id: "regular", emoji: "🌱", label: "Redno - 20 min / dan"),
                    .init(id: "serious", emoji: "🌿", label: "Resno - 60 min / dan"),
                    .init(id: "intense", emoji: "🌳", label: "Intenzivno - 90+ min / dan")
                ],
                selection: $dailyGoal,
                autoAdvance: false
            )
        }
    }

    private var schoolOptions: [OnboardingOption] {
        switch role {
        case "elementary":
            [
                .init(id: "elementary", emoji: "🏫", label: "Osnovna šola"),
                .init(id: "other", emoji: "✍️", label: "Nekaj drugega")
            ]
        case "high_school":
            [
                .init(id: "gimnazija", emoji: "📘", label: "Gimnazija"),
                .init(id: "strokovna", emoji: "🧰", label: "Srednja strokovna šola"),
                .init(id: "poklicna", emoji: "🔧", label: "Poklicna šola"),
                .init(id: "other", emoji: "✍️", label: "Nekaj drugega")
            ]
        default:
            [
                .init(id: "univerza", emoji: "📚", label: "Fakulteta/univerza"),
                .init(id: "visja", emoji: "🎓", label: "Višja šola"),
                .init(id: "other", emoji: "✍️", label: "Nekaj drugega")
            ]
        }
    }

    private var yearOptions: [OnboardingOption] {
        switch role {
        case "elementary":
            let emojis = ["🌱", "🌿", "🪴", "🌳", "📗", "📘", "📙", "📕", "🎒"]
            return (1...9).map { grade in
                .init(id: "grade_\(grade)", emoji: emojis[grade - 1], label: "\(grade). razred")
            }
        case "high_school":
            let maxYear = school == "gimnazija" ? 4 : 5
            let emojis = ["🌱", "🌿", "🪴", "🌳", "🍂"]
            return (1...maxYear).map { year in
                .init(id: "year_\(year)", emoji: emojis[year - 1], label: "\(year). letnik")
            }
        default:
            return [
                .init(id: "year_4plus", emoji: "🌳", label: "4. letnik ali več"),
                .init(id: "year_3", emoji: "🪴", label: "3. letnik"),
                .init(id: "year_2", emoji: "🌿", label: "2. letnik"),
                .init(id: "year_1", emoji: "🌱", label: "1. letnik"),
                .init(id: "postgrad", emoji: "🍂", label: "Podiplomski študij")
            ]
        }
    }

    // MARK: - Step builders

    private func optionStep(
        title: String,
        options: [OnboardingOption],
        selection: Binding<String?>,
        autoAdvance: Bool = true
    ) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(title)
                .font(.system(size: 27, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)

            VStack(spacing: 11) {
                ForEach(options) { option in
                    Button {
                        selection.wrappedValue = option.id
                        if autoAdvance {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                                advance()
                            }
                        }
                    } label: {
                        HStack(spacing: 15) {
                            Text(option.emoji)
                                .font(.system(size: 26))
                                .frame(width: 52, height: 52)
                                .background(OnboardingPalette.optionIcon)
                                .clipShape(Circle())
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.label)
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(OnboardingPalette.text)
                                    .multilineTextAlignment(.leading)
                                if let detail = option.detail {
                                    Text(detail)
                                        .font(.system(size: 13.5))
                                        .foregroundStyle(OnboardingPalette.muted)
                                        .multilineTextAlignment(.leading)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 15)
                        .frame(maxWidth: .infinity, minHeight: 81, alignment: .leading)
                        .background(OnboardingPalette.card)
                        .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 25, style: .continuous)
                                .stroke(
                                    selection.wrappedValue == option.id
                                        ? OnboardingPalette.accent
                                        : Color.clear,
                                    lineWidth: 2
                                )
                        )
                    }
                }
            }
        }
    }

    private func gradeStep(
        title: String,
        subtitle: String?,
        value: Binding<Double>,
        touched: Binding<Bool>
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 27, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(OnboardingPalette.muted)
            }

            HStack(spacing: 26) {
                gradeButton(symbol: "minus") {
                    value.wrappedValue = max(1.0, (value.wrappedValue * 10 - 1).rounded() / 10)
                    touched.wrappedValue = true
                }
                Text(String(format: "%.1f", value.wrappedValue))
                    .font(.system(size: 62, weight: .bold, design: .rounded))
                    .foregroundStyle(OnboardingPalette.accent)
                    .frame(minWidth: 140)
                    .contentTransition(.numericText())
                gradeButton(symbol: "plus") {
                    value.wrappedValue = min(5.0, (value.wrappedValue * 10 + 1).rounded() / 10)
                    touched.wrappedValue = true
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 44)
            .background(OnboardingPalette.card)
            .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
            .padding(.top, 16)
        }
    }

    private func gradeButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)
                .frame(width: 56, height: 56)
                .background(OnboardingPalette.cardSoft)
                .clipShape(Circle())
        }
    }

    private var socialProofStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Si v dobri družbi!")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)
            Text("Veliko tvojih sošolcev že uporablja Memo AI za:")
                .font(.system(size: 16))
                .foregroundStyle(OnboardingPalette.muted)

            VStack(alignment: .leading, spacing: 14) {
                ForEach([
                    "Podrobne zapiske s predavanj",
                    "AI vaje za izpite/teste",
                    "Natančne prepise",
                    "Klepet z dolgimi PDF-ji in dokumenti"
                ], id: \.self) { line in
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(OnboardingPalette.accent)
                        Text(line)
                            .font(.system(size: 16.5, weight: .medium))
                            .foregroundStyle(OnboardingPalette.text)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OnboardingPalette.card)
            .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
            .padding(.top, 8)
        }
    }

    private var testimonialStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Na pravem mestu si.")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)

            VStack(alignment: .leading, spacing: 12) {
                Text("Študent financ")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(OnboardingPalette.text)
                Text("Univerza v Ljubljani")
                    .font(.system(size: 13.5))
                    .foregroundStyle(OnboardingPalette.muted)
                Text("\u{201E}Nepogrešljivo za hiter tempo na fakulteti. V predavalnici sem bolj miren, ker vem, da lahko pozneje znova pregledam vse pomembne razlage.\u{201C}")
                    .font(.system(size: 16))
                    .foregroundStyle(OnboardingPalette.text)
                    .lineSpacing(4)
                HStack(spacing: 3) {
                    ForEach(0..<5, id: \.self) { _ in
                        Image(systemName: "star.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Color.yellow)
                    }
                }
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OnboardingPalette.card)
            .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
        }
    }

    private var progressStoryStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Naredil/a si prvi korak!")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)
            Text("Z rednim delom ti Memo AI pomaga doseči dolgoročen napredek.")
                .font(.system(size: 16))
                .foregroundStyle(OnboardingPalette.muted)

            VStack(alignment: .leading, spacing: 14) {
                Text("Tvoje ocene")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OnboardingPalette.text)
                ProgressChart()
                    .frame(height: 150)
                HStack(spacing: 18) {
                    legendDot(color: OnboardingPalette.accent, label: "z Memo AI")
                    legendDot(color: OnboardingPalette.muted, label: "samostojno")
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OnboardingPalette.card)
            .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
        }
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 7) {
            Circle().fill(color).frame(width: 9, height: 9)
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(OnboardingPalette.muted)
        }
    }

    private var featureGridStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Kateri del Memo AI-ja ti bo najbolj pomagal?")
                .font(.system(size: 27, weight: .bold))
                .foregroundStyle(OnboardingPalette.text)

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach([
                    OnboardingOption(id: "audio", emoji: "🎧", label: "Audio zapiski"),
                    OnboardingOption(id: "quizzes", emoji: "📝", label: "Kvizi"),
                    OnboardingOption(id: "flashcards", emoji: "🃏", label: "Flashcards"),
                    OnboardingOption(id: "personalization", emoji: "✨", label: "Personalizacija zapiskov"),
                    OnboardingOption(id: "tests", emoji: "✅", label: "Testi"),
                    OnboardingOption(id: "read_aloud", emoji: "🔊", label: "Branje zapiskov")
                ]) { option in
                    Button {
                        favoriteFeature = option.id
                    } label: {
                        VStack(spacing: 12) {
                            Text(option.emoji)
                                .font(.system(size: 42))
                            Text(option.label)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(OnboardingPalette.text)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity, minHeight: 132)
                        .background(OnboardingPalette.card)
                        .clipShape(RoundedRectangle(cornerRadius: 29, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 29, style: .continuous)
                                .stroke(
                                    favoriteFeature == option.id ? OnboardingPalette.accent : Color.clear,
                                    lineWidth: 2.5
                                )
                        )
                    }
                }
            }
        }
    }

    // MARK: - Actions

    @ViewBuilder
    private var actionArea: some View {
        if showsActionButton {
            Button {
                if step == totalSteps - 1 {
                    finish()
                } else {
                    advance()
                }
            } label: {
                HStack(spacing: 8) {
                    if isSaving {
                        ProgressView().tint(.black)
                    } else {
                        Text(actionLabel)
                            .font(.system(size: 18, weight: .bold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 16, weight: .bold))
                    }
                }
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, minHeight: 69)
                .background(.white)
                .clipShape(Capsule())
            }
            .disabled(actionDisabled || isSaving)
            .opacity(actionDisabled ? 0.4 : 1)
        }
    }

    private var showsActionButton: Bool {
        [6, 7, 8, 9, 10, 11, 12, 14].contains(step)
    }

    private var actionLabel: String {
        switch step {
        case 8: currentGradeTouched ? "Nadaljuj" : "Preskoči"
        case 9: targetGradeTouched ? "Nadaljuj" : "Preskoči"
        case 14: "Končaj"
        default: "Nadaljuj"
        }
    }

    private var actionDisabled: Bool {
        switch step {
        case 7: motivation == nil
        case 12: favoriteFeature == nil
        case 14: dailyGoal == nil
        default: false
        }
    }

    private var isStudentRole: Bool {
        ["elementary", "high_school", "university"].contains(role ?? "")
    }

    private func advance() {
        var next = step + 1
        // Branching mirrors the web survey: non-students skip school/year (2 -> 7),
        // only university roles answer the study-field question.
        if step == 2, !isStudentRole {
            next = 7
        } else if step == 4, role != "university" {
            next = 6
        }
        step = min(next, totalSteps - 1)
    }

    private func goBack() {
        var previous = step - 1
        if step == 7, !isStudentRole {
            previous = 2
        } else if step == 6, role != "university" {
            previous = 4
        }
        step = max(previous, 0)
    }

    private func finish() {
        isSaving = true
        var answers = OnboardingAnswers()
        answers.ageRange = derivedAgeRange
        answers.educationLevel = derivedEducationLevel
        answers.currentAverageGrade = currentGradeTouched ? String(format: "%.1f", currentGrade) : "unknown"
        answers.targetGrade = targetGradeTouched ? String(format: "%.1f", targetGrade) : "unknown"
        answers.studyGoal = motivation ?? dailyGoal ?? "general"
        Task {
            await appModel.completeOnboarding(answers)
            isSaving = false
        }
    }

    private var derivedAgeRange: String {
        switch role {
        case "elementary": "under_16"
        case "high_school": "16_18"
        case "university": "19_22"
        case "worker", "teacher", "parent": "30_plus"
        default: "23_29"
        }
    }

    private var derivedEducationLevel: String {
        switch role {
        case "elementary", "high_school": "high_school"
        case "university": year == "postgrad" ? "masters" : "university"
        case "worker": "self_study"
        default: "other"
        }
    }
}

/// Simple two-line progress chart for the onboarding story step.
private struct ProgressChart: View {
    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            ZStack {
                chartLine(
                    points: [0.75, 0.72, 0.68, 0.66, 0.64, 0.62],
                    width: width,
                    height: height
                )
                .stroke(OnboardingPalette.muted, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                chartLine(
                    points: [0.75, 0.62, 0.5, 0.38, 0.26, 0.14],
                    width: width,
                    height: height
                )
                .stroke(OnboardingPalette.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
        }
    }

    private func chartLine(points: [Double], width: CGFloat, height: CGFloat) -> Path {
        Path { path in
            for (index, point) in points.enumerated() {
                let x = width * CGFloat(index) / CGFloat(points.count - 1)
                let y = height * CGFloat(point)
                if index == 0 {
                    path.move(to: CGPoint(x: x, y: y))
                } else {
                    path.addLine(to: CGPoint(x: x, y: y))
                }
            }
        }
    }
}
