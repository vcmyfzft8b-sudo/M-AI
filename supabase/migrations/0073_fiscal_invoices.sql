-- Fiscal verification of invoices (davčno potrjevanje računov, ZDavPR).
--
-- FURS answered on 2026-10-06 (zadeva 0920-15932/2026) that card payments through Stripe count as
-- cash, so every payment since the s.p. was registered needs an invoice that FURS has confirmed
-- (an EOR) before it reaches the customer. Stripe's own invoice numbers cannot serve: the fiscal
-- number has three parts (premise-device-sequence) and must run without gaps through the business
-- year, credit notes included. See docs/fiscal-verification.md.
--
-- fiscal_invoice_counters  one row per (FURS environment, year, premise, device); the next number is taken under a
--                          row lock in the same statement that writes the invoice, so a rolled-back
--                          payment never burns a number (a Postgres SEQUENCE would).
-- fiscal_invoices          the invoice as issued: number, time, amount, ZOI, EOR and the Stripe
--                          payment it belongs to. Rows are never deleted or rewritten in place
--                          (ZDavP-2 art. 38): a refund is a new, negative invoice that references
--                          the original.
-- fiscal_invoice_messages  every signed request sent to FURS and every answer, append-only.
--
-- Service role only: RLS on, no policies, like the admin tables.

create table if not exists public.fiscal_invoice_counters (
  -- FURS's test and production systems are separate worlds: a test invoice must never take a
  -- production number, or FURS would see a gap in the real series.
  furs_environment text not null check (furs_environment in ('test', 'production')),
  business_year integer not null,
  premise_id text not null,
  device_id text not null,
  last_number bigint not null default 0,
  primary key (furs_environment, business_year, premise_id, device_id)
);

