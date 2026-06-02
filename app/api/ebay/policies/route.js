import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const EBAY_API = process.env.EBAY_ENV !== "sandbox"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get("ebay_token")?.value
    || cookieStore.get("ebay_refresh")?.value;
  if (!token) return NextResponse.json({ error: "Non autorizzato" });

  const [f, p, r] = await Promise.all([
    fetch(`${EBAY_API}/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_IT`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json()),
    fetch(`${EBAY_API}/sell/account/v1/payment_policy?marketplace_id=EBAY_IT`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json()),
    fetch(`${EBAY_API}/sell/account/v1/return_policy?marketplace_id=EBAY_IT`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json()),
  ]);

  return NextResponse.json({
    fulfillment: f.fulfillmentPolicies?.map(p => ({ id: p.fulfillmentPolicyId, name: p.name })) ?? f,
    payment: p.paymentPolicies?.map(p => ({ id: p.paymentPolicyId, name: p.name })) ?? p,
    return: r.returnPolicies?.map(p => ({ id: p.returnPolicyId, name: p.name })) ?? r,
  });
}
