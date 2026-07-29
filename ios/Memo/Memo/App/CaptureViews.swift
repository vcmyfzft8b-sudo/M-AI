import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Native recreation of the web NoteSourceModal bottom sheet:
// segmented mode picker (record/upload/text/link), language selector,
// recording UI, file/photo pickers, and processing states.

enum CaptureMode: String, CaseIterable, Identifiable {
    case record
    case upload
    case text
    case link

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .record: "🎙️"
        case .upload: "📤"
        case .text: "📄"
        case .link: "🔗"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .record: "Snemaj"
        case .upload: "Naloži"
        case .text: "Dokumenti"
        case .link: "Povezava"
        }
    }

    var sheetTitle: String {
        switch self {
        case .record: "Posnemi predavanje"
        case .upload: "Naloži zvok"
        case .text: "Prilepi besedilo ali dokument"
        case .link: "Dodaj povezavo"
        }
    }
}

private struct LanguageOption: Identifiable {
    let code: String
    let label: String
    var id: String { code }
}

private let noteLanguageOptions: [LanguageOption] = [
    .init(code: "en", label: "English"),
    .init(code: "sl", label: "Slovenian"),
    .init(code: "de", label: "German"),
    .init(code: "hr", label: "Croatian"),
    .init(code: "it", label: "Italian")
]

private let unsupportedVideoLinkMessage =
    "Ta povezava izgleda kot video. MemoAI trenutno ustvarja zapiske iz spletnih strani, člankov, blogov in drugih besedilnih strani, ne pa iz videov. Prilepi povezavo do besedilne strani."

private let directVideoFileExtensions = [
    ".3g2", ".3gp", ".avi", ".m3u8", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"
]

private func isUnsupportedVideoLink(_ value: String) -> Bool {
    guard let url = URL(string: value),
          ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
        return false
    }

    let host = (url.host ?? "").lowercased().replacingOccurrences(of: "www.", with: "", options: .anchored)
    let path = url.path.lowercased().replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    let hostMatches: (String) -> Bool = { domain in host == domain || host.hasSuffix(".\(domain)") }
    let startsWithSegment: (String) -> Bool = { segment in path == segment || path.hasPrefix("\(segment)/") }

    if directVideoFileExtensions.contains(where: path.hasSuffix) { return true }
    if hostMatches("youtu.be") { return !path.isEmpty }
    if hostMatches("youtube.com") || hostMatches("youtube-nocookie.com") {
        if path == "/watch" || path == "/playlist" { return true }
        if ["/clip", "/embed", "/live", "/shorts", "/v"].contains(where: startsWithSegment) { return true }
    }
    if hostMatches("vimeo.com") || hostMatches("dailymotion.com") || hostMatches("dai.ly") {
        return !path.isEmpty
    }
    if hostMatches("tiktok.com") {
        return host == "vm.tiktok.com" || host == "vt.tiktok.com" || path.contains("/video/")
    }
    if host == "clips.twitch.tv" || hostMatches("twitch.tv") {
        return host == "clips.twitch.tv" || startsWithSegment("/videos") || startsWithSegment("/clip")
    }
    if hostMatches("instagram.com") {
        return startsWithSegment("/reel") || startsWithSegment("/tv")
    }
    if host == "fb.watch" || hostMatches("facebook.com") {
        return host == "fb.watch" || startsWithSegment("/watch") || startsWithSegment("/reel") || startsWithSegment("/videos")
    }
    return false
}

private func normalizedScanImage(
    data: Data,
    fileName: String,
    mimeType: String
) -> (data: Data, fileName: String, mimeType: String)? {
    let supportedTypes: Set<String> = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]
    if data.count <= 10 * 1024 * 1024, supportedTypes.contains(mimeType.lowercased()) {
        return (data, fileName, mimeType.lowercased() == "image/jpg" ? "image/jpeg" : mimeType.lowercased())
    }

    guard let image = UIImage(data: data) else { return nil }
    for quality in [0.86, 0.72, 0.58, 0.44, 0.3] {
        if let compressed = image.jpegData(compressionQuality: quality), compressed.count <= 10 * 1024 * 1024 {
            let stem = URL(fileURLWithPath: fileName).deletingPathExtension().lastPathComponent
            return (compressed, "\(stem.isEmpty ? "scan" : stem).jpg", "image/jpeg")
        }
    }
    return nil
}

