import type { Locale } from "../i18n/locales.ts";
import type { ContractPay } from "./creator-pay.ts";
import type { CreatorMarket } from "./creator-program.ts";
import { creatorTermsMarkdown } from "./creator-terms.ts";

/**
 * What an edited contract's text becomes.
 *
 * The edit form shows the contract's current text in a box, under its details and pay.
 * Whatever the admin typed in that box wins: the contract then has hand-written text,
 * kept until they ask for it to be generated again. Left untouched, the box follows the
 * details: text that was generated is generated again when the pay, campaign or
 * language changed, and otherwise stays exactly as it was (so fixing a signed contract's
 * email never rewords it).
 *
 * Pure on purpose (relative imports, no `server-only`): the Node tests load it.
 */

/** What the generated text is built from. A name or an email is not part of it. */
export type ContractTextInputs = {
  locale: Locale;
  market: CreatorMarket;
  pay: ContractPay;
  /** True for an applicant (the terms compare later videos to their sample video). */
  applied: boolean;
};

export type EditedContractText = {
  text: string;
  /** Typed by the admin rather than generated from the pay. */
  handWritten: boolean;
  /** Generated anew from the edited details, at the current terms version. */
  regenerated: boolean;
};

/** Line endings and trailing space the browser adds must not count as an edit. */
export function normalizeContractText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim().concat("\n");
}

export function generatedContractText({ locale, market, pay, applied }: ContractTextInputs): string {
  return creatorTermsMarkdown(locale, market, { pay, applied });
}

export function editedContractText({
  submitted,
  current,
  handWritten,
  before,
  after,
  regenerate,
}: {
  /** What the text box held when the form was sent. */
  submitted: string;
  /** The text the form showed. */
  current: string;
  /** Whether the current text was written by hand. */
  handWritten: boolean;
  before: ContractTextInputs;
  after: ContractTextInputs;
  /** The admin asked for the text to be generated from the details again. */
  regenerate: boolean;
}): EditedContractText {
  const generated = generatedContractText(after);

  if (regenerate) {
    return { text: generated, handWritten: false, regenerated: true };
  }

  const typed = normalizeContractText(submitted);
  const shown = normalizeContractText(current);

  if (typed !== shown) {
    return { text: typed, handWritten: true, regenerated: false };
  }

  if (!handWritten && generated !== generatedContractText(before)) {
    return { text: generated, handWritten: false, regenerated: true };
  }

  return { text: shown, handWritten, regenerated: false };
}
