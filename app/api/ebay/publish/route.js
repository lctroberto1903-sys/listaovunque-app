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

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

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

async function fetchFirstPolicy(token, type) {
  const res = await fetch(`${EBAY_API}/sell/account/v1/${type}_policy?marketplace_id=EBAY_IT`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const key = `${type}Policies`;
  return data[key]?.[0]?.[`${type}PolicyId`] || null;
}

async function ensureMerchantLocation(token) {
  const listRes = await fetch(`${EBAY_API}/sell/inventory/v1/location`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  if (listData.locations?.length > 0) {
    return listData.locations[0].merchantLocationKey;
  }

  await fetch(`${EBAY_API}/sell/inventory/v1/location/default`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "it-IT",
    },
    body: JSON.stringify({
      location: { address: { country: "IT" } },
      locationTypes: ["WAREHOUSE"],
      name: "Sede principale",
      merchantLocationStatus: "ENABLED",
    }),
  });
  return "default";
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

  // Recupera policies e location automaticamente
  const [fulfillmentId, paymentId, returnId, locationKey] = await Promise.all([
    fetchFirstPolicy(token, "fulfillment"),
    fetchFirstPolicy(token, "payment"),
    fetchFirstPolicy(token, "return"),
    ensureMerchantLocation(token),
  ]);

  if (!fulfillmentId || !paymentId || !returnId) {
    return NextResponse.json({
      success: false,
      error: "Il tuo account eBay non ha le business policies configurate. Vai su ebay.it → Account → Business policies e crea una policy di spedizione, pagamento e resi.",
    });
  }

  const sku = `LO-${Date.now()}`;

  // Upload foto
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

  // Crea inventory item
  const inventoryRes = await fetch(`${EBAY_API}/sell/inventory/v1/inventory_item/${sku}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "it-IT",
    },
    body: JSON.stringify({
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: CONDITION_MAP[listing.condition] || "GOOD",
      product: {
        title: listing.title,
        description: listing.description || listing.title,
        brand: listing.brand || "Unbranded",
        imageUrls: photoUrls.length ? photoUrls : [],
        aspects: {
          Taglia: [listing.size || "M"],
          ...(listing.brand ? { Marca: [listing.brand] } : {}),
        },
      },
    }),
  });

  if (!inventoryRes.ok && inventoryRes.status !== 204) {
    const err = await inventoryRes.text();
    return NextResponse.json({ success: false, error: `Inventory error: ${err.substring(0, 300)}` });
  }

  // Crea offerta
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
        fulfillmentPolicyId: fulfillmentId,
        paymentPolicyId: paymentId,
        returnPolicyId: returnId,
      },
      merchantLocationKey: locationKey,
    }),
  });

  const offerData = await offerRes.json();
  if (!offerData.offerId) {
    return NextResponse.json({
      success: false,
      error: `Offer error: ${JSON.stringify(offerData).substring(0, 300)}`,
    });
  }

  // Pubblica offerta
  const publishRes = await fetch(
    `${EBAY_API}/sell/inventory/v1/offer/${offerData.offerId}/publish`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    }
  );

  const publishData = await publishRes.json();
  if (!publishData.listingId) {
    return NextResponse.json({
      success: false,
      error: `Publish error: ${JSON.stringify(publishData).substring(0, 300)}`,
    });
  }

  return NextResponse.json({
    success: true,
    listingId: publishData.listingId,
    url: `https://www.ebay.it/itm/${publishData.listingId}`,
  });
}
