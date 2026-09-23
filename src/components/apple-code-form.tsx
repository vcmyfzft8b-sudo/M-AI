"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { AppleBillingTerms } from "@/components/apple-billing-terms";
import { nativeRequest } from "@/lib/mobile/client";
import { halfOffProducts, type NativeProduct } from "@/lib/mobile/products";
import { APPLE_PRODUCTS } from "@/lib/mobile/runtime";

export function AppleCodeForm() {
  const t = useT();
  const [supported, setSupported] = useState(false);
  const [code, setCode] = useState("");
  const [products, setProducts] = useState<NativeProduct[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const offerProducts = [...products].sort((a, b) =>
    Number(APPLE_PRODUCTS[b.id] === "yearly") - Number(APPLE_PRODUCTS[a.id] === "yearly"));
  useEffect(() => { setSupported((window.memoNative?.version ?? 0) >= 5); }, []);

  async function loadOffers() {
    const items = halfOffProducts(await nativeRequest("codeProducts", { code: code.trim() }));
    setProducts(items);
    setSelected(items.find(item => APPLE_PRODUCTS[item.id] === "yearly")?.id ?? items[0]?.id ?? "");
    return items.length > 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setNotice("");
    try {
      const product = products.find(item => item.id === selected);
      if (!product) {
        if (!await loadOffers()) setNotice(t("native.codeUnavailable"));
      } else {
        const result = await nativeRequest<{ status: string }>("codePurchase", { code: code.trim(), productId: product.id, quote: product.quote });
        if (result.status === "purchased") window.location.assign("/app");
        else if (result.status === "pending") setNotice(t("native.pending"));
        else if (result.status === "priceChanged") {
          await loadOffers(); setNotice(t("native.priceChanged"));
        }
      }
    } catch { setProducts([]); setSelected(""); setNotice(t("native.codeUnavailable")); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (busy) return;
    setBusy(true); setNotice("");
    try { await nativeRequest("restore"); window.location.assign("/app"); }
    catch { setNotice(t("native.verifyFailed")); }
    finally { setBusy(false); }
  }

  if (!supported) return <p className="memo-offer-billing">{t("native.codeUpdate")}</p>;

  return <form className="memo-code-form" onSubmit={submit}>
    <label>
      <span className="memo-field-label">{t("native.codeLabel")}</span>
      <input className="memo-field" autoComplete="off" autoCapitalize="characters" spellCheck={false}
        maxLength={64} value={code} disabled={busy} required enterKeyHint="done"
        onChange={event => { setCode(event.target.value); setProducts([]); setSelected(""); setNotice(""); }} />
    </label>
    {products.length > 0 && <div className="memo-offer-plans" role="group" aria-label={t("settings.rows.redeem")}>
      {offerProducts.map(product => {
        const yearly = APPLE_PRODUCTS[product.id] === "yearly";
        const plan = t(yearly ? "billing.plan.yearly" : "billing.plan.monthly");
        const detail = t(yearly ? "native.firstYearPrice" : "native.firstMonthPrice",
          { initial: product.introPrice!, renewal: product.price });
        return <button type="button" key={product.id} disabled={busy}
          className={`memo-offer-plan memo-code-plan${selected === product.id ? " selected" : ""}`}
          aria-label={`${plan}. ${detail}`} aria-pressed={selected === product.id}
          onClick={() => setSelected(product.id)}>
          {yearly && <span className="memo-offer-badge">{t("paywall.save", { percent: 50 })}</span>}
          <span className="memo-code-plan-heading">
            <strong>{plan}</strong>
            <span className="memo-offer-radio" aria-hidden="true" />
          </span>
          <span className="memo-code-plan-price">
            <strong>{product.introPrice}</strong>
            <span>{t(yearly ? "native.codeFirstYear" : "native.codeFirstMonth")}</span>
          </span>
          <span className="memo-code-plan-renewal">
            {t(yearly ? "native.codeRenewYear" : "native.codeRenewMonth", { renewal: product.price })}
          </span>
        </button>;
      })}
    </div>}
    {notice && <p className="memo-inline-error" role="status">{notice}</p>}
    <button className="memo-button-coral" type="submit" disabled={busy || !code.trim()} aria-busy={busy}>
      {busy ? t("common.loading") : products.length ? t("common.continue") : t("native.codeCheck")}
    </button>
    {products.length > 0 && <p className="memo-code-terms">{t("native.codeTerms")}</p>}
    <AppleBillingTerms busy={busy} onRestore={() => void restore()} />
  </form>;
}
