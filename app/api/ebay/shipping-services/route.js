import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get("ebay_token")?.value
    || cookieStore.get("ebay_refresh")?.value;

  if (!token) return NextResponse.json({ error: "Non autorizzato" });

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <DetailName>ShippingServiceDetails</DetailName>
</GeteBayDetailsRequest>`;

  const res = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GeteBayDetails",
      "X-EBAY-API-SITEID": "101",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    },
    body: xml,
  });

  const text = await res.text();
  const matches = [...text.matchAll(/<ShippingService>(.*?)<\/ShippingService>/g)];
  const services = matches.map((m) => m[1]);
  return NextResponse.json({ services });
}
