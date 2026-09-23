import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
import { PromotionalOfferSignatureCreator } from "@apple/app-store-server-library";
import { APPLE_CODE_OFFERS, acceptsAppleHalfOffCode } from "../src/lib/mobile/promotion-policy.ts";

const validPromotion = () => ({ code: "MEMO50", active: true, customer: null, customer_account: null,
  expires_at: null, max_redemptions: null, restrictions: { first_time_transaction: false, minimum_amount: null },
  promotion: { type: "coupon", coupon: "memo50-first-cycle" } });
const validCoupon = () => ({ id: "memo50-first-cycle", valid: true, percent_off: 50, amount_off: null,
  duration: "once", redeem_by: null, max_redemptions: null, applies_to: { products: ["memo-premium"] } });

test("case-insensitive half-off codes preserve their exact web campaign terms", () => {
  assert.equal(acceptsAppleHalfOffCode(" memo50 ", validPromotion(), validCoupon(), "memo-premium", 100), true);
  for (const patch of [{active:false},{code:"OTHER"},{customer:"customer"},{customer_account:"account"},
    {max_redemptions:10},{expires_at:100},{restrictions:{first_time_transaction:true}}, {restrictions:{minimum_amount:1000}}]) {
    assert.equal(acceptsAppleHalfOffCode("MEMO50", {...validPromotion(),...patch}, validCoupon(), "memo-premium", 100), false);
  }
  for (const patch of [{id:"another-campaign"},{valid:false},{percent_off:10},{amount_off:999}, {duration:"forever"},
    {duration:"repeating"},{redeem_by:100},{max_redemptions:100},{applies_to:{products:["other-product"]}}]) {
    assert.equal(acceptsAppleHalfOffCode("MEMO50", validPromotion(), {...validCoupon(),...patch}, "memo-premium", 100), false);
  }
});

const userID = "00000000-0000-4000-8000-000000000001";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signingKey = privateKey.export({type:"pkcs8",format:"pem"});

