import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("Apple ledger rejects duplicate ownership and stale events cannot undo a renewal or refund", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
      INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');`);
    await db.exec(readFileSync(new URL("../supabase/migrations/0024_mobile_app_store_entitlements.sql", import.meta.url), "utf8"));
    await db.exec(`INSERT INTO mobile_app_store_entitlements
      (user_id, product_id, transaction_id, original_transaction_id, purchased_at, expires_at, signed_transaction_jws, raw_payload)
      VALUES ('00000000-0000-4000-8000-000000000001', 'eu.memoai.premium.monthly', '2', '1', '2026-09-01', '2026-10-01', 'fixture', '{"signedDate":200}');`);
    await assert.rejects(db.exec(`INSERT INTO mobile_app_store_entitlements
      (user_id,product_id,transaction_id,original_transaction_id,signed_transaction_jws)
      VALUES ('00000000-0000-4000-8000-000000000002','eu.memoai.premium.monthly','3','1','fixture');`), /unique/);

    // Same predicate as the PostgREST update, evaluated by PostgreSQL.
    const update = async (purchase, signed, status) => db.query(`UPDATE mobile_app_store_entitlements
      SET status=$3, purchased_at=$1, raw_payload=jsonb_build_object('signedDate',$2::bigint)
      WHERE original_transaction_id='1' AND product_id='eu.memoai.premium.monthly'
      AND (purchased_at < $1::timestamptz OR (purchased_at=$1::timestamptz AND raw_payload->'signedDate' <= to_jsonb($2::bigint))) RETURNING status`, [purchase, signed, status]);
    assert.equal((await update("2026-08-01", 300, "expired")).rows.length, 0);
    assert.equal((await update("2026-09-01", 199, "revoked")).rows.length, 0);
    assert.equal((await update("2026-09-01", 201, "revoked")).rows[0].status, "revoked");
    assert.equal((await update("2026-09-01", 200, "active")).rows.length, 0);
    assert.equal((await update("2026-10-01", 300, "active")).rows[0].status, "active");
    await db.exec("DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000001'");
    assert.equal((await db.query("SELECT * FROM mobile_app_store_entitlements")).rows.length, 0);
  } finally { await db.close(); }
});
