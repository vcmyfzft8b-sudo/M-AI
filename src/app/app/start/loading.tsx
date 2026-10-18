import { PaywallLoading } from "@/components/paywall-loading";

/*
 * The paywall's own skeleton. Without it this route fell back to the home
 * screen's (`app/loading.tsx`), so opening a paywall flashed a list of notes.
 */
export default function AppStartLoading() {
  return <PaywallLoading />;
}
