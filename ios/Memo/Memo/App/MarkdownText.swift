import SwiftUI
import UIKit

// Lightweight block-level markdown renderer matching the web app's note styling
// (src/components/markdown-renderer.tsx). SwiftUI's AttributedString handles the
// inline spans; this adds headings, lists, quotes, code blocks, and tables.

enum MarkdownTextStyle {
    case note
    case help
    case chat
}

struct MarkdownText: View {
    @Environment(\.memoTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    let markdown: String
    var completedWordIndex: Int = -1
    var currentWordIndex: Int?
    var readAlongColorID: String?
    var style: MarkdownTextStyle = .note

    init(
        markdown: String,
        completedWordIndex: Int = -1,
        currentWordIndex: Int? = nil,
        readAlongColorID: String? = nil,
        style: MarkdownTextStyle = .note
    ) {
        self.markdown = markdown
        self.completedWordIndex = completedWordIndex
        self.currentWordIndex = currentWordIndex
        self.readAlongColorID = readAlongColorID
        self.style = style
    }

    var body: some View {
        VStack(alignment: .leading, spacing: blockSpacing) {
            ForEach(Array(indexedBlocks.enumerated()), id: \.offset) { _, indexed in
                blockView(indexed.block, startingAt: indexed.wordStartIndex)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock, startingAt startIndex: Int) -> some View {
        switch block {
        case .heading(let level, let text):
            inline(text, startingAt: startIndex)
                .font(headingFont(level))
                .foregroundStyle(theme.label)
                .padding(.top, level <= 2 ? 8 : 4)
        case .paragraph(let text):
            inline(text, startingAt: startIndex)
                .font(.system(size: bodyFontSize))
                .foregroundStyle(theme.label)
                .lineSpacing(bodyLineSpacing)
        case .bullet(let items):
            VStack(alignment: .leading, spacing: listItemSpacing) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle()
                            .fill(theme.secondaryLabel)
                            .frame(width: 5, height: 5)
                            .padding(.top, 7)
                        inline(item, startingAt: startIndex + wordCount(in: items.prefix(index)))
                            .font(.system(size: bodyFontSize))
                            .foregroundStyle(theme.label)
                            .lineSpacing(bodyLineSpacing)
                    }
                }
            }
        case .numbered(let items):
            VStack(alignment: .leading, spacing: listItemSpacing) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(index + 1).")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(theme.secondaryLabel)
                        inline(item, startingAt: startIndex + wordCount(in: items.prefix(index)))
                            .font(.system(size: bodyFontSize))
                            .foregroundStyle(theme.label)
                            .lineSpacing(bodyLineSpacing)
                    }
                }
            }
        case .quote(let text):
            let callout = NoteCalloutAppearance(text: text, colorScheme: colorScheme)
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(callout.accent)
                    .frame(width: 4)
                inline(text, startingAt: startIndex)
                    .font(.system(size: bodyFontSize))
                    .foregroundStyle(theme.label)
                    .lineSpacing(bodyLineSpacing)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 13)
            .padding(.horizontal, 14)
            .background(callout.background)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(callout.border, lineWidth: 1)
            )
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(theme.label)
                    .padding(12)
            }
            .background(theme.surfaceMuted)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        case .table(let rows):
            tableView(rows, startingAt: startIndex)
        case .divider:
            Rectangle()
                .fill(theme.separator)
                .frame(height: 1)
                .padding(.vertical, 4)
        }
    }

    private func tableView(_ rows: [[String]], startingAt startIndex: Int) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { cellIndex, cell in
                            inline(
                                cell,
                                startingAt: startIndex + wordCount(in: rows.prefix(rowIndex)) + wordCount(in: row.prefix(cellIndex))
                            )
                                .font(.system(size: 14, weight: rowIndex == 0 ? .semibold : .regular))
                                .foregroundStyle(theme.label)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .background(rowIndex == 0 ? AnyShapeStyle(theme.surfaceMuted) : AnyShapeStyle(.clear))
                    if rowIndex < rows.count - 1 {
                        Divider().overlay(theme.separator)
                    }
                }
            }
        }
        .background(theme.surfaceSolid)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(theme.separator, lineWidth: 1)
        )
    }

    private func headingFont(_ level: Int) -> Font {
        if style == .help {
            switch level {
            case 1: return .system(size: 24, weight: .bold)
            case 2: return .system(size: 22.4, weight: .semibold)
            case 3: return .system(size: 17, weight: .semibold)
            default: return .system(size: 16, weight: .semibold)
            }
        }
        switch level {
        case 1: return .system(size: 24, weight: .bold)
        case 2: return .system(size: 21, weight: .bold)
        case 3: return .system(size: 17, weight: .semibold)
        default: return .system(size: 16, weight: .semibold)
        }
    }

    private var bodyFontSize: CGFloat {
        switch style {
        case .help: 14
        case .chat: 15.5
        case .note: 17
        }
    }

    private var bodyLineSpacing: CGFloat {
        switch style {
        case .help: 5.4
        case .chat: 10.8
        case .note: 9
        }
    }

    private var blockSpacing: CGFloat {
        switch style {
        case .help: 14
        case .chat: 10
        case .note: 13
        }
    }

    private var listItemSpacing: CGFloat { style == .help ? 0 : 8 }

    private func inline(_ text: String, startingAt startIndex: Int) -> Text {
        let rendered = NativeMathTextRenderer.render(text)
        if var attributed = try? AttributedString(
            markdown: rendered,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            applyReadAlong(to: &attributed, startingAt: startIndex)
            return Text(attributed)
        }
        return Text(rendered)
    }

    private var indexedBlocks: [(block: MarkdownBlock, wordStartIndex: Int)] {
        var nextWordIndex = 0
        return MarkdownBlock.parse(markdown).map { block in
            let indexed = (block, nextWordIndex)
            nextWordIndex += wordCount(in: block)
            return indexed
        }
    }

    private func wordCount(in block: MarkdownBlock) -> Int {
        switch block {
        case .heading(_, let text), .paragraph(let text), .quote(let text):
            wordCount(in: text)
        case .bullet(let items), .numbered(let items):
            wordCount(in: items[...])
        case .table(let rows):
            rows.reduce(0) { $0 + wordCount(in: $1[...]) }
        case .code, .divider:
            0
        }
    }

    private func wordCount<C: Collection>(in strings: C) -> Int where C.Element == String {
        strings.reduce(0) { $0 + wordCount(in: $1) }
    }

    private func wordCount<C: Collection>(in rows: C) -> Int where C.Element == [String] {
        rows.reduce(0) { $0 + wordCount(in: $1[...]) }
    }

    private func wordCount(in text: String) -> Int {
        let rendered = NativeMathTextRenderer.render(text)
        let plain = (try? AttributedString(
            markdown: rendered,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )).map { String($0.characters) } ?? text
        return NoteReadWordTokenizer.matches(in: plain).count
    }

    private func applyReadAlong(to attributed: inout AttributedString, startingAt startIndex: Int) {
        guard let readAlongColorID else { return }
        let plain = String(attributed.characters)
        for (offset, range) in NoteReadWordTokenizer.matches(in: plain).enumerated() {
            let wordIndex = startIndex + offset
            guard wordIndex <= completedWordIndex || wordIndex == currentWordIndex else { continue }
            guard let lower = AttributedString.Index(range.lowerBound, within: attributed),
                  let upper = AttributedString.Index(range.upperBound, within: attributed) else { continue }
            if wordIndex == currentWordIndex {
                attributed[lower..<upper].backgroundColor = NoteReadHighlightPalette.current(readAlongColorID)
                attributed[lower..<upper].foregroundColor = NoteReadHighlightPalette.currentText(readAlongColorID)
            } else {
                attributed[lower..<upper].backgroundColor = NoteReadHighlightPalette.read(readAlongColorID)
                attributed[lower..<upper].foregroundColor = NoteReadHighlightPalette.readText(readAlongColorID)
            }
        }
    }
}

