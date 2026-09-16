"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { nativeRequest } from "@/lib/mobile/client";
import { Emoji, Msym } from "@/components/msym";

export function NativeAccountActions({ showManage = true, onWithdraw }: { showManage?: boolean; onWithdraw: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function run(command: string) {
    // Withdrawal is confirmed by the settings sheet; it is not a one-tap action.
    if (command === "withdrawAI") { onWithdraw(); return; }
    setBusy(true); setNotice("");
    try {
      await nativeRequest(command);
      if (command === "restore") window.location.reload();
    } catch { setNotice(t("native.verifyFailed")); }
    finally { setBusy(false); }
  }
  const actions = [
    { command: "restore", label: t("native.restore"), emoji: "🔄" },
    ...(showManage ? [{ command: "manageSubscriptions", label: t("native.manage"), emoji: "💳" }] : []),
    { command: "withdrawAI", label: t("native.aiWithdraw"), emoji: "🔒" },
  ];
  return <>
    {actions.map(action => <button key={action.command} type="button" className="memo-settings-row" disabled={busy} onClick={() => void run(action.command)}>
      <span className="memo-settings-tile"><Emoji symbol={action.emoji} size="1.15rem" /></span>
      <span className="memo-settings-copy"><span className="memo-settings-title">{action.label}</span></span>
      <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
    </button>)}
    {notice ? <p role="status" className="memo-inline-error">{notice}</p> : null}
  </>;
}