create table if not exists public.fiscal_invoices (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invoice', 'credit_note')),
  furs_environment text not null check (furs_environment in ('test', 'production')),
  business_year integer not null,
  premise_id text not null check (premise_id ~ '^[0-9a-zA-Z]{1,20}$'),
  device_id text not null check (device_id ~ '^[0-9a-zA-Z]{1,20}$'),
  invoice_number bigint not null check (invoice_number > 0),
  issued_at timestamptz not null,
  amount_cents bigint not null,
  currency text not null default 'eur' check (currency = 'eur'),
  description text not null,
  operator_label text not null,
  tax_number integer not null,
  -- Filled right after the number is taken: the number is part of what the ZOI signs. The ZOI is
  -- deterministic (RSA PKCS#1 v1.5 over fixed fields), so a crash in between is repaired by
  -- computing it again from this row.
  zoi text check (zoi ~ '^[0-9a-f]{32}$'),
  eor text,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  -- True once the customer has been sent the invoice without an EOR: every later send must then
  -- carry SubsequentSubmit, and the EOR is kept here but never added to the customer's copy.
  delivered_without_eor boolean not null default false,
  send_attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  confirmed_at timestamptz,
  emailed_at timestamptz,
  email_attempts integer not null default 0,
  last_email_attempt_at timestamptz,
  email_to text,
  user_id uuid references auth.users (id) on delete set null,
  -- The Stripe payment this invoice settles. One fiscal invoice per payment; one credit note per
  -- Stripe refund.
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_checkout_session_id text,
  stripe_refund_id text,
  reference_invoice_id uuid references public.fiscal_invoices (id),
  special_notes text,
  created_at timestamptz not null default now(),
  constraint fiscal_invoices_number_unique unique (furs_environment, business_year, premise_id, device_id, invoice_number),
  constraint fiscal_invoices_credit_note_reference check (
    (kind = 'invoice' and reference_invoice_id is null and amount_cents > 0)
    or (kind = 'credit_note' and reference_invoice_id is not null and amount_cents < 0)
  )
);

-- One invoice per payment, whichever Stripe identifier the payment is known by.
create unique index if not exists fiscal_invoices_invoice_per_payment
  on public.fiscal_invoices (furs_environment, stripe_payment_intent_id)
  where kind = 'invoice' and stripe_payment_intent_id is not null;

create unique index if not exists fiscal_invoices_invoice_per_stripe_invoice
  on public.fiscal_invoices (furs_environment, stripe_invoice_id)
  where kind = 'invoice' and stripe_invoice_id is not null;

create unique index if not exists fiscal_invoices_invoice_per_checkout_session
  on public.fiscal_invoices (furs_environment, stripe_checkout_session_id)
  where kind = 'invoice' and stripe_checkout_session_id is not null;

create unique index if not exists fiscal_invoices_credit_note_per_refund
  on public.fiscal_invoices (furs_environment, stripe_refund_id)
  where kind = 'credit_note';

create index if not exists fiscal_invoices_pending
  on public.fiscal_invoices (furs_environment, last_attempt_at nulls first)
  where status = 'pending';

create table if not exists public.fiscal_invoice_messages (
  id bigint generated always as identity primary key,
  fiscal_invoice_id uuid references public.fiscal_invoices (id),
  message_kind text not null check (message_kind in ('invoice', 'business_premise')),
  message_id uuid not null,
  subsequent_submit boolean not null default false,
  request_token text not null,
  response_token text,
  response_status integer,
  error_code text,
  error_message text,
  eor text,
  sent_at timestamptz not null default now()
);

create index if not exists fiscal_invoice_messages_invoice
  on public.fiscal_invoice_messages (fiscal_invoice_id);

alter table public.fiscal_invoice_counters enable row level security;
alter table public.fiscal_invoices enable row level security;
alter table public.fiscal_invoice_messages enable row level security;

-- Takes the next number for (year, premise, device) and writes the invoice in one statement, so
-- two webhooks arriving together cannot share a number and a failed insert gives its number back.
-- A repeat for a payment or refund that already has its document returns that document unchanged
-- (Stripe redelivers webhooks), without taking a number.
create or replace function public.allocate_fiscal_invoice(
  p_furs_environment text,
  p_kind text,
  p_business_year integer,
  p_premise_id text,
  p_device_id text,
  p_issued_at timestamptz,
  p_amount_cents bigint,
  p_description text,
  p_operator_label text,
  p_tax_number integer,
  p_email_to text,
  p_user_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_invoice_id text,
  p_stripe_checkout_session_id text,
  p_stripe_refund_id text,
  p_reference_invoice_id uuid,
  p_special_notes text
)
returns public.fiscal_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.fiscal_invoices;
  next_number bigint;
  created public.fiscal_invoices;
begin
  if p_kind = 'invoice' then
    if p_stripe_payment_intent_id is null and p_stripe_invoice_id is null and p_stripe_checkout_session_id is null then
      raise exception 'A fiscal invoice needs the Stripe payment it settles, or a redelivery could invoice it twice.';
    end if;

    select * into existing from public.fiscal_invoices
      where kind = 'invoice' and furs_environment = p_furs_environment
        and (stripe_payment_intent_id = p_stripe_payment_intent_id
          or stripe_invoice_id = p_stripe_invoice_id
          or stripe_checkout_session_id = p_stripe_checkout_session_id)
      limit 1;
  else
    select * into existing from public.fiscal_invoices
      where kind = 'credit_note' and furs_environment = p_furs_environment
        and stripe_refund_id = p_stripe_refund_id;
  end if;

  if found then
    return existing;
  end if;

  insert into public.fiscal_invoice_counters (furs_environment, business_year, premise_id, device_id, last_number)
    values (p_furs_environment, p_business_year, p_premise_id, p_device_id, 1)
  on conflict (furs_environment, business_year, premise_id, device_id)
    do update set last_number = public.fiscal_invoice_counters.last_number + 1
  returning last_number into next_number;

  insert into public.fiscal_invoices (
    kind, furs_environment, business_year, premise_id, device_id, invoice_number, issued_at, amount_cents,
    description, operator_label, tax_number, email_to, user_id,
    stripe_payment_intent_id, stripe_invoice_id, stripe_checkout_session_id, stripe_refund_id,
    reference_invoice_id, special_notes
  ) values (
    p_kind, p_furs_environment, p_business_year, p_premise_id, p_device_id, next_number, p_issued_at, p_amount_cents,
    p_description, p_operator_label, p_tax_number, p_email_to, p_user_id,
    p_stripe_payment_intent_id, p_stripe_invoice_id, p_stripe_checkout_session_id, p_stripe_refund_id,
    p_reference_invoice_id, p_special_notes
  )
  returning * into created;

  return created;
end;
$$;

revoke all on function public.allocate_fiscal_invoice(
  text, text, integer, text, text, timestamptz, bigint, text, text, integer, text, uuid, text, text, text,
  text, uuid, text
) from public, anon, authenticated;