struct CreateNoteSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let initialMode: CaptureMode
    let onCreated: (LectureRow?) -> Void

    @State private var mode: CaptureMode = .record
    @State private var languageHint = "sl"
    @State private var createInitialAudio = false

    // Record state
    @State private var preparedRecording: (url: URL, duration: TimeInterval)?

    // Upload state
    @State private var showAudioImporter = false
    @State private var selectedAudioURL: URL?
    @State private var selectedAudioDuration: TimeInterval = 0

    // Text/document state
    @State private var noteText = ""
    @State private var showDocumentImporter = false
    @State private var showPhotoPicker = false
    @State private var selectedDocumentURL: URL?
    @State private var scanImages: [LocalScanUploadFile] = []
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false

    // Link state
    @State private var linkText = ""

    // Busy state
    @State private var busyLabel: String?
    @State private var creationTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            header
            if busyLabel != nil {
                loadingState
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        if !appModel.recorder.isRecording {
                            modePicker
                            languageSelector
                            initialAudioOption
                        }
                        modeContent
                        if let error = appModel.errorMessage {
                            MemoBanner(kind: .error, message: error)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 30)
                }
            }
        }
        .background(theme.sheetBackground.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(appModel.recorder.isRecording || busyLabel != nil)
        .onAppear {
            mode = initialMode
            appModel.errorMessage = nil
        }
        .sheet(isPresented: $showAudioImporter) {
            MemoDocumentPicker(
                contentTypes: [.audio, .mpeg4Audio, .mp3, .wav],
                allowsMultipleSelection: false,
                onComplete: { result in
                    showAudioImporter = false
                    handleAudioImport(result)
                },
                onCancel: { showAudioImporter = false }
            )
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showDocumentImporter) {
            MemoDocumentPicker(
                contentTypes: [.pdf, .plainText, .rtf, .html, UTType("org.openxmlformats.wordprocessingml.document") ?? .data, UTType("org.openxmlformats.presentationml.presentation") ?? .data, .image],
                allowsMultipleSelection: true,
                onComplete: { result in
                    showDocumentImporter = false
                    handleDocumentImport(result)
                },
                onCancel: { showDocumentImporter = false }
            )
            .ignoresSafeArea()
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $photoPickerItems,
            maxSelectionCount: 10,
            matching: .images
        )
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                addScanImage(image)
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoPickerItems) {
            loadPickedPhotos()
        }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack {
            Text(mode.sheetTitle)
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(theme.label)
            Spacer()
            MemoCloseButton {
                cancelOrClose()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
    }

    private var modePicker: some View {
        MemoGlassSegmentedPicker(
            items: CaptureMode.allCases,
            selection: $mode,
            minHeight: 42,
            cornerRadius: 13
        ) { candidate, _ in
            Text(candidate.emoji)
                .font(.system(size: 19))
                .accessibilityLabel(candidate.accessibilityLabel)
        }
        .onChange(of: mode) { _, _ in appModel.errorMessage = nil }
    }

    private var languageSelector: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Jezik")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.label)
            Menu {
                ForEach(noteLanguageOptions) { option in
                    Button(option.label) {
                        languageHint = option.code
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(noteLanguageOptions.first { $0.code == languageHint }?.label ?? "Slovenian")
                        .font(.system(size: 15))
                        .foregroundStyle(theme.label)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.secondaryLabel)
                }
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(theme.surfaceMuted)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }

    private var initialAudioOption: some View {
        Button {
            createInitialAudio.toggle()
            MemoHaptics.selection()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: createInitialAudio ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(createInitialAudio ? theme.tint : theme.secondaryLabel)
                Text("Ustvari zvok")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(theme.label)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ustvari zvok")
        .accessibilityValue(createInitialAudio ? "Izbrano" : "Ni izbrano")
    }

    private var initialAudioVoice: String {
        let stored = UserDefaults.standard.string(forKey: "memo-note-tts-voice") ?? "Grace"
        return NoteSpeechController.voices.contains(stored) ? stored : "Grace"
    }

    @ViewBuilder
    private var modeContent: some View {
        switch mode {
        case .record: recordContent
        case .upload: uploadContent
        case .text: textContent
        case .link: linkContent
        }
    }

    // MARK: - Record mode

    @ViewBuilder
    private var recordContent: some View {
        if appModel.recorder.isRecording {
            recordingCard
        } else if let prepared = preparedRecording {
            preparedRecordingCard(prepared)
        } else {
            VStack(alignment: .leading, spacing: 14) {
                Button {
                    Task {
                        await appModel.recorder.start()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text("🎙️")
                        Text("Začni snemanje")
                    }
                }
                .buttonStyle(MemoPrimaryButtonStyle())
                if let permissionError = appModel.recorder.permissionError {
                    MemoBanner(kind: .error, message: permissionError)
                }
            }
        }
    }

    private var recordingCard: some View {
        VStack(spacing: 16) {
            Text("Snemanje")
                .font(.system(size: 13, weight: .semibold))
                .tracking(1)
                .foregroundStyle(theme.secondaryLabel)
                .textCase(.uppercase)
            Text(appModel.recorder.isPaused ? "Snemanje je začasno ustavljeno" : "Snemanje poteka")
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(theme.label)
            Text(MemoFormat.timestamp(appModel.recorder.duration))
                .font(.system(size: 34, weight: .bold, design: .monospaced))
                .foregroundStyle(theme.label)
                .contentTransition(.numericText())
            LiveAudioWave(active: !appModel.recorder.isPaused)

            VStack(spacing: 10) {
                Button {
                    if appModel.recorder.isPaused {
                        appModel.recorder.resume()
                    } else {
                        appModel.recorder.pause()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text(appModel.recorder.isPaused ? "▶️" : "⏸️")
                        Text(appModel.recorder.isPaused ? "Nadaljuj snemanje" : "Začasno ustavi snemanje")
                    }
                }
                .buttonStyle(MemoSecondaryButtonStyle())

                Button {
                    let url = appModel.recorder.lastRecordingURL
                    let duration = appModel.recorder.duration
                    appModel.recorder.stop()
                    if let url {
                        preparedRecording = (url, duration)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text("🎙️")
                        Text("Ustavi snemanje")
                    }
                }
                .buttonStyle(MemoPrimaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .memoCard(cornerRadius: 20, padding: 20)
    }

    private func preparedRecordingCard(_ prepared: (url: URL, duration: TimeInterval)) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pripravljen posnetek")
                .font(.system(size: 13, weight: .semibold))
                .tracking(1)
                .foregroundStyle(theme.secondaryLabel)
                .textCase(.uppercase)
            Text(prepared.url.lastPathComponent)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(theme.label)
                .lineLimit(1)
            Text(MemoFormat.timestamp(prepared.duration))
                .font(.system(size: 14))
                .foregroundStyle(theme.secondaryLabel)

            Button {
                submitRecording(prepared)
            } label: {
                HStack(spacing: 8) {
                    Text("📄")
                    Text("Ustvari")
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle())

            Button("Posnemi znova") {
                preparedRecording = nil
                appModel.recorder.reset()
            }
            .buttonStyle(MemoSecondaryButtonStyle())
        }
        .memoCard(cornerRadius: 20, padding: 20)
    }

    // MARK: - Upload mode

    private var uploadContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let url = selectedAudioURL {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Izbrana datoteka")
                        .font(.system(size: 13, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(theme.secondaryLabel)
                        .textCase(.uppercase)
                    Text(url.lastPathComponent)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(theme.label)
                        .lineLimit(1)
                    if selectedAudioDuration > 0 {
                        Text(MemoFormat.timestamp(selectedAudioDuration))
                            .font(.system(size: 14))
                            .foregroundStyle(theme.secondaryLabel)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .memoCard()
            }

            Button {
                showAudioImporter = true
            } label: {
                HStack(spacing: 8) {
                    Text("📤")
                    Text(selectedAudioURL == nil ? "Izberi zvočno datoteko" : "Izberi drugo zvočno datoteko")
                }
            }
            .buttonStyle(MemoSecondaryButtonStyle())

            if selectedAudioURL != nil {
                Button {
                    submitAudioFile()
                } label: {
                    HStack(spacing: 8) {
                        Text("📄")
                        Text("Ustvari")
                    }
                }
                .buttonStyle(MemoPrimaryButtonStyle())
            }
        }
    }

    // MARK: - Text / documents mode

    private var textContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let documentURL = selectedDocumentURL {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Izbran dokument")
                        .font(.system(size: 13, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(theme.secondaryLabel)
                        .textCase(.uppercase)
                    Text(documentURL.lastPathComponent)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(theme.label)
                        .lineLimit(1)
                    Text("Uporabljen bo, dokler ponovno ne začneš tipkati.")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.secondaryLabel)
                    Button("Odstrani dokument") {
                        selectedDocumentURL = nil
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.red)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .memoCard()
            } else if scanImages.isEmpty {
                TextEditor(text: $noteText)
                    .font(.system(size: 16))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 150)
                    .padding(10)
                    .background(theme.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(alignment: .topLeading) {
                        if noteText.isEmpty {
                            Text("Sem prilepi zapiske ali besedilo...")
                                .font(.system(size: 16))
                                .foregroundStyle(theme.tertiaryLabel)
                                .padding(.top, 18)
                                .padding(.leading, 15)
                                .allowsHitTesting(false)
                        }
                    }
            } else {
                photoGrid
            }

            HStack(spacing: 10) {
                Button {
                    // "Datoteka" is a direct file action, matching the web
                    // document picker. Avoid routing it through another modal:
                    // iOS may discard a file importer requested while a
                    // confirmation dialog is being dismissed.
                    showDocumentImporter = true
                } label: {
                    HStack(spacing: 7) {
                        Text("📤")
                        Text("Datoteka")
                    }
                }
                .buttonStyle(MemoSecondaryButtonStyle(minHeight: 48))

                Button {
                    showCamera = true
                } label: {
                    HStack(spacing: 7) {
                        Text("📷")
                        Text("Skeniraj")
                    }
                }
                .buttonStyle(MemoSecondaryButtonStyle(minHeight: 48))
            }

            Button {
                submitTextMode()
            } label: {
                HStack(spacing: 8) {
                    Text("📄")
                    Text("Ustvari")
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle())
            .disabled(!canGenerateTextMode)
        }
    }

    private var photoGrid: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(uploadedPhotoCountLabel)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(theme.secondaryLabel)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 10) {
                ForEach(scanImages, id: \.index) { file in
                    ZStack(alignment: .topTrailing) {
                        if let image = UIImage(data: file.data) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 92, height: 92)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        } else {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(theme.surfaceMuted)
                                .frame(width: 92, height: 92)
                                .overlay(
                                    Text("Ni predogleda")
                                        .font(.system(size: 11))
                                        .foregroundStyle(theme.secondaryLabel)
                                )
                        }
                        Button {
                            scanImages.removeAll { $0.index == file.index }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 22, height: 22)
                                .background(.black.opacity(0.55))
                                .clipShape(Circle())
                        }
                        .padding(4)
                    }
                }
            }
        }
    }

    private var uploadedPhotoCountLabel: String {
        let count = scanImages.count
        let word: String
        switch count % 100 {
        case 1: word = "fotografija naložena"
        case 2: word = "fotografiji naloženi"
        case 3, 4: word = "fotografije naložene"
        default: word = "fotografij naloženih"
        }
        return "\(count) \(word)"
    }

    private var canGenerateTextMode: Bool {
        if selectedDocumentURL != nil {
            return true
        }
        if !scanImages.isEmpty {
            return true
        }
        return noteText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 120
    }

    // MARK: - Link mode

    private var linkContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Povezava")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.label)
            HStack(spacing: 8) {
                Text("🔎")
                TextField("https://example.com", text: $linkText)
                    .font(.system(size: 16))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(theme.surfaceMuted)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            if let linkVideoError {
                Text(linkVideoError)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                submitLink()
            } label: {
                HStack(spacing: 8) {
                    Text("🔗")
                    Text("Ustvari")
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle())
            .disabled(!isLinkValid)
        }
    }

    private var isLinkValid: Bool {
        let trimmed = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed) else {
            return false
        }
        return ["http", "https"].contains(url.scheme?.lowercased() ?? "") && linkVideoError == nil
    }

    private var linkVideoError: String? {
        let trimmed = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        return isUnsupportedVideoLink(trimmed) ? unsupportedVideoLinkMessage : nil
    }

    // MARK: - Loading state

    private var loadingState: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Text(busyLabel ?? "Pripravljam...")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.label)
            Text("Ne zapiraj tega zaslona. Ko bo vse pripravljeno, se bo zaprl samodejno.")
                .font(.system(size: 14))
                .foregroundStyle(theme.secondaryLabel)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Prekliči") {
                creationTask?.cancel()
                creationTask = nil
                busyLabel = nil
            }
            .buttonStyle(MemoSecondaryButtonStyle())
            .padding(.horizontal, 60)
            .padding(.top, 8)
            Spacer()
        }
    }

    // MARK: - Import handlers

    private func handleAudioImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else {
            return
        }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }
        // Copy to a temp location so the upload flow owns the file.
        let destination = FileManager.default.temporaryDirectory.appending(path: url.lastPathComponent)
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.copyItem(at: url, to: destination)
            selectedAudioURL = destination
            let asset = AVURLAsset(url: destination)
            Task {
                if let duration = try? await asset.load(.duration) {
                    selectedAudioDuration = CMTimeGetSeconds(duration)
                }
            }
        } catch {
            appModel.errorMessage = "Zvočne datoteke ni bilo mogoče prebrati."
        }
    }

    private func handleDocumentImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, !urls.isEmpty else {
            return
        }

        let areAllImages = urls.allSatisfy { url in
            guard let fileType = UTType(filenameExtension: url.pathExtension) else { return false }
            return fileType.conforms(to: .image)
        }

        if areAllImages {
            guard urls.count <= 10 else {
                appModel.errorMessage = "Izberi en dokument ali do 10 fotografij."
                return
            }
            var importedImages: [LocalScanUploadFile] = []
            for (position, url) in urls.enumerated() {
                let didAccess = url.startAccessingSecurityScopedResource()
                defer {
                    if didAccess { url.stopAccessingSecurityScopedResource() }
                }
                guard let data = try? Data(contentsOf: url) else { continue }
                let fileType = UTType(filenameExtension: url.pathExtension)
                guard let normalized = normalizedScanImage(
                    data: data,
                    fileName: url.lastPathComponent,
                    mimeType: fileType?.preferredMIMEType ?? "image/jpeg"
                ) else { continue }
                importedImages.append(
                    LocalScanUploadFile(
                        index: position,
                        fileName: normalized.fileName,
                        mimeType: normalized.mimeType,
                        data: normalized.data
                    )
                )
            }
            guard !importedImages.isEmpty else {
                appModel.errorMessage = "Fotografij ni bilo mogoče prebrati."
                return
            }
            scanImages = importedImages
            selectedDocumentURL = nil
            noteText = ""
            return
        }

        guard urls.count == 1, let url = urls.first else {
            appModel.errorMessage = "Izberi en dokument ali do 10 fotografij."
            return
        }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess { url.stopAccessingSecurityScopedResource() }
        }
        let destination = FileManager.default.temporaryDirectory.appending(path: url.lastPathComponent)
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.copyItem(at: url, to: destination)
            selectedDocumentURL = destination
            noteText = ""
        } catch {
            appModel.errorMessage = "Dokumenta ni bilo mogoče prebrati."
        }
    }

    private func loadPickedPhotos() {
        guard !photoPickerItems.isEmpty else {
            return
        }
        let items = photoPickerItems
        photoPickerItems = []
        Task {
            for item in items {
                guard scanImages.count < 10 else {
                    break
                }
                guard let data = try? await item.loadTransferable(type: Data.self) else {
                    continue
                }
                let type = item.supportedContentTypes.first
                let nextIndex = (scanImages.map(\.index).max() ?? -1) + 1
                guard let normalized = normalizedScanImage(
                    data: data,
                    fileName: "scan-\(nextIndex + 1).\(type?.preferredFilenameExtension ?? "jpg")",
                    mimeType: type?.preferredMIMEType ?? "image/jpeg"
                ) else {
                    appModel.errorMessage = "Slika je tudi po stiskanju prevelika. Omejitev je 10 MB."
                    continue
                }
                scanImages.append(
                    LocalScanUploadFile(
                        index: nextIndex,
                        fileName: normalized.fileName,
                        mimeType: normalized.mimeType,
                        data: normalized.data
                    )
                )
            }
            selectedDocumentURL = nil
        }
    }

    private func addScanImage(_ image: UIImage) {
        guard let data = image.jpegData(compressionQuality: 0.85), scanImages.count < 10 else {
            return
        }
        let nextIndex = (scanImages.map(\.index).max() ?? -1) + 1
        scanImages.append(
            LocalScanUploadFile(
                index: nextIndex,
                fileName: "scan-\(nextIndex + 1).jpg",
                mimeType: "image/jpeg",
                data: data
            )
        )
        selectedDocumentURL = nil
    }

    // MARK: - Submit flows

    private func submitRecording(_ prepared: (url: URL, duration: TimeInterval)) {
        runCreation(label: "Nalagam zvok...") {
            await appModel.createFromAudio(
                url: prepared.url,
                duration: prepared.duration,
                languageHint: languageHint,
                createInitialAudio: createInitialAudio,
                initialAudioVoice: initialAudioVoice
            )
        }
    }

    private func submitAudioFile() {
        guard let url = selectedAudioURL else {
            return
        }
        runCreation(label: "Nalagam zvok...") {
            await appModel.createFromAudio(
                url: url,
                duration: selectedAudioDuration,
                languageHint: languageHint,
                createInitialAudio: createInitialAudio,
                initialAudioVoice: initialAudioVoice
            )
        }
    }

    private func submitTextMode() {
        if let documentURL = selectedDocumentURL {
            runCreation(label: "Nalagam dokument...") {
                await appModel.createFromDocument(
                    url: documentURL,
                    languageHint: languageHint,
                    createInitialAudio: createInitialAudio,
                    initialAudioVoice: initialAudioVoice
                )
            }
        } else if !scanImages.isEmpty {
            let files = normalizedScanFiles()
            runCreation(label: "Pripravljam nalaganje fotografij...") {
                await appModel.createFromScanData(
                    files,
                    languageHint: languageHint,
                    createInitialAudio: createInitialAudio,
                    initialAudioVoice: initialAudioVoice
                )
            }
        } else {
            let text = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
            runCreation(label: "Dodajam v vrsto...") {
                await appModel.createFromText(
                    text,
                    languageHint: languageHint,
                    createInitialAudio: createInitialAudio,
                    initialAudioVoice: initialAudioVoice
                )
            }
        }
    }

    private func submitLink() {
        let url = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        runCreation(label: "Dodajam v vrsto...") {
            await appModel.createFromLink(
                url,
                languageHint: languageHint,
                createInitialAudio: createInitialAudio,
                initialAudioVoice: initialAudioVoice
            )
        }
    }

    private func normalizedScanFiles() -> [LocalScanUploadFile] {
        scanImages.enumerated().map { offset, file in
            LocalScanUploadFile(
                index: offset,
                fileName: "scan-\(offset + 1).\(file.fileName.split(separator: ".").last.map(String.init) ?? "jpg")",
                mimeType: file.mimeType,
                data: file.data
            )
        }
    }

    private func runCreation(label: String, operation: @escaping () async -> String?) {
        busyLabel = label
        appModel.errorMessage = nil
        creationTask = Task {
            let lectureID = await operation()
            busyLabel = nil
            creationTask = nil
            if Task.isCancelled {
                return
            }
            if let lectureID {
                let lecture = appModel.lectures.first { $0.id == lectureID }
                onCreated(lecture)
            }
        }
    }

    private func cancelOrClose() {
        if appModel.recorder.isRecording {
            appModel.recorder.reset()
            return
        }
        creationTask?.cancel()
        dismiss()
    }
}

// MARK: - Document picker

/// A UIKit-backed document picker is used instead of SwiftUI's `fileImporter`.
/// The source form is itself presented as a sheet, and on iOS 26 a nested
/// `fileImporter` can silently fail to appear. Hosting `UIDocumentPickerViewController`
/// in a nested sheet keeps document and audio selection reliable.
struct MemoDocumentPicker: UIViewControllerRepresentable {
    let contentTypes: [UTType]
    let allowsMultipleSelection: Bool
    let onComplete: (Result<[URL], Error>) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: contentTypes, asCopy: true)
        picker.allowsMultipleSelection = allowsMultipleSelection
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        private let parent: MemoDocumentPicker

        init(parent: MemoDocumentPicker) {
            self.parent = parent
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            parent.onComplete(.success(urls))
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.onCancel()
        }
    }
}

// MARK: - Camera picker

struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPicker

        init(_ parent: CameraPicker) {
            self.parent = parent
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                parent.onCapture(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
