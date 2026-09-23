import type { HelpArticles } from "@/lib/help/articles";

/**
 * English.
 *
 * The three legal documents are translations of the Slovenian originals,
 * which remain the authoritative version — the public legal pages say so
 * under the fine print (`legal.prevailingNotice`). They name the Slovenian
 * controller, the Slovenian supervisory authority and Slovenian law,
 * because that is the factual position, not an artefact of translation.
 */
export const enHelpArticles: HelpArticles = {
  "family-plan": {
    title: "Family plan?",
    content: `# Family plan

A shared family workspace is not supported yet.

For now each account has its own note library and its own processing history.

## What you can do today

- sign in with the account that should own the notes
- copy notes out of the note view where you need to
- upload material for the same subject to the same account, for more consistent results`,
  },
  "gift-coconote": {
    title: "Can I gift Memo?",
    content: `# Gifting access

If you have a promotional or gift code, the recipient can use it in Stripe Checkout before completing the purchase.

To use Memo, the recipient should create their own account, then enter the code at the Stripe payment step and check that the discount appears before confirming payment.`,
  },
  "supported-language": {
    title: "Do you support my language?",
    content: `# Supported languages

There is no language to set. Memo AI reads your material and writes the notes, flashcards and quizzes in whatever language the material itself is in.

## Recommendations

- upload the material as it is — there is no need to translate it first
- shorter recordings help where languages are mixed
- technical English terms may stay in the result when they are part of the source`,
  },
  "feature-request": {
    title: "Feature request",
    content: `# Suggest an improvement

The most useful suggestion is a short, concrete description of how you work.

It helps to include:

- what you were trying to do
- where you got stuck
- what result you expected
- whether it involves audio, a document, a PDF or a link`,
  },
  "video-isnt-working": {
    title: "The video link does not work",
    content: `# Trouble with a video link

Memo can only process content that is publicly reachable and readable enough to summarise.

## Try this

- check that the page does not require signing in
- use the page's direct URL
- if you have the material elsewhere, upload a PDF or a document instead`,
  },
  "audio-upload-issue": {
    title: "I cannot upload audio",
    content: `# Trouble uploading audio

The supported formats are MP3, M4A, WAV, OGG and WEBM.

## Checklist

- check that the file is not damaged
- stay under the current size limit
- if the audio came from a screen recording, export it again
- if an upload stopped earlier, try again from the home screen`,
  },
  "transcript-cut-short": {
    title: "The transcript is too short or inaccurate",
    content: `# Transcript quality

Transcript quality depends on how clean the audio is and how much the speakers overlap. Memo AI works out the language on its own.

## How to get better results

- record as close to the speaker as you can
- for conversations, enable multi-speaker capture
- reduce background noise
- split very long recordings into smaller parts`,
  },
  "redeem-code": {
    title: "Redeem a code",
    content: `# Redeeming a code

You can use a promotional or gift code in Stripe Checkout before completing the purchase.

## How to enter the code

- in settings, choose the option to buy or upgrade
- in the Stripe payment form, open the promotional code field
- enter the code and confirm that the discount appears before you pay

If the field does not appear, or the code is refused, check whether the code is still valid and whether it applies to the plan you chose.`,
  },
  "privacy-policy": {
    title: "Privacy policy",
    content: `# Privacy policy

This policy explains which personal data we process, why we process it, who we pass it to, how long we keep it and what rights you have. It covers the memoai.eu website and the Memo AI app.

## 1. Data controller

The controller of your personal data is **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenia (company registration number 7578474000, tax number 52958248), which operates the Memo AI service available at memoai.eu.

Contact for privacy questions and for exercising your rights: info@memoai.eu

## 2. Which data we process

**Account data**

- email address
- user identifier and authentication data
- the data Google or Apple pass on if you sign in through them: email address, name and account identifier
- your name, if you enter one

**Data from the initial setup**

- your answers in the onboarding survey, such as field of study, how you use the app and why

**Content you send**

- audio recorded in the app, and audio files you upload
- pasted text, handwritten notes and prompts
- PDFs, documents and images you upload or scan
- public web links you ask Memo AI to read
- messages in the chat with your notes

**Data produced by using the service**

- transcripts, summaries, notes, flashcards, quizzes, tests and chat answers generated from your material
- your library structure, folders, progress markers and processing history
- the state of background jobs, and error logs

**Payment data**

- subscription status, chosen plan, period and payment history
- your Stripe customer and subscription identifiers

For App Store subscriptions, we process Apple's signed transaction records, product and transaction identifiers, purchase and expiry dates, and refund or revocation status. We send Apple your Memo account's technical identifier to associate the purchase with your account and verify access.

If you allow notifications in the iOS app, we store the push token Apple issues for your device, linked to your account, and use Apple's push service to tell you when a note is ready. The notification contains the note's title. You can turn notifications off in iOS Settings at any time; signing out removes the token, and deleting your account deletes it.

We neither receive nor store your card details. Payment details are handled directly by Stripe for web purchases or Apple for App Store purchases.

**Technical data**

- IP address, device type, browser and operating system
- access times, requests and server responses
- error and crash data
- page visits, approximate country/region/city and device details, linked to your account where available, through optional analytics (in the iOS app only after you turn it on; on the website unless you turn it off)

## 3. Purposes and legal bases

**Performance of a contract (Article 6(1)(b) GDPR)**

- creating and running your account, and signing in
- storing and organising your note library
- transcribing, analysing and processing the material you send
- producing summaries, notes, flashcards, quizzes, tests and chat answers
- billing the subscription, and processing payments and refunds
- user support

**Legal obligation (Article 6(1)(c) GDPR)**

- issuing and keeping invoices, and other tax and accounting obligations
- responding to requests from competent authorities

**Legitimate interest (Article 6(1)(f) GDPR)**

- security of the service, preventing abuse, rate limiting and detecting fraud
- fixing faults and improving the reliability of the product
- establishing or defending legal claims

Where we process on the basis of legitimate interest, we have weighed our interest against your rights. You can object to such processing at any time.

**Consent (Article 6(1)(a) GDPR)**

- optional product messages, where you sign up for them
- optional analytics: in the iOS app only after you turn it on in Settings; on the website unless you turn it off there

You can withdraw consent at any time. Withdrawal does not affect the lawfulness of processing before it.

## 4. Special categories of personal data

Memo AI is not intended for processing special categories of personal data, such as health data, biometric data, or data about religion, political opinions or sexual orientation.

If you upload such material anyway, you do so at your own responsibility and must have a valid legal basis for it. We advise against uploading such material about other people.

## 5. Permissions for recordings and material

By using Memo AI you confirm that you have every permission and right needed to record, upload, paste or link the content you send to the app. That includes permission from a school, teacher, lecturer, institution, employer, the people being recorded, or other rights holders, where such permission is required.

Do not upload recordings of lectures, slides, teaching material, documents or other content to Memo AI if you do not have permission or a legal basis for doing so.

Where other people appear in your material, you are the one who decides how their personal data is processed, and we process the material on your instructions.

## 6. Who we pass data to

We do not sell data. We pass it only to the providers we need in order to run the service, and only to the extent a given function requires. We have data processing agreements in place with them.

- **Supabase** — authentication, database and file storage
- **Stripe** — processing payments, subscriptions and refunds
- **Google (Gemini)** — transcription, extracting text from documents, embeddings, generating notes and chat answers
- **Soniox** — audio transcription, where that service is switched on
- **OpenRouter and its selected model providers** — generating AI answers and study content where these services are used
- **Vercel** — hosting, optional visit analytics and performance measurements
- **Inngest** — running background jobs, where switched on
- **Sentry** — error and crash monitoring
- **Google and Apple** — sign-in, where you choose to sign in through them

Apple also processes App Store purchases and subscription management under its own [privacy policy](https://www.apple.com/legal/privacy/). We exchange the transaction information described above with Apple to verify and maintain your paid access.

We may also disclose data to competent authorities where we are legally required to, and to our legal or accounting advisers where necessary.

If there is a change of corporate status or a sale of the business, data may be transferred to the acquirer, with this policy continuing to apply until we notify you of a change.

## 7. Transfers outside the EU and EEA

Some providers also process data outside the European Economic Area, in particular in the United States of America.

In those cases the transfer is made on the basis of:

- an adequacy decision of the European Commission, where one exists, or
- the European Commission's standard contractual clauses together with additional safeguards

You can request a copy of the safeguards used at info@memoai.eu.

## 8. How long we keep data

- **account data** — for as long as your account exists, then for up to 30 days after deletion
- **content and generated notes** — until you delete them or delete your account; removed from backups within 30 days at the latest
- **payment data and invoices** — 10 years, as tax law requires
- **error and security logs** — up to 12 months
- **support correspondence** — up to 24 months after the matter is closed
- **data needed for legal claims** — until the claim is time-barred

Content stays linked to your account until you delete it in the app, or until we remove it through support or routine clean-up.

## 9. Security

We use technical and organisational measures appropriate to the risk, among them:

- encryption of data in transit
- separation of data access at database level, so that only you can reach your own notes
- limited and logged staff access, restricted to cases where it is necessary
- monitoring of errors and unusual traffic

No system is completely secure. If a personal data breach occurs that could pose a high risk to you, we will notify you and also notify the Information Commissioner, as the law requires.

## 10. Your rights

Under the GDPR you have the right to:

- **access** — confirmation of whether we process your data, and a copy of it
- **rectification** — correction of inaccurate data, or completion of incomplete data
- **erasure** — deletion of data where there is no longer a basis for processing it
- **restriction of processing** — in the cases the law provides for
- **portability** — receiving your data in a machine-readable form, or having it transferred to another provider
- **objection** — to processing based on legitimate interest
- **withdrawal of consent** — where processing is based on consent

We do not carry out automated decision-making with legal effects for you, nor profiling within the meaning of Article 22 GDPR.

## 11. How to exercise your rights

Send your request to info@memoai.eu from the email address linked to your account. We reply within one month at the latest; in complex cases the deadline may be extended by two months, and we will tell you if it is.

To verify your identity we may ask for further details, but only to the extent needed for that.

If you believe we are processing your data unlawfully, you can lodge a complaint with the Information Commissioner of the Republic of Slovenia, Dunajska cesta 22, 1000 Ljubljana, gp.ip@ip-rs.si.

## 12. Cookies and similar technologies

We use essential cookies and local storage for sign-in, security, settings and remembering your analytics choice. These are needed for the functions you request.

**Optional analytics is off by default in the iOS app and on by default on the website.** In Settings → Optional analytics, you choose whether Memo and Vercel collect page visits, approximate location, device information and performance measurements. Visits may be linked to your Memo account. You can turn this off again on the same device without losing access to the app.

The essential \`memo-analytics\` preference lasts up to 180 days. When you opt in, the \`memo-visit\` analytics cookie lasts up to 24 hours. Turning analytics off removes that visit cookie and stops future optional collection. A cookie's expiry does not delete records already on the server: account-linked visit records are removed when you delete your account, or you can request their removal at info@memoai.eu.

We do not use advertising cookies or cross-site advertising tracking. On the website only, when an error occurs, our error service may keep a replay of the moments before it with all text, inputs and media hidden; the iOS app never records one. Necessary security and error diagnostics continue independently of optional analytics.

## 13. Children

Memo AI is not intended for children under 16. If we find that we have processed the data of a child under 16 without an appropriate basis, we delete it. If you are a parent or guardian and believe this has happened, write to us at info@memoai.eu.

## 14. Your choices

If you do not want the processing described in this policy to take place, do not upload, paste, record or link that content in Memo AI. If you need stricter terms on retention, deletion or contractual provisions, contact us before using the service.

## 15. Changes to this policy

We may update this policy as the product, the providers or the law change. We will notify you of material changes by email or in the app.

## 16. Contact

info@memoai.eu`,
  },
  "refund-policy": {
    title: "Refund policy",
    content: `# Refund policy

This policy explains when we refund payment for a Memo AI subscription, how much of it, and how you ask. It forms part of the terms of use.

## 1. In short

**App Store purchases:** request a refund through [Apple](https://reportaproblem.apple.com/). Apple processes these requests; the web purchase deadlines and partial-refund percentages below do not apply to App Store transactions. Your statutory consumer rights remain unaffected. For help with the service itself, contact info@memoai.eu.

**Web purchases through Stripe:**

- **request within 24 hours of payment** — we refund 50% of the amount paid
- **request more than 24 hours after payment** — no refund
- **cancelling the subscription** — at any time; access continues to the end of the period already paid for
- **our mistake, or a double charge** — refunded in full
- **your statutory right of withdrawal as a consumer** — applies alongside this policy and takes precedence over it

## 2. What it covers

This policy covers subscriptions bought directly in Memo AI through Stripe.

It applies to each individual payment, including automatic renewals. The 24-hour window starts again for every payment, from the time of the charge.

## 3. Partial refund within 24 hours

If you send a refund request within **24 hours of the time of the charge**, we refund **50% of the amount paid** for that period.

- the window starts at the moment the payment was charged
- the time your request arrives at info@memoai.eu is the one that counts
- when a refund is approved the subscription is cancelled, and paid access ends as soon as the refund is issued
- a partial refund is available once per billing period

## 4. After 24 hours

For requests sent **more than 24 hours** after the charge, there is no refund.

You can still cancel the subscription at any time. In that case no new period is charged, and paid access stays with you until the end of the period already paid for.

## 5. When we refund in full

Regardless of the windows in sections 3 and 4, we refund in full where:

- the same amount was charged twice by mistake
- payment was charged after the subscription had validly been cancelled
- payment was charged without your authorisation and you tell us as soon as you find out
- paid features could not be used for an extended period because of a fault on our side, and we did not fix it within a reasonable time
- we closed your account through no fault of yours; in that case we refund the proportionate part for the unused period
- the law requires it

## 6. When there is no refund

- for periods that have already run out in full
- for the free trial, because nothing was paid for it
- for promotional and gift codes and discounts; these are not paid out in cash
- where the account was closed for a breach of the terms of use
- for repeated requests from the same user, where this policy is clearly being abused

We do not refuse a refund because you used the service. If you created content during the period you are asking a refund for, that has no bearing on the amount refunded under this policy.

## 7. How to request a refund

Write to **info@memoai.eu** from the email address linked to your account, and state:

- the date of the payment and the amount
- the plan you bought
- whether you also want the subscription cancelled
- a short reason, which helps us improve the product; you do not have to give one

We confirm receipt and reply within **5 working days** at the latest.

## 8. How the refund is made

- the refund is made through Stripe, to the same payment method the payment was made with
- we approve the refund within **14 days** of receiving the request at the latest
- how long it takes for the amount to appear on your account depends on your bank or card issuer; usually 5 to 10 working days
- we do not charge you a processing fee for the refund

## 9. Cancelling the subscription

Cancelling and refunding are not the same thing.

You cancel the subscription in your account settings, or through the link to the Stripe portal. Cancelling prevents the next charge; it does not refund an amount already paid. For a refund you have to send a separate request under section 7.

If you cancel before the free trial runs out, no payment is charged.

## 10. Disputing a charge with your bank

If you think a payment was wrong, write to us first. We settle most cases faster than a bank's dispute process.

If you raise a dispute with your bank or card issuer without contacting us first, we may temporarily restrict access to the account until the process is closed.

## 11. Changes to this policy

We may change this policy. For any individual payment, the version published on the day of that payment always applies.

## 12. Contact

info@memoai.eu`,
  },
  "terms-of-use": {
    title: "Terms of use",
    content: `# Terms of use

These terms are a legally binding agreement between you and the operator of the Memo AI service. Read them before you create an account or buy a subscription.

## 1. Who we are

Memo AI is an online service available at memoai.eu ("Memo AI", "we" or "us"). The service is operated by:

- **Memo AI, Nace Valenčič s.p., poslovno svetovanje**
- registered address: Zgoša 87, 4275 Begunje na Gorenjskem, Slovenia
- company registration number: 7578474000
- tax number: 52958248

For any questions, requests and notices under these terms, write to info@memoai.eu.

## 2. Acceptance of the terms

By creating an account, signing in or using Memo AI you confirm that you have read these terms, that you understand them and that you agree to them. If you do not agree to them, do not use Memo AI.

The following apply alongside these terms:

- the privacy policy, which explains how we handle personal data
- the refund policy, which governs cancellations and refunds of payments

The contract is concluded in the Slovenian language. We keep the text of the contract in the form of these published terms, and it is available to you on this page at all times.

## 3. Who may use Memo AI

- you must be at least 16 years old to use the service
- if you are under 18, you must have the consent of a parent or legal guardian who agrees to these terms on your behalf
- your account is personal; do not share your sign-in details and do not transfer the account to anyone else
- if you use Memo AI on behalf of a school, company or other organisation, you confirm that you are authorised to bind that organisation to these terms

Memo AI is intended for personal study use. For use in an institution or a company with its own requirements on retention, deletion or contractual provisions, contact us before using it.

## 4. Account and security

- give truthful details when you register, and an email address you actually have access to
- you are responsible for the security of your mailbox, your sign-in codes and any linked Google or Apple accounts
- you are responsible for all activity on your account, unless it happened through our fault
- if you suspect unauthorised access, tell us immediately at info@memoai.eu

## 5. What Memo AI is

Memo AI is a study tool that works with artificial intelligence. From the material you send it, it produces transcripts, summaries, structured notes, flashcards, quizzes, tests and chat answers, and it lets you export and organise a library of notes.

Memo AI is not:

- a substitute for lectures, study literature or your own work
- professional advice of any kind, in particular not medical, legal, financial, tax or safety advice
- a data storage service you may rely on as the only copy of your material

Keep your own backups of anything important.

## 6. Free use and the trial period

An App Store trial applies only if Apple shows it in the purchase confirmation. Web trials and promotional codes do not automatically apply to App Store purchases. The trial rules below describe our web offer.

- without a subscription you can create a limited amount of content, including one trial note and a limited number of chat messages
- on your first subscription purchase you may get a 3-day free trial, if you qualify for it
- the free trial is available to one person once; users who have already had a subscription with us are not entitled to it
- if you do not cancel the trial before it runs out, the subscription continues automatically and payment is charged at the current price
- we may change the scope of free use going forward

## 7. Subscriptions, prices and payments

**App Store subscriptions**

On iOS, Apple processes in-app subscription purchases. Apple's purchase confirmation shows the price, currency, billing period and any offer before you confirm. The subscription renews automatically until cancelled through Apple. Apple handles billing, receipts and applicable price-change notices. The monthly and yearly plans provide the same Memo Premium features for different billing periods. Use Restore Purchases while signed in to the Memo account used for the original purchase. Apple subscriptions cannot be transferred between Memo accounts.

**Web subscriptions through Stripe**

- Memo AI is sold as a recurring subscription; current prices and periods are stated on the pricing page and in Stripe Checkout before you confirm the purchase
- all prices are stated in euros; whether tax is included or added is shown clearly before you complete the purchase
- payments are processed on our behalf by Stripe; we neither receive nor store your full card details
- the subscription renews automatically at the end of each billing period until you cancel it
- payment for a new period is charged on the renewal date, using the payment method stored with Stripe
- if a payment fails, we may temporarily restrict access to paid features until the payment is settled
- promotional and gift codes apply under the conditions stated with the code, and cannot be exchanged for cash
- we may change prices; we will notify you at least 30 days before a change takes effect, and the change applies from the next billing period. If you do not agree to the price, you can cancel the subscription before it takes effect

You receive an invoice for every payment at the email address linked to your account.

## 8. Cancellation

For App Store subscriptions, use Manage Apple Subscription in Memo's settings or open iPhone Settings → your name → Subscriptions. Cancel before the renewal date; paid access normally continues until the subscription expires. Deleting Memo or your Memo account does not cancel an Apple subscription. Request App Store refunds through [Apple](https://reportaproblem.apple.com/).

**Web subscriptions through Stripe:**

You can cancel the subscription at any time in your account settings or through the link to the Stripe portal. Cancellation takes effect at the end of the current paid period; until then the paid features remain available. Cancelling does not in itself refund an amount already paid.

Refunds are governed by the refund policy.

## 9. Your responsibilities

- you may only upload, record, paste or link material that you own or are allowed to use
- you are responsible for the lawfulness and accuracy of the content you send
- you must follow your school's, university's or employer's rules on recording and sharing material
- you must check the results Memo AI produces before you rely on them

## 10. Permissions for recordings and material

By using Memo AI you confirm that, before recording, uploading, pasting or linking content, you have every permission and right needed. That includes permission from a school, teacher, lecturer, institution, employer, the people being recorded, or other rights holders, where such permission is required.

Do not record lectures, conversations or other people, and do not upload slides, notes, teaching material, documents or other files, if you do not have permission or a legal basis for doing so. It is your responsibility that your use of Memo AI does not breach your school's rules, contractual restrictions, copyright, privacy, recording rules or other applicable laws and rules.

Do not upload other people's special categories of personal data to Memo AI — for example health data, or data about religion, political opinions or sexual orientation — unless you have a valid legal basis for it.

## 11. Prohibited use

You must not use Memo AI to:

- upload malicious software or attempt to compromise the security of the service
- reach parts of the service, accounts or data you have no right to
- circumvent volume limits, the paywall, trial limits or technical protections
- automatically scrape, reverse engineer or load-test the service without our written permission
- create or spread unlawful, abusive, misleading or violent content
- interfere with the rights of others, including copyright and the right to privacy
- resell or rent out the service, or offer it as your own
- breach academic integrity rules, or hand in generated content as your own work where that is not allowed
- use Memo AI for automated bulk processing of material unrelated to your own studies

## 12. Your content

The material you send to Memo AI stays yours. So that the service can run, you grant us a non-exclusive, time-limited and territorially unlimited right to store, display and process that material and to pass it to our processing providers, solely so that we can carry out the functions you ask for.

That right ends when you delete the content or when we delete your account, except where we still have to keep the data because of legal obligations.

We do not sell your content and we do not use it for advertising.

## 13. Our rights

Memo AI, its software, design, brand and any content that is not yours are owned by us or by our licensors. Taking out a subscription gives you a personal, non-transferable and non-exclusive right to use the service in accordance with these terms; it does not give you ownership of it.

## 14. AI processing and the limits of the results

To produce transcripts, summaries, flashcards, quizzes, chat answers and extracted document content, Memo AI may process your content with external AI and infrastructure providers.

That may include:

- audio recordings and uploaded audio files
- pasted text and notes
- PDFs and other supported documents
- public web links you ask Memo AI to read
- metadata needed for the operation, security and improvement of the service

The list of providers and the bases for processing are set out in the privacy policy.

Memo AI can produce mistakes, incomplete answers or misleading study material. You must check the results yourself before relying on them for exams, coursework, or medical, legal, financial, compliance or safety-critical decisions.

## 15. Availability and changes to the service

We work to keep the service running smoothly, but we do not promise uninterrupted availability. The service may be temporarily unreachable because of maintenance, faults, updates or disruption at external providers.

We may change, add or withdraw individual features. If a change would be materially disadvantageous to paying users, we will tell you about it in advance, and you can cancel the subscription.

## 16. Enforcement and account termination

We may temporarily restrict access, disable certain features or remove content where use appears abusive, unlawful, dangerous or harmful to the service or to other users.

For serious or repeated breaches we may close the account. Where it is feasible and permitted, we will tell you the reason and give you the chance to explain or put right what led to it. If we close your account through no fault of yours, we refund the proportionate part of the subscription paid in advance.

You can close your own account at any time by writing to us at info@memoai.eu.

## 17. Warranties

The service is provided as it is. To the extent the law allows, we give no warranty that the service will be free of faults, uninterrupted or fit for a particular purpose, and we do not warrant the accuracy of the results the AI produces.

This does not affect the mandatory warranties you have as a consumer under Slovenian and European law.

## 18. Limitation of liability

To the extent the law allows, we are not liable for:

- lost profit, lost opportunity, loss of data or indirect damage
- the consequences of decisions you made on the basis of unchecked AI results
- the conduct of third parties or the failure of their services
- damage arising from your breach of these terms

Our total liability on any single claim is limited to the amount you paid us in the 12 months before the event that caused the damage.

Nothing in these terms excludes or limits liability for intent, gross negligence, death or personal injury, or liability that cannot be excluded by law. If you are a consumer, all your rights under consumer protection law remain fully available to you.

## 19. Your indemnity

If a third party brings a claim against us because of your breach of these terms, or because of material you sent without the necessary rights, you reimburse us for the reasonable costs we incur as a result. This applies only to the extent that the claim follows from your conduct.

## 20. Changes to the terms

We may change these terms as the product, the law or our providers change.

- we notify you of material changes by email or in the app at least 30 days before they take effect
- minor corrections that do not affect your rights are published directly on this page
- if you carry on using the service after a change takes effect, that means you accept the updated version
- if you do not agree to a change, you can cancel the subscription before it takes effect

## 21. Termination

When the contract ends, your right to use the service ends. Content linked to your account is handled in accordance with the privacy policy. The provisions on intellectual property, limitation of liability, indemnity and dispute resolution continue to apply after termination.

## 22. Governing law and dispute resolution

These terms are governed by the law of the Republic of Slovenia, without applying its conflict-of-law rules. If you are a consumer resident in another EU country, that choice does not deprive you of the protection given to you by the mandatory rules of your own country.

We first try to settle disputes by agreement; write to us at info@memoai.eu and we will reply within a reasonable time.

As a consumer you may also use:

- out-of-court consumer dispute resolution, where it is available. We do not currently recognise any out-of-court consumer dispute resolution body as competent for disputes under these terms
- a complaint to the Market Inspectorate of the Republic of Slovenia

Disputes that cannot be settled by agreement fall to the competent court in the Republic of Slovenia. If you are a consumer, this does not affect your right to bring an action before the court where you live.

## 23. Final provisions

- if any individual provision of these terms is invalid, the remaining provisions stay in force
- you cannot transfer these terms to anyone else without our consent; we may transfer them on a change of corporate status or a sale of the business, without your rights being worsened
- if we do not enforce a right immediately, we do not waive it
- these terms, together with the privacy policy and the refund policy, form the entire agreement between you and us on the use of Memo AI

## 24. Contact

info@memoai.eu

---

**Your statutory right of withdrawal as a consumer.** If you are a consumer resident in the EU or EEA, the law gives you the right to withdraw from a subscription contract within 14 days of entering into it, without giving a reason. Because the service begins at your express request immediately after purchase, at the point of purchase you expressly request that performance begins before the withdrawal period expires; if you withdraw during the withdrawal period, we refund the amount paid, less the proportionate part corresponding to the service provided up to the day of withdrawal. This statutory right applies alongside the refund policy: where the law gives you a larger refund than the refund policy provides in a particular case, the law prevails. A clear statement by email to info@memoai.eu is enough to withdraw, and you may also use the withdrawal form annexed to the Slovenian Consumer Protection Act. Nothing in these terms or in the refund policy limits the rights you have as a consumer under mandatory law.`,
  },
};
