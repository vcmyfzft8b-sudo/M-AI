import SwiftUI
import WidgetKit

/// The extension exists only to draw the recording banner: Memo has no Home
/// Screen widgets, and a Live Activity has to be rendered by an extension even
/// though the app is what starts it.
@main
struct MemoAIWidgetsBundle: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivity()
    }
}
