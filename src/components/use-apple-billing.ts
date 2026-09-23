"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { nativeRequest } from "@/lib/mobile/client";
import { nativeBillingFailureKey } from "@/lib/mobile/billing-notice";
import { APPLE_PRODUCTS, type AppleProductId } from "@/lib/mobile/runtime";
import { nativeProducts, trialPlanProducts, halfOffProducts, type NativeProduct } from "@/lib/mobile/products";
import { clearOfferResume } from "@/lib/offer-resume";

/** Apple supplies prices and checkout; the PWA owns the visible paywall. */
export function useAppleBilling(enabled: boolean, halfOffOnly = false) {
  const t = useT();
  const [products, setProducts] = useState<NativeProduct[]>([]);
  const [selected, setSelected] = useState<AppleProductId>(halfOffOnly ? "eu.memoai.premium.yearly" : "eu.memoai.premium.trial.yearly");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    Promise.all([
      nativeRequest<unknown>("products"),
      nativeRequest<{ productId: string | null }>("pendingProduct").catch(() => ({ productId: null })),
    ]).then(([items, pending]) => {
      if (!active) return;
      const valid = halfOffOnly ? halfOffProducts(items) : trialPlanProducts(items);
      const intended = nativeProducts(items).find(item => item.id === pending.productId);
      // External Apple intents retain the product and terms the buyer chose.
      if (!halfOffOnly && intended && !valid.some(item => item.id === intended.id)) valid.push(intended);
      setProducts(valid);
      if (!valid.length) setNotice(t("native.unavailable"));
      else setSelected(valid.find(item => item.id === pending.productId)?.id ??
        valid.find(item => APPLE_PRODUCTS[item.id] === "yearly")?.id ?? valid[0].id);
    }).catch(() => { if (active) setNotice(t("native.unavailable")); });
    return () => { active = false; };
  }, [enabled, halfOffOnly, t]);

  function productForPlan(plan: string) {
    return products.find(item => item.id === selected && APPLE_PRODUCTS[item.id] === plan) ??
      products.find(item => APPLE_PRODUCTS[item.id] === plan);
  }

  async function perform(command: "purchase" | "restore") {
    const product = products.find(item => item.id === selected);
    if (busy || (command === "purchase" && !product)) return;
    setBusy(true); setNotice("");
    try {
      const result = await nativeRequest<{ status: string }>(command, {
        productId: selected, quote: product?.quote,
      });
      if (result.status === "purchased" || result.status === "restored") {
        clearOfferResume();
        window.location.assign("/app");
      } else if (result.status === "pending") setNotice(t("native.pending"));
      else if (result.status === "priceChanged") {
        const items = await nativeRequest<unknown>("products");
        const valid = halfOffOnly ? halfOffProducts(items) : nativeProducts(items).filter(item =>
          trialPlanProducts(items).some(trial => trial.id === item.id) || item.id === selected);
        setProducts(valid);
        setNotice(t("native.priceChanged"));
      }
    } catch (error) { setNotice(t(nativeBillingFailureKey(error))); }
    finally { setBusy(false); }
  }

  return {
    products, selected, busy, notice, productForPlan,
    selectedProduct: products.find(item => item.id === selected),
    selectPlan(plan: string) { const product = productForPlan(plan); if (product) setSelected(product.id); },
    purchase: () => perform("purchase"), restore: () => perform("restore"),
  };
}
