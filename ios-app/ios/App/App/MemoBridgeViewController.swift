import Capacitor

class MemoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginType(MemoStoreKitPlugin.self)
    }
}
