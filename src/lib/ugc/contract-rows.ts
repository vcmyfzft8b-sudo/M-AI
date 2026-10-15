import type { UgcCreatorApplicationRow, UgcCreatorContractRow } from "@/lib/database.types";
import { generatedContractText } from "@/lib/ugc/contract-edit";
import { campaignTermsAt, CREATOR_TERMS } from "@/lib/ugc/creator-campaigns";
import { campaignPay, parseContractPay, type ContractPay } from "@/lib/ugc/creator-pay";
import { campaignLocale, type CampaignLocale, type CreatorMarket } from "@/lib/ugc/creator-program";

/**
 * What a stored contract says, read the same way by the signing link, the admin list and
 * the admin's edit form: a contract created for a creator (`ugc_creator_contracts`, its
 * own deal) or an accepted applicant's terms (`ugc_creator_applications`, the campaign's
 * pay unless the admin gave them their own, `contract_pay`).
 *
 * The text is, in order: the text that was signed (`terms_snapshot`, once signed), the
 * admin's hand-written text (`terms_override`), or the text generated from the pay.
 */
export type ContractTerms = {
  market: CreatorMarket;
  locale: CampaignLocale;
  /** A parent or guardian signs too. */
  minor: boolean;
  pay: ContractPay;
  /** False when a contract's stored pay is not a valid deal; its link opens nothing until fixed. */
  payValid: boolean;
  applied: boolean;
  signed: boolean;
  /** The text that was signed, once signed (null for signatures from before it was kept). */
  signedText: string | null;
  override: string | null;
  /** The text as it stands now. */
  text: string;
};

function withText(terms: Omit<ContractTerms, "text">): ContractTerms {
  return { ...terms, text: terms.signedText ?? terms.override ?? generatedContractText(terms) };
}

export function contractRowTerms(row: UgcCreatorContractRow): ContractTerms {
  const pay = parseContractPay(row.pay);

  return withText({
    market: row.market,
    locale: campaignLocale(row.market, row.locale),
    minor: row.minor,
    pay: pay ?? campaignPay(CREATOR_TERMS[row.market]),
    payValid: pay !== null,
    applied: false,
    signed: row.signed_at !== null,
    signedText: row.signed_at ? row.terms_snapshot : null,
    override: row.terms_override,
  });
}

export function applicationRowTerms(row: UgcCreatorApplicationRow & { market: CreatorMarket }): ContractTerms {
  const signed = row.terms_accepted_at !== null;

  return withText({
    market: row.market,
    locale: campaignLocale(row.market, row.locale),
    minor: row.contract_minor ?? (row.age !== null && row.age < 18),
    // Their own deal when the admin set one; otherwise the campaign's pay under the terms
    // version they signed (the current one until they sign).
    pay: parseContractPay(row.contract_pay) ?? campaignPay(campaignTermsAt(row.market, signed ? row.terms_version : null)),
    payValid: true,
    applied: true,
    signed,
    signedText: signed ? row.terms_snapshot : null,
    override: row.terms_override,
  });
}
