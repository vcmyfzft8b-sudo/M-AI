"""Generate the dependency-free Xcode project; run from the repository root."""
from pathlib import Path
import json, plistlib
root=Path('ios')
app=root/'MemoAI'
def write(path,text):
 path.parent.mkdir(parents=True,exist_ok=True); path.write_text(text)
def plist(path,data):
 path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(plistlib.dumps(data))
plist(root/'Config/MemoAI.entitlements', {'com.apple.developer.applesignin': ['Default']})
plist(app/'Info.plist', {
 'CFBundleDisplayName':'Memo AI','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)',
 'CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleName':'$(PRODUCT_NAME)',
 'CFBundlePackageType':'APPL','CFBundleShortVersionString':'$(MARKETING_VERSION)',
 'CFBundleVersion':'$(CURRENT_PROJECT_VERSION)','LSRequiresIPhoneOS':True,
 'UIApplicationSupportsIndirectInputEvents':True,
 'UILaunchStoryboardName':'LaunchScreen',
 'CFBundleURLTypes':[{'CFBundleURLName':'eu.memoai.memo.auth','CFBundleURLSchemes':['eu.memoai.memo.auth']}],
 'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],
 'UISupportedInterfaceOrientations~ipad':['UIInterfaceOrientationPortrait','UIInterfaceOrientationPortraitUpsideDown','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],
 'NSMicrophoneUsageDescription':'Record lectures and speak with your Memo voice tutor.',
 'NSCameraUsageDescription':'Scan study materials and attach photos to your notes.',
 # The native share sheet offers "Save Image" for exported mindmap PNGs; without
 # this string iOS terminates the app when a user picks it.
 'NSPhotoLibraryAddUsageDescription':'Save mindmap images exported from your notes to your photo library.',
 'ITSAppUsesNonExemptEncryption':False,
 # Lectures are recorded natively so capture survives the screen locking;
 # without the audio background mode the session ends the moment iOS suspends
 # the app and the recording is silently truncated.
 'UIBackgroundModes':['audio'],
 'NSSupportsLiveActivities':True,
 'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True}
})
# Includes data collected through the embedded app and backend, not just Swift.
# Review against deployed providers before submitting App Store privacy answers.
collected=[]
for kind in ['Name','EmailAddress','UserID','PurchaseHistory','AudioData','PhotosorVideos','OtherUserContent','CustomerSupport']:
 collected.append({'NSPrivacyCollectedDataType':'NSPrivacyCollectedDataType'+kind,'NSPrivacyCollectedDataTypeLinked':True,'NSPrivacyCollectedDataTypeTracking':False,'NSPrivacyCollectedDataTypePurposes':['NSPrivacyCollectedDataTypePurposeAppFunctionality']})
for kind in ['ProductInteraction','OtherUsageData','CrashData','PerformanceData','OtherDiagnosticData','CoarseLocation']:
 collected.append({'NSPrivacyCollectedDataType':'NSPrivacyCollectedDataType'+kind,'NSPrivacyCollectedDataTypeLinked':True,'NSPrivacyCollectedDataTypeTracking':False,'NSPrivacyCollectedDataTypePurposes':['NSPrivacyCollectedDataTypePurposeAnalytics','NSPrivacyCollectedDataTypePurposeAppFunctionality']})
plist(app/'PrivacyInfo.xcprivacy', {'NSPrivacyTracking':False,'NSPrivacyTrackingDomains':[], 'NSPrivacyCollectedDataTypes':collected, 'NSPrivacyAccessedAPITypes':[
 # The app-only theme preference lives in UserDefaults (required-reason API, CA92.1).
 {'NSPrivacyAccessedAPIType':'NSPrivacyAccessedAPICategoryUserDefaults','NSPrivacyAccessedAPITypeReasons':['CA92.1']}]})
assets=app/'Assets.xcassets'
write(assets/'Contents.json',json.dumps({'info':{'author':'xcode','version':1}},indent=2)+'\n')
write(assets/'AppIcon.appiconset/Contents.json',json.dumps({'images':[{'filename':'AppIcon.png','idiom':'universal','platform':'ios','size':'1024x1024'}],'info':{'author':'xcode','version':1}},indent=2)+'\n')
write(assets/'LaunchMark.imageset/Contents.json',json.dumps({'images':[{'filename':'mark.png','idiom':'universal'}],'info':{'author':'xcode','version':1}},indent=2)+'\n')
colors=[]
# Mirrors SPLASH_BACKGROUNDS / --bg from the design system, as named native tokens.
for theme,channels in [('light',(241,241,245)),('dark',(18,18,20))]:
 c={'idiom':'universal','color':{'color-space':'srgb','components':dict(zip(['red','green','blue'],[str(v/255) for v in channels]),alpha='1.0')}}
 if theme=='dark': c['appearances']=[{'appearance':'luminosity','value':'dark'}]
 colors.append(c)
write(assets/'Canvas.colorset/Contents.json',json.dumps({'colors':colors,'info':{'author':'xcode','version':1}},indent=2)+'\n')
# All UI copy is catalogued. English is the development fallback; the PWA keeps its five locales.
strings={
 'en':{'retry':'Try again','loading':'Opening Memo…','connectionFailed':'Memo could not connect. Check your connection and try again.','actionFailed':'This action could not be completed. Please try again.','ok':'OK','recording':'Recording lecture','recordingPaused':'Paused'},
 'sl':{'retry':'Poskusi znova','loading':'Odpiranje Mema…','connectionFailed':'Memo se ni mogel povezati. Preveri povezavo in poskusi znova.','actionFailed':'Dejanja ni bilo mogoče dokončati. Poskusi znova.','ok':'V redu','recording':'Snemanje predavanja','recordingPaused':'Zaustavljeno'},
 'hr':{'retry':'Pokušaj ponovno','loading':'Otvaranje Mema…','connectionFailed':'Memo se nije mogao povezati. Provjeri vezu i pokušaj ponovno.','actionFailed':'Radnju nije bilo moguće dovršiti. Pokušaj ponovno.','ok':'U redu','recording':'Snimanje predavanja','recordingPaused':'Pauzirano'},
 'bs':{'retry':'Pokušaj ponovo','loading':'Otvaranje Mema…','connectionFailed':'Memo se nije mogao povezati. Provjeri vezu i pokušaj ponovo.','actionFailed':'Radnju nije bilo moguće dovršiti. Pokušaj ponovo.','ok':'U redu','recording':'Snimanje predavanja','recordingPaused':'Pauzirano'},
 'sr':{'retry':'Pokušaj ponovo','loading':'Otvaranje Mema…','connectionFailed':'Memo nije mogao da se poveže. Proveri vezu i pokušaj ponovo.','actionFailed':'Radnja nije mogla da se završi. Pokušaj ponovo.','ok':'U redu','recording':'Snimanje predavanja','recordingPaused':'Pauzirano'}}
for locale,table in strings.items():
 write(app/f'{locale}.lproj/Localizable.strings','\n'.join(f'{json.dumps(k)} = {json.dumps(v,ensure_ascii=False)};' for k,v in table.items())+'\n')
permissions = {
 'en': ('Scan study materials and attach photos to your notes.', 'Record lectures and speak with your Memo voice tutor.', 'Save mindmap images exported from your notes to your photo library.'),
 'sl': ('Skeniraj učno gradivo in priloži fotografije zapiskom.', 'Snemaj predavanja in se pogovarjaj z glasovnim tutorjem Memo.', 'Shrani slike miselnih vzorcev, izvožene iz zapiskov, v svojo knjižnico fotografij.'),
 'hr': ('Skeniraj materijale za učenje i priloži fotografije bilješkama.', 'Snimaj predavanja i razgovaraj s glasovnim tutorom Memo.', 'Spremi slike mentalnih mapa izvezene iz bilješki u svoju biblioteku fotografija.'),
 'bs': ('Skeniraj materijale za učenje i priloži fotografije bilješkama.', 'Snimaj predavanja i razgovaraj s glasovnim tutorom Memo.', 'Sačuvaj slike mentalnih mapa izvezene iz bilješki u svoju biblioteku fotografija.'),
 'sr': ('Skeniraj materijale za učenje i priloži fotografije beleškama.', 'Snimaj predavanja i razgovaraj sa glasovnim tutorom Memo.', 'Sačuvaj slike mentalnih mapa izvezene iz beleški u svoju biblioteku fotografija.'),
}
for locale, (camera, microphone, photoLibraryAdd) in permissions.items():
 table = {'NSCameraUsageDescription': camera, 'NSMicrophoneUsageDescription': microphone, 'NSPhotoLibraryAddUsageDescription': photoLibraryAdd}
 write(app/f'{locale}.lproj/InfoPlist.strings','\n'.join(f'{json.dumps(k)} = {json.dumps(v,ensure_ascii=False)};' for k,v in table.items())+'\n')
# The Lock Screen recording banner is drawn by a WidgetKit extension; the app
# only starts and updates the activity. Its brand images are checked in beside
# this manifest, as the app's are.
widget=root/'RecordingLiveActivity'
plist(widget/'Info.plist', {
 'CFBundleDisplayName':'Memo AI','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)',
 'CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleName':'$(PRODUCT_NAME)',
 'CFBundlePackageType':'$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
 'CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)',
 'NSExtension':{'NSExtensionPointIdentifier':'com.apple.widgetkit-extension'}})
write(widget/'Assets.xcassets/Contents.json',json.dumps({'info':{'author':'xcode','version':1}},indent=2)+'\n')
for name,filename in [('MemoMark','mark.png'),('MemoLockup','lockup.png')]:
 write(widget/f'Assets.xcassets/{name}.imageset/Contents.json',json.dumps({'images':[{'filename':filename,'idiom':'universal'}],'info':{'author':'xcode','version':1}},indent=2)+'\n')

# Stable IDs make regeneration diffable. File-system synchronized groups include new Swift/resources.
project='''// !$*UTF8*$!
{
 archiveVersion = 1; classes = {}; objectVersion = 77;
 objects = {
 A00000000000000000000001 = { isa = PBXProject; attributes = { BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 2650; TargetAttributes = { A00000000000000000000002 = { CreatedOnToolsVersion = 26.5; }; }; }; buildConfigurationList = A00000000000000000000010; compatibilityVersion = "Xcode 16.0"; developmentRegion = en; knownRegions = (en, Base, sl, hr, bs, sr); mainGroup = A00000000000000000000003; preferredProjectObjectVersion = 77; productRefGroup = A00000000000000000000004; projectDirPath = ""; projectRoot = ""; targets = (A00000000000000000000002, A00000000000000000000031, A00000000000000000000020); };
 A00000000000000000000002 = { isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000011; buildPhases = (A00000000000000000000007, A00000000000000000000008, A00000000000000000000009, A00000000000000000000042); buildRules = (); dependencies = (A00000000000000000000040); fileSystemSynchronizedGroups = (A00000000000000000000005); name = MemoAI; productName = MemoAI; productReference = A00000000000000000000006; productType = "com.apple.product-type.application"; };
 A00000000000000000000003 = { isa = PBXGroup; children = (A00000000000000000000005, A00000000000000000000032, A00000000000000000000046, A00000000000000000000021, A00000000000000000000019, A00000000000000000000049, A00000000000000000000050, A00000000000000000000004); sourceTree = "<group>"; };
 A00000000000000000000004 = { isa = PBXGroup; children = (A00000000000000000000006, A00000000000000000000033, A00000000000000000000022); name = Products; sourceTree = "<group>"; };
 A00000000000000000000005 = { isa = PBXFileSystemSynchronizedRootGroup; exceptions = (A00000000000000000000018); path = MemoAI; sourceTree = "<group>"; };
 A00000000000000000000006 = { isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = MemoAI.app; sourceTree = BUILT_PRODUCTS_DIR; };
 A00000000000000000000007 = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000047); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000008 = { isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000009 = { isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000010 = { isa = XCConfigurationList; buildConfigurations = (A00000000000000000000012, A00000000000000000000013); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
 A00000000000000000000011 = { isa = XCConfigurationList; buildConfigurations = (A00000000000000000000014, A00000000000000000000015); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
 A00000000000000000000012 = { isa = XCBuildConfiguration; buildSettings = { CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; DEBUG_INFORMATION_FORMAT = dwarf; ENABLE_TESTABILITY = YES; }; name = Debug; };
 A00000000000000000000013 = { isa = XCBuildConfiguration; buildSettings = { CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; SWIFT_COMPILATION_MODE = wholemodule; DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"; VALIDATE_PRODUCT = YES; }; name = Release; };
 A00000000000000000000014 = { isa = XCBuildConfiguration; baseConfigurationReference = A00000000000000000000019; buildSettings = { PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = MemoAI/Info.plist; CODE_SIGN_STYLE = Automatic; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; TARGETED_DEVICE_FAMILY = "1,2"; SWIFT_EMIT_LOC_STRINGS = YES; SUPPORTS_MACCATALYST = NO; SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO; }; name = Debug; };
 A00000000000000000000015 = { isa = XCBuildConfiguration; baseConfigurationReference = A00000000000000000000019; buildSettings = { PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = MemoAI/Info.plist; CODE_SIGN_STYLE = Automatic; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; TARGETED_DEVICE_FAMILY = "1,2"; SWIFT_EMIT_LOC_STRINGS = YES; SUPPORTS_MACCATALYST = NO; SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO; }; name = Release; };
 A00000000000000000000018 = { isa = PBXFileSystemSynchronizedBuildFileExceptionSet; membershipExceptions = (Info.plist); target = A00000000000000000000002; };
 A00000000000000000000019 = { isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config/App.xcconfig; sourceTree = "<group>"; };
 A00000000000000000000020 = { isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000026; buildPhases = (A00000000000000000000023, A00000000000000000000024, A00000000000000000000025); buildRules = (); dependencies = (A00000000000000000000029); fileSystemSynchronizedGroups = (A00000000000000000000021); name = MemoAIUITests; productName = MemoAIUITests; productReference = A00000000000000000000022; productType = "com.apple.product-type.bundle.ui-testing"; };
 A00000000000000000000021 = { isa = PBXFileSystemSynchronizedRootGroup; path = MemoAIUITests; sourceTree = "<group>"; };
 A00000000000000000000022 = { isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = MemoAIUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
 A00000000000000000000023 = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000024 = { isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000025 = { isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000026 = { isa = XCConfigurationList; buildConfigurations = (A00000000000000000000027, A00000000000000000000028); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
 A00000000000000000000027 = { isa = XCBuildConfiguration; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = eu.memoai.memo.uitests; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; TEST_TARGET_NAME = MemoAI; TARGETED_DEVICE_FAMILY = "1,2"; CODE_SIGN_STYLE = Automatic; }; name = Debug; };
 A00000000000000000000028 = { isa = XCBuildConfiguration; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = eu.memoai.memo.uitests; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; TEST_TARGET_NAME = MemoAI; TARGETED_DEVICE_FAMILY = "1,2"; CODE_SIGN_STYLE = Automatic; }; name = Release; };
 A00000000000000000000029 = { isa = PBXTargetDependency; target = A00000000000000000000002; targetProxy = A00000000000000000000030; };
 A00000000000000000000030 = { isa = PBXContainerItemProxy; containerPortal = A00000000000000000000001; proxyType = 1; remoteGlobalIDString = A00000000000000000000002; remoteInfo = MemoAI; };
 A00000000000000000000031 = { isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000037; buildPhases = (A00000000000000000000034, A00000000000000000000035, A00000000000000000000036); buildRules = (); dependencies = (); fileSystemSynchronizedGroups = (A00000000000000000000032); name = RecordingLiveActivity; productName = RecordingLiveActivity; productReference = A00000000000000000000033; productType = "com.apple.product-type.app-extension"; };
 A00000000000000000000032 = { isa = PBXFileSystemSynchronizedRootGroup; exceptions = (A00000000000000000000044); path = RecordingLiveActivity; sourceTree = "<group>"; };
 A00000000000000000000033 = { isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = RecordingLiveActivity.appex; sourceTree = BUILT_PRODUCTS_DIR; };
 A00000000000000000000034 = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000048); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000035 = { isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000036 = { isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000037 = { isa = XCConfigurationList; buildConfigurations = (A00000000000000000000038, A00000000000000000000039); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
 A00000000000000000000038 = { isa = XCBuildConfiguration; baseConfigurationReference = A00000000000000000000050; buildSettings = { PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = RecordingLiveActivity/Info.plist; GENERATE_INFOPLIST_FILE = NO; CODE_SIGN_STYLE = Automatic; SKIP_INSTALL = YES; TARGETED_DEVICE_FAMILY = "1,2"; SWIFT_EMIT_LOC_STRINGS = YES; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"; }; name = Debug; };
 A00000000000000000000039 = { isa = XCBuildConfiguration; baseConfigurationReference = A00000000000000000000050; buildSettings = { PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = RecordingLiveActivity/Info.plist; GENERATE_INFOPLIST_FILE = NO; CODE_SIGN_STYLE = Automatic; SKIP_INSTALL = YES; TARGETED_DEVICE_FAMILY = "1,2"; SWIFT_EMIT_LOC_STRINGS = YES; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"; }; name = Release; };
 A00000000000000000000040 = { isa = PBXTargetDependency; target = A00000000000000000000031; targetProxy = A00000000000000000000041; };
 A00000000000000000000041 = { isa = PBXContainerItemProxy; containerPortal = A00000000000000000000001; proxyType = 1; remoteGlobalIDString = A00000000000000000000031; remoteInfo = RecordingLiveActivity; };
 A00000000000000000000042 = { isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = (A00000000000000000000043); name = "Embed Foundation Extensions"; runOnlyForDeploymentPostprocessing = 0; };
 A00000000000000000000043 = { isa = PBXBuildFile; fileRef = A00000000000000000000033; settings = { ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };
 A00000000000000000000044 = { isa = PBXFileSystemSynchronizedBuildFileExceptionSet; membershipExceptions = (Info.plist); target = A00000000000000000000031; };
 A00000000000000000000045 = { isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RecordingActivityAttributes.swift; sourceTree = "<group>"; };
 A00000000000000000000046 = { isa = PBXGroup; children = (A00000000000000000000045); path = Shared; sourceTree = "<group>"; };
 A00000000000000000000047 = { isa = PBXBuildFile; fileRef = A00000000000000000000045; };
 A00000000000000000000048 = { isa = PBXBuildFile; fileRef = A00000000000000000000045; };
 A00000000000000000000049 = { isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config/Version.xcconfig; sourceTree = "<group>"; };
 A00000000000000000000050 = { isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config/Widgets.xcconfig; sourceTree = "<group>"; };
 }; rootObject = A00000000000000000000001;
}
'''
write(root/'MemoAI.xcodeproj/project.pbxproj',project)
write(root/'MemoAI.xcodeproj/xcshareddata/xcschemes/MemoAI.xcscheme','''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2650" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000002" BuildableName="MemoAI.app" BlueprintName="MemoAI" ReferencedContainer="container:MemoAI.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000020" BuildableName="MemoAIUITests.xctest" BlueprintName="MemoAIUITests" ReferencedContainer="container:MemoAI.xcodeproj"/></TestableReference></Testables></TestAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000002" BuildableName="MemoAI.app" BlueprintName="MemoAI" ReferencedContainer="container:MemoAI.xcodeproj"/></BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000002" BuildableName="MemoAI.app" BlueprintName="MemoAI" ReferencedContainer="container:MemoAI.xcodeproj"/></BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')

# The ordinary launch/archive scheme always uses the real App Store. Only this
# explicit QA scheme selects synthetic local prices.
base = (root/'MemoAI.xcodeproj/xcshareddata/xcschemes/MemoAI.xcscheme').read_text()
write(root/'MemoAI.xcodeproj/xcshareddata/xcschemes/MemoAIStoreTests.xcscheme', base.replace('</LaunchAction>', '<StoreKitConfigurationFileReference identifier="../../MemoAIUITests/Offers.storekit"/></LaunchAction>'))