/// A native, offline-safe presentation of the LaTeX emitted by the same note
/// pipeline used on web. It preserves readable mathematical semantics in a
/// selectable `Text`/`UITextView` (including chemical subscripts) instead of
/// exposing raw commands when KaTeX is unavailable to SwiftUI.
enum NativeMathTextRenderer {
    private static let symbols: [(String, String)] = [
        (#"\\rightarrow|\\to"#, "→"), (#"\\leftarrow"#, "←"),
        (#"\\leftrightarrow"#, "↔"), (#"\\times"#, "×"), (#"\\cdot"#, "·"),
        (#"\\leq?|≤"#, "≤"), (#"\\geq?|≥"#, "≥"), (#"\\neq?|≠"#, "≠"),
        (#"\\approx"#, "≈"), (#"\\infty"#, "∞"), (#"\\pm"#, "±"),
        (#"\\sum"#, "∑"), (#"\\prod"#, "∏"), (#"\\int"#, "∫"),
        (#"\\alpha"#, "α"), (#"\\beta"#, "β"), (#"\\gamma"#, "γ"),
        (#"\\delta"#, "δ"), (#"\\theta"#, "θ"), (#"\\lambda"#, "λ"),
        (#"\\mu"#, "μ"), (#"\\pi"#, "π"), (#"\\rho"#, "ρ"),
        (#"\\sigma"#, "σ"), (#"\\omega"#, "ω")
    ]
    private static let subscripts = Dictionary(uniqueKeysWithValues: zip(
        "0123456789+-=()aehijklmnoprstuvx",
        "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"
    ))
    private static let superscripts = Dictionary(uniqueKeysWithValues: zip(
        "0123456789+-=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW",
        "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ"
    ))

    static func render(_ source: String) -> String {
        var value = repairDroppedCommandControls(source)
            .replacingOccurrences(
                of: #"(?i)(Svetlobna energija)\s+o\s+(?=[A-Z][A-Za-z]?[_\d{])"#,
                with: "$1 → ",
                options: .regularExpression
            )
            .replacingOccurrences(of: #"\["#, with: "")
            .replacingOccurrences(of: #"\]"#, with: "")
            .replacingOccurrences(of: #"\("#, with: "")
            .replacingOccurrences(of: #"\)"#, with: "")
            .replacingOccurrences(of: "$$", with: "")
            .replacingOccurrences(of: "$", with: "")

        value = value
            .replacingOccurrences(of: #"(?<![\\A-Za-z])(?:dfrac|tfrac|frac|rac)\s*\{"#, with: #"\\frac{"#, options: .regularExpression)
            .replacingOccurrences(of: #"(?<![\\A-Za-z])(?:text|ext)\s*\{"#, with: #"\\text{"#, options: .regularExpression)
            .replacingOccurrences(of: #"(?<![\\A-Za-z])sqrt\s*\{"#, with: #"\\sqrt{"#, options: .regularExpression)

        value = replaceFractions(in: value)
        value = replaceCommandWithBracedContent(#"\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}"#, in: value) { $0 }
        value = replaceCommandWithBracedContent(#"\\sqrt\s*\{([^{}]*)\}"#, in: value) { "√(\($0))" }
        for (pattern, replacement) in symbols {
            value = value.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        value = replaceScripts(in: value, marker: "_", map: subscripts)
        value = replaceScripts(in: value, marker: "^", map: superscripts)
        value = value
            .replacingOccurrences(of: #"\\(?:begin|end)\{[^{}]+\}"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\\[,;! ]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\\([A-Za-z]+)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "{", with: "")
            .replacingOccurrences(of: "}", with: "")
        return value
    }

    static func repairDroppedCommandControls(_ source: String) -> String {
        source
            .replacingOccurrences(of: "\t" + "ext{", with: #"\text{"#)
            .replacingOccurrences(of: "\t" + "imes", with: #"\times"#)
            .replacingOccurrences(of: "\t" + "heta", with: #"\theta"#)
            .replacingOccurrences(of: "\t" + "o ", with: #"\to "#)
            .replacingOccurrences(of: "\r" + "ho", with: #"\rho"#)
            .replacingOccurrences(of: "\u{0008}" + "eta", with: #"\beta"#)
            .replacingOccurrences(of: "\u{000C}" + "rac{", with: #"\frac{"#)
    }

    private static func replaceFractions(in source: String) -> String {
        var value = source
        let pattern = #"\\(?:d?frac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#
        for _ in 0..<6 {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
                  let whole = Range(match.range(at: 0), in: value),
                  let numerator = Range(match.range(at: 1), in: value),
                  let denominator = Range(match.range(at: 2), in: value) else { break }
            value.replaceSubrange(whole, with: "\(value[numerator])⁄\(value[denominator])")
        }
        return value
    }

    private static func replaceCommandWithBracedContent(
        _ pattern: String,
        in source: String,
        transform: (String) -> String
    ) -> String {
        var value = source
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
        while let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              let whole = Range(match.range(at: 0), in: value),
              let content = Range(match.range(at: 1), in: value) {
            value.replaceSubrange(whole, with: transform(String(value[content])))
        }
        return value
    }

    private static func replaceScripts(in source: String, marker: Character, map: [Character: Character]) -> String {
        var output = ""
        var index = source.startIndex
        while index < source.endIndex {
            guard source[index] == marker else {
                output.append(source[index]); index = source.index(after: index); continue
            }
            let next = source.index(after: index)
            guard next < source.endIndex else { output.append(marker); break }
            if source[next] == "{", let close = source[next...].firstIndex(of: "}") {
                let content = source[source.index(after: next)..<close]
                let converted = content.map { map[$0] ?? $0 }
                output.append(contentsOf: converted)
                index = source.index(after: close)
            } else if let converted = map[source[next]] {
                output.append(converted)
                index = source.index(after: next)
            } else {
                output.append(marker)
                index = next
            }
        }
        return output
    }
}

struct NoteCalloutAppearance {
    let accent: Color
    let background: Color
    let border: Color

    init(text: String, colorScheme: ColorScheme) {
        let folded = text
            .replacingOccurrences(of: #"[*_`~]"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .lowercased()
        let dark = colorScheme == .dark
        let colors: (UInt32, UInt32)
        if folded.hasPrefix("kljucno") || folded.hasPrefix("pomembno") || folded.hasPrefix("key takeaway") {
            colors = (0xF59E0B, dark ? 0xB45309 : 0xFEF3C7)
        } else if folded.hasPrefix("definicija") || folded.hasPrefix("definition") {
            colors = (0x2563EB, dark ? 0x1D4ED8 : 0xDBEAFE)
        } else if folded.hasPrefix("primer") || folded.hasPrefix("example") {
            colors = (0x16A34A, dark ? 0x15803D : 0xDCFCE7)
        } else if folded.hasPrefix("pogosta napaka") || folded.hasPrefix("common mistake") {
            colors = (0xDC2626, dark ? 0xB91C1C : 0xFEE2E2)
        } else {
            colors = (0x0EA5E9, dark ? 0x075985 : 0xE0F2FE)
        }
        accent = Color(hex: colors.0)
        background = Color(hex: colors.1).opacity(dark ? 0.22 : 0.44)
        border = Color(hex: colors.0).opacity(dark ? 0.30 : 0.22)
    }
}

struct NoteWordSelection: Equatable {
    let startWordIndex: Int
    let endWordIndex: Int
    let blockID: String
}

/// Selectable note renderer used by the native lecture workspace. A UIKit text
/// view is intentional here: unlike SwiftUI's `Text.textSelection`, it reports
/// the selected range so the same highlight/underline document mutations used
/// by the web workspace can be persisted by iOS.
struct SelectableAnnotatedMarkdownText: UIViewRepresentable {
    let markdown: String
    let annotations: [NoteAnnotation]
    let completedWordIndex: Int
    let currentWordIndex: Int?
    let readAlongColorID: String?
    var blockRange: Range<Int>? = nil
    @Binding var selection: NoteWordSelection?

    func makeCoordinator() -> Coordinator {
        Coordinator(selection: $selection)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let annotationSignature = annotations.map {
            "\($0.id):\($0.kind):\($0.startWordIndex):\($0.endWordIndex):\($0.colorId ?? "")"
        }.joined(separator: "|")
        let rangeSignature = blockRange.map { "\($0.lowerBound)-\($0.upperBound)" } ?? "all"
        let signature = "\(markdown.hashValue):\(annotationSignature):\(completedWordIndex):\(currentWordIndex ?? -1):\(readAlongColorID ?? ""):\(rangeSignature)"
        guard context.coordinator.signature != signature else { return }
        let document = NativeNoteAttributedBuilder.build(
            markdown: markdown,
            annotations: annotations,
            completedWordIndex: completedWordIndex,
            currentWordIndex: currentWordIndex,
            readAlongColorID: readAlongColorID,
            blockRange: blockRange
        )
        context.coordinator.isUpdating = true
        context.coordinator.wordRanges = document.wordRanges
        context.coordinator.globalWordIndexes = document.globalWordIndexes
        context.coordinator.blockIDs = document.blockIDs
        context.coordinator.signature = signature
        view.attributedText = document.text
        view.selectedRange = NSRange(location: 0, length: 0)
        context.coordinator.isUpdating = false
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let measured = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(measured.height))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        @Binding var selection: NoteWordSelection?
        var wordRanges: [NSRange] = []
        var globalWordIndexes: [Int] = []
        var blockIDs: [String] = []
        var signature = ""
        var isUpdating = false

        init(selection: Binding<NoteWordSelection?>) {
            _selection = selection
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !isUpdating else { return }
            let range = textView.selectedRange
            guard range.length > 0 else {
                if selection != nil { selection = nil }
                return
            }
            let indexes = wordRanges.indices.filter { NSIntersectionRange(wordRanges[$0], range).length > 0 }
            guard let first = indexes.first, let last = indexes.last else {
                selection = nil
                return
            }
            selection = NoteWordSelection(
                startWordIndex: globalWordIndexes[first],
                endWordIndex: globalWordIndexes[last],
                blockID: blockIDs[first]
            )
        }
    }
}

private enum NativeNoteAttributedBuilder {
    struct Document {
        let text: NSAttributedString
        let wordRanges: [NSRange]
        let globalWordIndexes: [Int]
        let blockIDs: [String]
    }

    static func build(
        markdown: String,
        annotations: [NoteAnnotation],
        completedWordIndex: Int,
        currentWordIndex: Int?,
        readAlongColorID: String?,
        blockRange: Range<Int>? = nil
    ) -> Document {
        let result = NSMutableAttributedString(string: "")
        var wordRanges: [NSRange] = []
        var globalWordIndexes: [Int] = []
        var blockIDs: [String] = []
        var nextGlobalWordIndex = 0

        for (blockIndex, block) in MarkdownBlock.parse(markdown).enumerated() {
            let blockWordCount = wordCount(in: block)
            defer { nextGlobalWordIndex += blockWordCount }
            if let blockRange, !blockRange.contains(blockIndex) { continue }
            let blockID = "note-tts-block-\(blockIndex)"
            let localStart = wordRanges.count
            switch block {
            case .heading(let level, let text):
                append(
                    text,
                    font: headingFont(level),
                    paragraphSpacing: 12,
                    blockID: blockID,
                    to: result,
                    wordRanges: &wordRanges,
                    blockIDs: &blockIDs
                )
            case .paragraph(let text):
                append(text, font: .systemFont(ofSize: 17), paragraphSpacing: 13, blockID: blockID, to: result, wordRanges: &wordRanges, blockIDs: &blockIDs)
            case .bullet(let items):
                for item in items {
                    append("•  \(item)", font: .systemFont(ofSize: 17), paragraphSpacing: 8, firstLineIndent: 0, headIndent: 18, blockID: blockID, to: result, wordRanges: &wordRanges, blockIDs: &blockIDs, ignoredLeadingWords: 0)
                }
            case .numbered(let items):
                for (index, item) in items.enumerated() {
                    append("\(index + 1).  \(item)", font: .systemFont(ofSize: 17), paragraphSpacing: 8, firstLineIndent: 0, headIndent: 22, blockID: blockID, to: result, wordRanges: &wordRanges, blockIDs: &blockIDs, ignoredLeadingWords: 1)
                }
            case .quote(let text):
                append(text, font: .systemFont(ofSize: 17), paragraphSpacing: 0, blockID: blockID, to: result, wordRanges: &wordRanges, blockIDs: &blockIDs)
            case .code(let text):
                append(text, font: .monospacedSystemFont(ofSize: 13, weight: .regular), paragraphSpacing: 13, blockID: blockID, to: result, wordRanges: &wordRanges, blockIDs: &blockIDs)
            case .table(let rows):
                // Highlighting needs one continuous text view, so a table
                // cannot be laid out as a real grid here the way `MarkdownText`
                // does. Joining cells with plain spaces ran the header and the
                // data together into unreadable prose, so mark the header row
                // and separate cells with a visible divider instead.
                for (rowIndex, row) in rows.enumerated() {
                    let isHeader = rowIndex == 0
                    append(
                        row.joined(separator: "  ·  "),
                        font: .systemFont(ofSize: 14, weight: isHeader ? .semibold : .regular),
                        paragraphSpacing: isHeader ? 8 : 6,
                        blockID: blockID,
                        to: result,
                        wordRanges: &wordRanges,
                        blockIDs: &blockIDs
                    )
                }
            case .divider:
                append("────────────", font: .systemFont(ofSize: 12), paragraphSpacing: 10, blockID: blockID, to: result, wordRanges: &wordRanges, blockIDs: &blockIDs)
            }
            globalWordIndexes.append(contentsOf: (0..<(wordRanges.count - localStart)).map {
                nextGlobalWordIndex + $0
            })
        }

        for annotation in annotations {
            guard annotation.startWordIndex >= 0,
                  annotation.endWordIndex >= annotation.startWordIndex else { continue }
            for index in wordRanges.indices where
                globalWordIndexes[index] >= annotation.startWordIndex &&
                globalWordIndexes[index] <= annotation.endWordIndex {
                let range = wordRanges[index]
                if annotation.kind == "underline" {
                    result.addAttributes([
                        .underlineStyle: NSUnderlineStyle.single.rawValue,
                        .underlineColor: annotationColor(annotation.colorId ?? "orange")
                    ], range: range)
                } else {
                    result.addAttribute(.backgroundColor, value: annotationBackground(annotation.colorId ?? "orange"), range: range)
                }
            }
        }

        if let readAlongColorID {
            for index in wordRanges.indices where
                globalWordIndexes[index] <= completedWordIndex || globalWordIndexes[index] == currentWordIndex {
                result.addAttributes([
                    .backgroundColor: globalWordIndexes[index] == currentWordIndex
                        ? annotationColor(readAlongColorID)
                        : annotationBackground(readAlongColorID),
                    .foregroundColor: readAlongTextColor(readAlongColorID)
                ], range: wordRanges[index])
            }
        }

        return Document(
            text: result,
            wordRanges: wordRanges,
            globalWordIndexes: globalWordIndexes,
            blockIDs: blockIDs
        )
    }

    private static func wordCount(in block: MarkdownBlock) -> Int {
        let strings: [String]
        switch block {
        case .heading(_, let value), .paragraph(let value), .quote(let value):
            strings = [value]
        case .bullet(let values), .numbered(let values):
            strings = values
        case .table(let rows):
            strings = rows.flatMap { $0 }
        case .code, .divider:
            strings = []
        }
        let expression = try! NSRegularExpression(pattern: #"[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*"#)
        return strings.reduce(0) { total, value in
            let plain = plainInline(value)
            return total + expression.numberOfMatches(
                in: plain,
                range: NSRange(location: 0, length: (plain as NSString).length)
            )
        }
    }

    private static func append(
        _ markdownText: String,
        font: UIFont,
        paragraphSpacing: CGFloat,
        firstLineIndent: CGFloat = 0,
        headIndent: CGFloat = 0,
        blockID: String,
        to result: NSMutableAttributedString,
        wordRanges: inout [NSRange],
        blockIDs: inout [String],
        ignoredLeadingWords: Int = 0
    ) {
        let renderedMarkdown = NativeMathTextRenderer.render(markdownText)
        let plain = plainInline(renderedMarkdown)
        let location = result.length
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 9
        paragraph.paragraphSpacing = paragraphSpacing
        paragraph.firstLineHeadIndent = firstLineIndent
        paragraph.headIndent = headIndent
        result.append(NSAttributedString(string: plain + "\n", attributes: [
            .font: font,
            .foregroundColor: UIColor.label,
            .paragraphStyle: paragraph
        ]))
        applyInlineStyles(
            source: renderedMarkdown,
            plain: plain,
            location: location,
            baseFont: font,
            to: result
        )

        let expression = try! NSRegularExpression(pattern: #"[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*"#)
        let matches = expression.matches(in: plain, range: NSRange(location: 0, length: (plain as NSString).length))
        for match in matches.dropFirst(ignoredLeadingWords) {
            wordRanges.append(NSRange(location: location + match.range.location, length: match.range.length))
            blockIDs.append(blockID)
        }
    }

    private static func plainInline(_ text: String) -> String {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            .map { String($0.characters) } ?? text
    }

    private static func applyInlineStyles(
        source: String,
        plain: String,
        location: Int,
        baseFont: UIFont,
        to result: NSMutableAttributedString
    ) {
        let rules: [(String, UIFont, Bool)] = [
            (#"(?:\*\*|__)(.+?)(?:\*\*|__)"#, .systemFont(ofSize: baseFont.pointSize, weight: .bold), false),
            (#"(?<!\*)\*([^*\n]+)\*(?!\*)"#, .italicSystemFont(ofSize: baseFont.pointSize), false),
            (#"`([^`\n]+)`"#, .monospacedSystemFont(ofSize: max(13, baseFont.pointSize - 1), weight: .regular), false),
            (#"~~([^~\n]+)~~"#, baseFont, true)
        ]
        let plainString = plain as NSString
        for (pattern, styledFont, strikethrough) in rules {
            guard let expression = try? NSRegularExpression(pattern: pattern) else { continue }
            var searchStart = 0
            for match in expression.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
                guard let capture = Range(match.range(at: 1), in: source) else { continue }
                let visible = NativeMathTextRenderer.render(String(source[capture]))
                guard !visible.isEmpty, searchStart <= plainString.length else { continue }
                let found = plainString.range(
                    of: visible,
                    options: [],
                    range: NSRange(location: searchStart, length: plainString.length - searchStart)
                )
                guard found.location != NSNotFound else { continue }
                let target = NSRange(location: location + found.location, length: found.length)
                result.addAttribute(.font, value: styledFont, range: target)
                if strikethrough {
                    result.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: target)
                }
                searchStart = NSMaxRange(found)
            }
        }
    }

    private static func headingFont(_ level: Int) -> UIFont {
        switch level {
        case 1: .systemFont(ofSize: 24, weight: .bold)
        case 2: .systemFont(ofSize: 21, weight: .bold)
        case 3: .systemFont(ofSize: 17, weight: .semibold)
        default: .systemFont(ofSize: 16, weight: .semibold)
        }
    }

    private static func annotationColor(_ id: String) -> UIColor {
        switch id {
        case "yellow": UIColor(red: 0.98, green: 0.80, blue: 0.08, alpha: 1)
        case "green": UIColor(red: 0.29, green: 0.87, blue: 0.50, alpha: 1)
        case "blue": UIColor(red: 0.38, green: 0.65, blue: 0.98, alpha: 1)
        case "pink": UIColor(red: 0.96, green: 0.45, blue: 0.73, alpha: 1)
        default: UIColor(red: 0.98, green: 0.57, blue: 0.24, alpha: 1)
        }
    }

    private static func annotationBackground(_ id: String) -> UIColor {
        annotationColor(id).withAlphaComponent(0.24)
    }

    private static func readAlongTextColor(_ id: String) -> UIColor {
        UIColor { traits in
            if traits.userInterfaceStyle == .dark {
                // Preserve the normal high-contrast note text in dark mode.
                // A fixed dark ink color made blue and orange read-along
                // highlights nearly illegible on the native dark surface.
                return .white
            }
            switch id {
            case "blue": return UIColor(red: 0.06, green: 0.10, blue: 0.16, alpha: 1)
            default: return UIColor(red: 0.26, green: 0.08, blue: 0.03, alpha: 1)
            }
        }
    }
}

enum NoteReadWordTokenizer {
    private static let expression = try! NSRegularExpression(
        pattern: #"[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*"#
    )

    static func matches(in text: String) -> [Range<String.Index>] {
        expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
            Range($0.range, in: text)
        }
    }
}

enum NoteReadHighlightPalette {
    static func read(_ id: String) -> Color {
        switch id {
        case "yellow": Color(hex: 0xFEF3C7)
        case "green": Color(hex: 0xDCFCE7)
        case "blue": Color(hex: 0xDBEAFE)
        case "pink": Color(hex: 0xFCE7F3)
        default: Color(hex: 0xFFEDD5)
        }
    }

    static func readText(_ id: String) -> Color {
        switch id {
        case "yellow": Color(hex: 0x78350F)
        case "green": Color(hex: 0x14532D)
        case "blue": Color(hex: 0x1E3A8A)
        case "pink": Color(hex: 0x831843)
        default: Color(hex: 0x7C2D12)
        }
    }

    static func current(_ id: String) -> Color {
        switch id {
        case "yellow": Color(hex: 0xFACC15)
        case "green": Color(hex: 0x4ADE80)
        case "blue": Color(hex: 0x60A5FA)
        case "pink": Color(hex: 0xF472B6)
        default: Color(hex: 0xFB923C)
        }
    }

    static func currentText(_ id: String) -> Color {
        switch id {
        case "yellow": Color(hex: 0x422006)
        case "green": Color(hex: 0x052E16)
        case "blue": Color(hex: 0x0F172A)
        case "pink": Color(hex: 0x500724)
        default: Color(hex: 0x431407)
        }
    }
}

enum MemoMarkdown {
    /// Mirrors the web workspace's `stripLeadingRedundantHeading`: the lecture
    /// title already appears above the tab bar, so a matching first markdown
    /// heading should not be rendered a second time inside the notes card.
    static func strippingRedundantLeadingHeading(_ markdown: String, title: String?) -> String {
        var lines = markdown.components(separatedBy: .newlines)
        guard let firstContentIndex = lines.firstIndex(where: {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }) else {
            return markdown
        }

        let firstLine = lines[firstContentIndex].trimmingCharacters(in: .whitespaces)
        var markerLength = 0
        for character in firstLine {
            guard character == "#", markerLength < 6 else {
                break
            }
            markerLength += 1
        }

        guard markerLength > 0 else {
            return markdown
        }
        let markerEnd = firstLine.index(firstLine.startIndex, offsetBy: markerLength)
        guard markerEnd < firstLine.endIndex, firstLine[markerEnd] == " " else {
            return markdown
        }

        let headingStart = firstLine.index(after: markerEnd)
        let heading = normalizeHeading(String(firstLine[headingStart...]))
        let normalizedTitle = normalizeHeading(title ?? "")
        let genericHeadings: Set<String> = ["notes", "lecture notes", "structured notes"]
        guard genericHeadings.contains(heading) || (!normalizedTitle.isEmpty && heading == normalizedTitle) else {
            return markdown
        }

        lines.removeFirst(firstContentIndex + 1)
        while lines.first?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            lines.removeFirst()
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Converts rendered note markdown into a clean string for native speech.
    static func spokenText(from markdown: String) -> String {
        MarkdownBlock.parse(markdown).flatMap { block -> [String] in
            switch block {
            case .heading(_, let text), .paragraph(let text), .quote(let text), .code(let text):
                return [stripInlineMarkdown(text)]
            case .bullet(let items), .numbered(let items):
                return items.map(stripInlineMarkdown)
            case .table(let rows):
                return rows.flatMap { $0 }.map(stripInlineMarkdown)
            case .divider:
                return []
            }
        }
        .filter { !$0.isEmpty }
        .joined(separator: ". ")
    }

    private static func stripInlineMarkdown(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"!\[([^\]]*)\]\([^\)]*\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\[([^\]]+)\]\([^\)]*\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"[*_`~]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizeHeading(_ value: String) -> String {
        let folded = value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .lowercased()
        let scalars = folded.unicodeScalars.map { scalar -> Character in
            CharacterSet.alphanumerics.contains(scalar) || CharacterSet.whitespaces.contains(scalar)
                ? Character(String(scalar))
                : " "
        }
        return String(scalars)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }
}

enum MarkdownBlock {
    case heading(Int, String)
    case paragraph(String)
    case bullet([String])
    case numbered([String])
    case quote(String)
    case code(String)
    case table([[String]])
    case divider

    var plainText: String {
        switch self {
        case .heading(_, let text), .paragraph(let text), .quote(let text), .code(let text): text
        case .bullet(let items), .numbered(let items): items.joined(separator: " ")
        case .table(let rows): rows.flatMap { $0 }.joined(separator: " ")
        case .divider: ""
        }
    }

    static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbers: [String] = []
        var tableRows: [[String]] = []
        var codeLines: [String] = []
        var inCode = false

        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: " ")))
                paragraph = []
            }
        }
        func flushLists() {
            if !bullets.isEmpty {
                blocks.append(.bullet(bullets))
                bullets = []
            }
            if !numbers.isEmpty {
                blocks.append(.numbered(numbers))
                numbers = []
            }
        }
        func flushTable() {
            if !tableRows.isEmpty {
                blocks.append(.table(tableRows))
                tableRows = []
            }
        }
        func flushAll() {
            flushParagraph()
            flushLists()
            flushTable()
        }

        // JSON may decode an unescaped LaTeX command such as `\frac` as a
        // form-feed followed by `rac`. Repair it before line splitting because
        // `CharacterSet.newlines` treats form-feed as a paragraph boundary.
        let normalizedMarkdown = NativeMathTextRenderer.repairDroppedCommandControls(markdown)
        for rawLine in normalizedMarkdown.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            if line.hasPrefix("```") {
                if inCode {
                    blocks.append(.code(codeLines.joined(separator: "\n")))
                    codeLines = []
                    inCode = false
                } else {
                    flushAll()
                    inCode = true
                }
                continue
            }
            if inCode {
                codeLines.append(rawLine)
                continue
            }

            if line.isEmpty {
                flushAll()
                continue
            }

            if line.hasPrefix("|"), line.hasSuffix("|") {
                flushParagraph()
                flushLists()
                let cells = line
                    .trimmingCharacters(in: CharacterSet(charactersIn: "|"))
                    .components(separatedBy: "|")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                let isSeparatorRow = cells.allSatisfy { cell in
                    !cell.isEmpty && cell.allSatisfy { "-:".contains($0) }
                }
                if !isSeparatorRow {
                    tableRows.append(cells)
                }
                continue
            }
            flushTable()

            if line == "---" || line == "***" || line == "___" {
                flushAll()
                blocks.append(.divider)
                continue
            }

            if let heading = headingLevel(of: line) {
                flushAll()
                blocks.append(.heading(heading.level, heading.text))
                continue
            }

            if line.hasPrefix("> ") {
                flushAll()
                blocks.append(.quote(String(line.dropFirst(2))))
                continue
            }

            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
                flushParagraph()
                if !numbers.isEmpty {
                    blocks.append(.numbered(numbers))
                    numbers = []
                }
                bullets.append(String(line.dropFirst(2)))
                continue
            }

            if let match = numberedItem(of: line) {
                flushParagraph()
                if !bullets.isEmpty {
                    blocks.append(.bullet(bullets))
                    bullets = []
                }
                numbers.append(match)
                continue
            }

            flushLists()
            paragraph.append(line)
        }

        if inCode, !codeLines.isEmpty {
            blocks.append(.code(codeLines.joined(separator: "\n")))
        }
        flushAll()
        return blocks
    }

    private static func headingLevel(of line: String) -> (level: Int, text: String)? {
        var level = 0
        var index = line.startIndex
        while index < line.endIndex, line[index] == "#", level < 6 {
            level += 1
            index = line.index(after: index)
        }
        guard level > 0, index < line.endIndex, line[index] == " " else {
            return nil
        }
        return (level, String(line[line.index(after: index)...]))
    }

    private static func numberedItem(of line: String) -> String? {
        guard let dotIndex = line.firstIndex(of: "."), dotIndex != line.startIndex else {
            return nil
        }
        let prefix = line[line.startIndex..<dotIndex]
        guard prefix.allSatisfy(\.isNumber) else {
            return nil
        }
        let rest = line[line.index(after: dotIndex)...]
        guard rest.hasPrefix(" ") else {
            return nil
        }
        return rest.trimmingCharacters(in: .whitespaces)
    }
}
