import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const EBAY_API = process.env.EBAY_ENV !== "sandbox"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

const CONDITION_MAP = {
  nuovo: "NEW",
  ottimo: "LIKE_NEW",
  buono: "VERY_GOOD",
  discreto: "GOOD",
  usato: "ACCEPTABLE",
};

const CATEGORY_MAP = {
  donna: "15724",
  uomo: "1059",
  bambini: "171146",
  scarpe: "63889",
  borse: "169291",
  accessori: "14339",
};

async function getToken() {
  const cookieStore = cookies();
  const token = cookieStore.get("ebay_token")?.value;
  if (token) return token;

  const refresh = cookieStore.get("ebay_refresh")?.value;
  if (!refresh) return null;

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });

  const data = await res.json();
  return data.access_token || null;
}

export async function POST(request) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({
      success: false,
      error: "eBay non connesso. Vai su /api/ebay/auth per autorizzare.",
    });
  }

  const formData = await request.formData();
  const listing = JSON.parse(formData.get("listing"));
  const photoFiles = formData.getAll("photos");

  const sku = `LO-${Date.now()}`;

  const photoUrls = [];
  for (const file of photoFiles.slice(0, 8)) {
    try {
      const bytes = await file.arrayBuffer();
      const uploadRes = await fetch(`${EBAY_API}/sell/media/v1_beta/image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type || "image/jpeg",
          "Content-Language": "it-IT",
        },
        body: bytes,
      });
      const uploadData = await uploadRes.json();
      if (uploadData.imageUrl) photoUrls.push(uploadData.imageUrl);
    } catch {}
  }

  const inventoryRes = await fetch(`${EBAY_API}/sell/inventory/v1/inventory_item/${sku}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "it-IT",
    },
    body: JSON.stringify({
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
      condition: CONDITION_MAP[listing.condition] || "GOOD",
      product: {
        title: listing.title,
        description: listing.description || listing.title,
        brand: listing.brand || "Unbranded",
        imageUrls: photoUrls.length ? photoUrls : ["https://via.placeholder.com/400"],
        aspects: {
          Taglia: [listing.size || "M"],
          ...(listing.brand ? { Marca: [listing.brand] } : {}),
        },
      },
    }),
  });

  if (!inventoryRes.ok && inventoryRes.status !== 204) {
    const err = await inventoryRes.text();
    return NextResponse.json({ success: false, error: `Inventory error: ${err.substring(0, 200)}` });
  }

  const offerRes = await fetch(`${EBAY_API}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "it-IT",
    },
    body: JSON.stringify({
      sku,
      marketplaceId: "EBAY_IT",
      format: "FIXED_PRICE",
      pricingSummary: {
        price: { value: String(listing.price), currency: "EUR" },
      },
      categoryId: CATEGORY_MAP[listing.category] || "15724",
      listingDescription: listing.description || listing.title,
      listingPolicies: {
        fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || "",
        paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || "",
        returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || "",
      },
      merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION || "default",
    }),
  });

  const offerData = await offerRes.json();
  if (!offerData.offerId) {
    return NextResponse.json({ success: false, error: `Offer error: ${JSON.stringify(offerData).substring(0, 200)}` });
  }

  const publishRes = await fetch(`${EBAY_API}/sell/inventory/v1/offer/${offerData.offerId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  const publishData = await publishRes.json();
  const listingId = publishData.listingId;

  if (!listingId) {
    return NextResponse.json({ success: false, error: `Publish error: ${JSON.stringify(publishData).substring(0, 200)}` });
  }

  return NextResponse.json({
    success: true,
    listingId,
    url: `https://www.ebay.it/itm/${listingId}`,
  });
}
