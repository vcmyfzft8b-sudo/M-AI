import Stripe from "stripe";

/**
 * Stamps the statutory invoice footer onto Stripe customers created before the s.p. existed.
 * New customers get it at creation time — see INVOICE_FOOTER in src/lib/billing.ts, which this
 * text must stay in sync with. Scripts here declare their own constants (server-only modules
 * cannot be imported from a plain .mjs run).
 *
 * Dry run by default; pass --apply to write. Customers that already carry the exact footer are
 * skipped, so re-running is cheap and safe.
 */
const INVOICE_FOOTER = [
  "Memo AI, Nace Valenčič s.p., poslovno svetovanje",
  "Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija",
  "Matična številka: 7578474000 · Davčna številka: 52958248",
  "DDV ni obračunan na podlagi 1. odstavka 94. člena ZDDV-1.",
].join("\n");

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

  let scanned = 0;
  let alreadySet = 0;
  let updated = 0;

  for await (const customer of stripe.customers.list({ limit: 100 })) {
    scanned += 1;

    if (customer.invoice_settings?.footer === INVOICE_FOOTER) {
      alreadySet += 1;
      continue;
    }

    updated += 1;

    if (!apply) {
      continue;
    }

    await stripe.customers.update(customer.id, {
      invoice_settings: { footer: INVOICE_FOOTER },
    });
  }

  console.log(
    `${apply ? "Updated" : "Would update"} ${updated} of ${scanned} customers (${alreadySet} already correct).`,
  );

  if (!apply) {
    console.log("Dry run — re-run with --apply to write.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
