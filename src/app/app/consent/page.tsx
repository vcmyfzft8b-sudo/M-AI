import { AuthScreen } from "@/components/auth-screen";
import { NativeAIConsent } from "@/components/native-ai-consent";

// No arrow: the only ways out are the two buttons on the card.
export default function ConsentPage() {
  return (
    <AuthScreen back={false}>
      <NativeAIConsent />
    </AuthScreen>
  );
}
