import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const EBAY_API = process.env.EBAY_ENV !== "sandbox"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

const CONDITION_MAP = {
  nuovo: "NEW",
  ottimo: "USED_EXCELLENT",
  buono: "USED_VERY_GOOD",
  discreto: "USED_GOOD",
  usato: "USED_ACCEPTABLE",
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
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  const data = await res.json();
  return data.access_token || null;
}

async function fetchFirstPolicy(token, type) {
  const res = await fetch(
    `${EBAY_API}/sell/account/v1/${type}_policy?marketplace_id=EBAY_IT`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const key = `${type}Policies`;
  return data[key]?.[0]?.[`${type}PolicyId`] || null;
}

async function ensureMerchantLocation(token) {
  const res = await fetch(`${EBAY_API}/sell/inventory/v1/location`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.locations?.length > 0) return data.locations[0].merchantLocationKey;
  await fetch(`${EBAY_API}/sell/inventory/v1/location/default`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
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
  const formData = await request.formData();
  const listing = JSON.parse(formData.get("listing"));
  const photoFiles = formData.getAll("photos");

  // Prova cookie server-side, poi fallback su token inviato dal client
  let token = await getToken();
  if (!token) {
    const clientToken = formData.get("ebay_token");
    const clientRefresh = formData.get("ebay_refresh");
    if (clientToken) {
      token = clientToken;
    } else if (clientRefresh) {
      const credentials = Buffer.from(
        `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
      ).toString("base64");
      const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: clientRefresh }),
      });
      const data = await res.json();
      token = data.access_token || null;
    }
  }

  if (!token) {
    return NextResponse.json({
      success: false,
      error: "eBay non connesso. Vai su /api/ebay/auth per autorizzare.",
    });
  }

  // Recupera policies e location
  const [fulfillmentId, paymentId, returnId, locationKey] = await Promise.all([
    fetchFirstPolicy(token, "fulfillment"),
    fetchFirstPolicy(token, "payment"),
    fetchFirstPolicy(token, "return"),
    ensureMerchantLocation(token),
  ]);

  if (photoFiles.length === 0) {
    return NextResponse.json({
      success: false,
      error: "eBay richiede almeno una foto. Aggiungila prima di pubblicare.",
    });
  }

  if (!fulfillmentId) {
    return NextResponse.json({
      success: false,
      error: 'Policy di spedizione mancante. Vai su <a href="/api/ebay/setup" target="_blank">/api/ebay/setup</a> per crearla.',
    });
  }
  if (!paymentId || !returnId) {
    return NextResponse.json({
      success: false,
      error: `Policy mancante: ${!paymentId ? "pagamento" : "resi"}. Vai su /api/ebay/setup.`,
    });
  }

  // Upload foto tramite Trading API UploadSiteHostedPictures
  const photoUrls = [];
  const photoErrors = [];
  for (const file of photoFiles.slice(0, 8)) {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <PictureSet>Standard</PictureSet>
</UploadSiteHostedPicturesRequest>`;

      const fd = new FormData();
      const bytes = await file.arrayBuffer();
      fd.append("XML Payload", new Blob([xml], { type: "text/xml" }), "request.xml");
      fd.append("Image1", new Blob([bytes], { type: file.type || "image/jpeg" }), "image.jpg");

      const uploadRes = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
          "X-EBAY-API-SITEID": "101",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-IAF-TOKEN": token,
        },
        body: fd,
      });

      const text = await uploadRes.text();
      const urlMatch = text.match(/<FullURL>(.*?)<\/FullURL>/);
      if (urlMatch?.[1]) {
        photoUrls.push(urlMatch[1]);
      } else {
        photoErrors.push(`Upload: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      photoErrors.push(e.message);
    }
  }

  if (photoUrls.length === 0 && photoFiles.length > 0) {
    return NextResponse.json({
      success: false,
      error: `Upload foto fallito: ${photoErrors[0] || "errore sconosciuto"}`,
    });
  }

  const sku = `LO-${Date.now()}`;

  // Crea inventory item
  const inventoryRes = await fetch(
    `${EBAY_API}/sell/inventory/v1/inventory_item/${sku}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
        "Content-Language": "en-US",
      },
      body: JSON.stringify({
        availability: { shipToLocationAvailability: { quantity: 1 } },
        condition: CONDITION_MAP[listing.condition] || "USED_GOOD",
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
    }
  );

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
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
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

  // Pubblica
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