function harness(options = {}) {
  const calls = [];
  class NextResponse extends Response { static json(data, init) { return new NextResponse(JSON.stringify(data),init); } }
  const historyQuery = { select() {return this;}, eq: (key,value) => { calls.push([key,value]); return historyQuery; },
    in: (key,value) => { calls.push([key,value]); return historyQuery; }, limit: async () => ({data: options.history ? [{original_transaction_id:"verified-past-purchase"}] : [], error:options.historyError}) };
  const modules = {
    "node:crypto":crypto, "@apple/app-store-server-library":{PromotionalOfferSignatureCreator}, "next/server":{NextResponse}, zod:{z},
    "@/lib/mobile/promotion-policy":{APPLE_CODE_OFFERS,acceptsAppleHalfOffCode},
    "@/lib/mobile/account-lifecycle": {accountDeletionRequested:()=>!!options.deleting},
    "@/lib/mobile/apple":{appleBillingConfigured:()=>!options.disabled,appleAccountEnvironments:()=>["sandbox"]},
    "@/lib/i18n/server":{tr:async key=>key},
    "@/lib/rate-limit":{rateLimitPresets:{mutate:[]}, enforceRateLimit:async()=>options.limited?new Response(null,{status:429}):null},
    "@/lib/request-validation":{parseJsonRequest:async(request,schema)=>{
      const result=schema.safeParse(await request.json());
      return result.success?{success:true,data:result.data}:{success:false,response:NextResponse.json({}, {status:400})};
    }},
    "@/lib/supabase/server":{
      createSupabaseServiceRoleClient:()=>({from:table=>{calls.push(["table",table]);return historyQuery;}}),
      createSupabaseRouteHandlerClient:async()=>({applyCookies:r=>r,supabase:{auth:{getUser:async()=>({data:{user:options.unauthenticated?null:{id:userID}}})}}}),
    },
    "@/lib/billing":{
      getUserEntitlementState:async()=>({hasPaidAccess:!!options.paid}), getPriceIdForPlan:p=>p,
    },
    "@/lib/mobile/promotion-catalogue":{
      applePromotionCatalogue:()=>({
        promotionCodes:{list:async({code})=>{calls.push(["code",code]);return {has_more:!!options.truncated,data:options.missing?[]:[{...validPromotion(),...options.promotion}]};}},
        coupons:{retrieve:async()=>({...validCoupon(),...options.coupon})},
        prices:{retrieve:async()=>({product:"memo-premium"})},
      }),
    },
  };
  const context = {exports:{},require:name=>{assert.ok(name in modules,name);return modules[name];},Date,process:{env:{
    APPLE_IAP_KEY_ID:"TESTKEY123",APPLE_IAP_PRIVATE_KEY:signingKey,APPLE_BUNDLE_ID:"eu.memoai.memo",
  }}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/api/mobile/promotions/route.ts",import.meta.url),"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {calls,post:body=>context.exports.POST(new Request("https://memoai.eu/api/mobile/promotions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body??{code:"MEMO50"})}))};
}

test("new users get introductory selection without a promotional signature", async () => {
  const h=harness();const r=await h.post();assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");
  const b=await r.json();assert.equal(b.mode,"introductory");assert.equal(b.userId,userID);assert.equal(b.signature,undefined);
  assert.ok(h.calls.some(([k,v])=>k==="user_id"&&v===userID));
  assert.deepEqual(h.calls.find(([k])=>k==="environment")[1],["sandbox"]);
});

test("returning-user signatures bind the verified account, product and Apple offer", async () => {
  const h=harness({history:true});const productId="eu.memoai.premium.yearly";
  const r=await h.post({code:"memo50",productId});assert.equal(r.status,200);
  const b=await r.json();assert.equal(b.mode,"promotional");assert.equal(b.signature.offerId,"memo_code_half_year");
  const signature = b.signature;
  const payload = (account=userID, product=productId, offer=signature.offerId) =>
    ["eu.memoai.memo",signature.keyId,product,offer,account,signature.nonce,signature.timestamp].join("\u2063");
  const verifies = p => crypto.verify("sha256",Buffer.from(p),publicKey,Buffer.from(signature.signature,"base64"));
  assert.equal(verifies(payload()),true);
  assert.equal(verifies(payload("00000000-0000-4000-8000-000000000002")),false);
  assert.equal(verifies(payload(userID,"eu.memoai.premium.monthly")),false);
  assert.equal(verifies(payload(userID,productId,"other-offer")),false);
  const second=await (await h.post({code:"MEMO50",productId})).json();
  assert.notEqual(second.signature.nonce,signature.nonce);
});

test("unauthenticated, deleting, active, rate-limited and disabled accounts cannot obtain offers", async () => {
  for (const [options,status] of [[{unauthenticated:true},401],[{deleting:true},401],[{paid:true},409],[{limited:true},429],[{disabled:true},503]]) {
    const h=harness(options);const r=await h.post({code:"MEMO50",productId:"eu.memoai.premium.yearly"});
    assert.equal(r.status,status);assert.equal(h.calls.some(([k])=>k==="code"),false);
    assert.equal((await r.text()).includes('"signature"'),false);
  }
});

test("checkout revalidates changed terms, missing codes and unavailable history", async () => {
  for (const [options,status] of [[{missing:true},422],[{truncated:true},422],[{coupon:{duration:"forever"}},422],
    [{promotion:{max_redemptions:10}},422],[{historyError:{message:"private database error"}},503]]) {
    const h=harness({history:true,...options});const r=await h.post({code:"MEMO50",productId:"eu.memoai.premium.yearly"});
    assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/signature|private database/);
  }
});

test("clients cannot choose a signing identity, unsupported product or arbitrary offer", async () => {
  for (const body of [{code:"MEMO50",userId:"someone"},{code:"MEMO50",offerId:"arbitrary"},
    {code:"MEMO50",productId:"eu.memoai.premium.trial.yearly"},{code:"x".repeat(65)},{code:" "}]) {
    const h=harness({history:true});assert.equal((await h.post(body)).status,400);assert.equal(h.calls.length,0);
  }
});
