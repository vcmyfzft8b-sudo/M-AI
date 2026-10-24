# Fiscal verification of invoices (davčno potrjevanje računov)

FURS answered on 2026-10-06 (zadeva 0920-15932/2026) that card payments through Stripe count as
cash under ZDavPR, so every payment since the s.p. was registered (3. 9. 2026) needs an invoice that
FURS has confirmed. This is how Memo AI issues them. Apple In-App Purchases are out of scope: Apple
is the seller there.

## What happens on a payment

1. Stripe sends `invoice.paid` (a subscription payment) or `checkout.session.completed` with
   `mode: payment` (tutor minutes) to `/api/stripe/webhook`.
2. `allocate_fiscal_invoice` (migration 0073) takes the next number in `P1-SPLET-n` under a row lock
   and writes the invoice in the same statement. A redelivered webhook gets the same invoice back
   and burns no number, and leaves sending it to whoever created it (two sends would get two
   EORs). Numbers restart at 1 each business year (Slovenian calendar year), are numbered per
   device (`NumberingStructure: "B"`), and FURS's test and production systems keep separate
   series, so a test run can never take a real number.
3. The ZOI is computed and stored (`src/lib/fiscal/furs-protocol.ts`).
4. The invoice is signed (RS256 JWS) and sent to FURS over two-way TLS
   (`src/lib/fiscal/furs-client.ts`). The signed request and FURS's signed answer are logged in
   `fiscal_invoice_messages`; FURS's signature is checked against SIGOV-CA.
5. The customer gets the invoice by email through Resend (`src/lib/fiscal/invoice-document.ts`):
   number, time, operator label, `EOR`, `ZOI` and the QR code under it.
6. If FURS could not be reached or refused it, the invoice still goes out at once, with the ZOI but
   without an EOR (ZDavPR art. 9), and `/api/cron/fiscal-invoices` sends it again every 15 minutes
   with `SubsequentSubmit` until FURS confirms it. The law allows two working days. An EOR that comes
   later is kept in the database and never added to the customer's copy. The cron takes rows
   oldest-attempt first, stops after 20 FURS attempts or 10 email attempts per invoice (each failure
   is in Sentry), and ends its run inside the function's time limit.

A refund (`charge.refunded`, or `charge.refund.updated` once a pending refund succeeds) gets a credit note (dobropis): a negative invoice in the same series
with a `ReferenceInvoice` to the original. Refunds of payments made before fiscal verification was
switched on have no original to reference and get nothing.

## Switching it on

Nothing runs until every value below is set. Do the steps in this order.

1. **Certificate.** In eDavki (role: the s.p.) file "DPR-PridobitevDP Zahtevek za pridobitev
   namenskega digitalnega potrdila za izvajanje postopka davčnega potrjevanja računov". MJU then
   publishes a reference number and password; download the `.p12` with them. For the test
   environment, email sd.fu@gov.si for a test certificate (it comes with a random test tax number).
2. **Convert it once** (add `-legacy` if OpenSSL 3 refuses the file):
   ```
   openssl pkcs12 -in furs.p12 -clcerts -nokeys -out furs-cert.pem
   openssl pkcs12 -in furs.p12 -nocerts -nodes -out furs-key.pem
   ```
3. **CA.** Download SIGOV-CA2 and the SI-TRUST root and concatenate them as PEM
   (`openssl x509 -inform der` if they are DER):
   - https://www.si-trust.gov.si/assets/si-trust-root/povezovalni-podrejeni/sigovca-2/sigov-ca2.xcert.crt
   - https://www.si-trust.gov.si/assets/si-trust-root/korensko-potrdilo/si-trust-root.crt
4. **Environment (Vercel, Production only).** Test mode (`FURS_ENVIRONMENT=test`) is for a local
   run against the staging database with Stripe in test mode, never on Production: it keeps its own
   number series and sends no email to customers, but it would still read real payments there.
   | Variable | Value |
   |---|---|
   | `FURS_ENABLED` | `true` |
   | `FURS_ENVIRONMENT` | `test` first, then `production` |
   | `FURS_CERT_PEM` | contents of `furs-cert.pem` |
   | `FURS_KEY_PEM` | contents of `furs-key.pem` (secret) |
   | `FURS_CA_PEM` | SIGOV-CA2 + SI-TRUST root, PEM |
   | `FURS_TAX_NUMBER` | `52958248` (on test: the number in the test certificate) |
   | `RESEND_API_KEY` | already used for creator emails |
   | `FISCAL_EMAIL_FROM` | optional, default `Memo AI <racuni@memoai.eu>` |
5. **Stripe webhook events.** Add `invoice.paid`, `charge.refunded` and `charge.refund.updated` to the production webhook
   endpoint (it already receives `checkout.session.completed` and the subscription events).
6. **Internal act (interni akt).** Must exist before the first invoice. It names the premise `P1`
   (the seat, Zgoša 87), the device `SPLET` (the server that issues invoices), numbering per device
   (`P1-SPLET-n`, restarting each year), the back-filing device `STARI` and the operator label
   `SPLET`. A draft is in the owner's filing folder; FURS publishes templates on
   eDavki under "Interni akt".
7. **Register the premise** before the first invoice (FURS answers `S006` otherwise):
   ```
   node --experimental-strip-types scripts/furs-register-premise.mjs \
     --cadastral <k.o.> --building <stavba> --section <del stavbe> --valid-from <YYYY-MM-DD> --echo --send
   ```
   The cadastral municipality, building and part numbers of Zgoša 87 come from GURS (e-prostor).
   FURS: send zeros if the building has no number.
8. Run on `test` for at least two days (FURS's recommendation; locally against staging, see step 4),
   then set the production certificate and `FURS_ENVIRONMENT=production` on Production and register
   the premise there.

## Not done here, on purpose

- **Payments before fiscal verification starts (backlog).** FURS's answer: invoices must be
  verified "od dneva registracije dejavnosti dalje", so payments from 3. 9. 2026 until the
  switch-over (368 payments and 12 refunds by 24. 10. 2026), and none before the s.p. existed.
  `scripts/furs-backfill-old-invoices.mjs` follows FURS FAQ Q304: premise `P1`, a device label
  used only for this (`STARI`, named in the internal act first), the original payment time,
  `SubsequentSubmit` and `SpecialNotes: "#OLDINV;"`, credit notes for the refunds, and nothing sent
  to customers. Dry run by default. The owner asked FURS to confirm the procedure before `--send`.
- **The notice to buyers** that the seller must issue an invoice and the buyer must take it has to
  be published on the website where people buy (OPIS §6.1, FAQ Q234). The exact wording still
  needs to be taken from FURS before it goes on the paywall, in all five catalogues, web only.
- **Copies.** Re-sending an invoice would be a copy marked `KOPIJA n`; there is no "send again"
  feature, so none is produced.

## Open points from the specification

- FURS identifies the certificate by its serial; its spec is inconsistent about the exact
  `subject_name`/`issuer_name` strings. `FURS_CERT_SUBJECT_NAME` and `FURS_CERT_ISSUER_NAME`
  override the computed RFC 2253 names if the test environment wants another form.
- Times are sent as naive Europe/Ljubljana local time, which is what the invoice shows.

Sources: FURS technical specification v3.2 (March 2026), its JSON schema, ZDavPR and its
implementing rules, and FURS's "Davčno potrjevanje računov – podrobnejši opis" (August 2026).
