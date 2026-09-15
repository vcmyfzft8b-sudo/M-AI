"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { nativeRequest } from "@/lib/mobile/client";

export function NativeAccountActions() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function run(command: string) {
    setBusy(true); setNotice("");
    try {
      if (command === "withdrawAI") {
        const response = await fetch("/api/mobile/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allow: false }) });
        if (!response.ok) throw new Error();
        window.location.assign("/app/consent");
        return;
      }
      await nativeRequest(command);
      if (command === "restore") window.location.reload();
    } catch { setNotice(t("native.verifyFailed")); }
    finally { setBusy(false); }
  }
  return <div className="memo-native-plans">
    <button type="button" className="memo-card-row" disabled={busy} onClick={() => void run("restore")}>{t("native.restore")}</button>
    <button type="button" className="memo-card-row" disabled={busy} onClick={() => void run("manageSubscriptions")}>{t("native.manage")}</button>
    <button type="button" className="memo-card-row" disabled={busy} onClick={() => void run("withdrawAI")}>{t("native.aiWithdraw")}</button>
    {notice ? <p role="status" className="memo-inline-error">{notice}</p> : null}
  </div>;
}
