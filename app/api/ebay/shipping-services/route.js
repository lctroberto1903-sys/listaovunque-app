import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const EBAY_API = process.env.EBAY_ENV !== "sandbox"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get("ebay_token")?.value
    || cookieStore.get("ebay_refresh")?.value;

  if (!token) {
    return NextResponse.json({ error: "Non autorizzato" });
  }

  const res = await fetch(
    `${EBAY_API}/sell/metadata/v1/marketplace/EBAY_IT/shipping_service`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const domestic = (data.shippingServices || [])
    .filter((s) => s.shippingType === "DOMESTIC")
    .map((s) => ({ code: s.shippingServiceCode, carrier: s.shippingCarrier }));

  return NextResponse.json({ domestic, raw: data.shippingServices?.slice(0, 5) });
}
