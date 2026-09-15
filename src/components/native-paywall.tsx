"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/i18n-provider";
import { nativeRequest } from "@/lib/mobile/client";
import { isAppleProduct, APPLE_PRODUCTS, type AppleProductId } from "@/lib/mobile/runtime";
import { nativeProducts, trialPlanProducts, halfOffProducts, type NativeProduct } from "@/lib/mobile/products";

export function NativePaywall({ halfOffOnly = false, onClose }: { halfOffOnly?: boolean; onClose?: () => void }) {
  const t = useT();
  const [products, setProducts] = useState<NativeProduct[]>([]);
  const [selected, setSelected] = useState<AppleProductId>(halfOffOnly ? "eu.memoai.premium.yearly" : "eu.memoai.premium.trial.yearly");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      nativeRequest<unknown>("products"),
      nativeRequest<{ productId: string | null }>("pendingProduct").catch(() => ({ productId: null })),
    ]).then(([items, pending]) => {
      if (!active) return;
      const valid = halfOffOnly ? halfOffProducts(items) : trialPlanProducts(items);
      // An external Apple purchase intent must show its actual product and terms.
      const intended = nativeProducts(items).find(item => item.id === pending.productId);
      if (!halfOffOnly && intended && !valid.some(item => item.id === intended.id)) valid.push(intended);
      setProducts(valid);
      if (!valid.length) setNotice(t("native.unavailable"));
      else if (isAppleProduct(pending.productId) && valid.some(item => item.id === pending.productId)) setSelected(pending.productId);
      else setSelected(valid.find(item => APPLE_PRODUCTS[item.id] === "yearly")?.id ?? valid[0].id);
    }).catch(() => { if (active) setNotice(t("native.unavailable")); });
    return () => { active = false; };
  }, [t, halfOffOnly]);

  async function perform(command: "purchase" | "restore") {
    setBusy(true); setNotice("");
    try {
      const result = await nativeRequest<{ status: string }>(command, {
        productId: selected, quote: products.find(item => item.id === selected)?.quote,
      });
      if (result.status === "purchased") window.location.assign("/app");
      else if (result.status === "restored") { setNotice(t("native.restored")); window.location.assign("/app/settings"); }
      else if (result.status === "pending") setNotice(t("native.pending"));
      else if (result.status === "priceChanged") {
        const refreshed = await nativeRequest<unknown>("products");
        setProducts(halfOffOnly ? halfOffProducts(refreshed) : trialPlanProducts(refreshed));
        setNotice(t("native.priceChanged"));
      }
    } catch { setNotice(t("native.verifyFailed")); }
    finally { setBusy(false); }
  }

  return (
    <section className="memo-native-paywall">
      {onClose ? <button type="button" onClick={onClose} className="memo-close-button" aria-label={t("common.close")}><span aria-hidden="true">×</span></button>
        : <Link href="/app" className="memo-close-button" aria-label={t("common.close")}><span aria-hidden="true">×</span></Link>}
      <h1>{t("paywall.title")}</h1>
      <p>{t("paywall.benefit.toolsCopy")}</p>
      <div className="memo-native-plans" role="radiogroup" aria-label={t("paywall.choosePlan")}>
        {products.map(product => (
          <button key={product.id} type="button" role="radio" aria-checked={selected === product.id}
            className="memo-card-row" disabled={busy} onClick={() => setSelected(product.id)}>
            <span className="memo-card-row-copy"><span className="memo-card-row-title">{product.name}</span>
              <span className="memo-card-row-detail">{product.trialDays === 3
                ? t(APPLE_PRODUCTS[product.id] === "yearly" ? "native.trialYearPrice" : "native.trialMonthPrice", { renewal: product.price })
                : product.introPrice
                ? t(APPLE_PRODUCTS[product.id] === "yearly" ? "native.firstYearPrice" : "native.firstMonthPrice", { initial: product.introPrice, renewal: product.price })
                : <>{product.price} / {t(APPLE_PRODUCTS[product.id] === "yearly" ? "native.year" : "native.month")}</>}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="memo-fine-print">{t("native.renewal")}</p>
      <button type="button" className="memo-button-coral" disabled={busy || !products.some(p => p.id === selected)} onClick={() => void perform("purchase")}>
        {t(busy ? "native.working" : products.find(p => p.id === selected)?.trialDays === 3 ? "paywall.startTrial" : "native.subscribe")}
      </button>
      <button type="button" className="memo-confirm-cancel" disabled={busy} onClick={() => void perform("restore")}>{t("native.restore")}</button>
      {notice ? <p role="status" className="memo-inline-error">{notice}</p> : null}
      <p className="memo-fine-print"><Link href="/legal/terms-of-use">{t("legal.termsInline")}</Link>{" · "}<Link href="/legal/privacy-policy">{t("legal.privacyInline")}</Link></p>
    </section>
  );
}
