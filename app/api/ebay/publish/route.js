import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const EBAY_API = process.env.EBAY_ENV !== "sandbox"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

const CONDITION_MAP = {
  nuovo: 1000,
  ottimo: 2750,
  buono: 3000,
  discreto: 5000,
  usato: 6000,
};

const CATEGORY_MAP = {
  donna: "15724",
  uomo: "1059",
  bambini: "171146",
  scarpe: "63889",
  borse: "169291",
  accessori: "14339",
};

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

async function uploadPhoto(token, file) {
  try {
    const bytes = await file.arrayBuffer();
    const res = await fetch(`${EBAY_API}/sell/media/v1_beta/image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "image/jpeg",
        "Content-Language": "it-IT",
      },
      body: bytes,
    });
    const data = await res.json();
    return data.imageUrl || null;
  } catch {
    return null;
  }
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

  // Upload foto tramite Sell Media API
  const photoUrls = [];
  for (const file of photoFiles.slice(0, 8)) {
    const url = await uploadPhoto(token, file);
    if (url) photoUrls.push(url);
  }

  const picturesXml = photoUrls.length
    ? `<PictureDetails>${photoUrls.map((u) => `<PictureURL>${escapeXml(u)}</PictureURL>`).join("")}</PictureDetails>`
    : "";

  const brandXml = listing.brand
    ? `<NameValueList><Name>Marca</Name><Value>${escapeXml(listing.brand)}</Value></NameValueList>`
    : "";

  // Trading API AddItem — non richiede policy pre-create
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${escapeXml(listing.title.substring(0, 80))}</Title>
    <Description><![CDATA[${listing.description || listing.title}]]></Description>
    <PrimaryCategory>
      <CategoryID>${CATEGORY_MAP[listing.category] || "15724"}</CategoryID>
    </PrimaryCategory>
    <StartPrice>${parseFloat(listing.price).toFixed(2)}</StartPrice>
    <Country>IT</Country>
    <Currency>EUR</Currency>
    <ListingDuration>Days_30</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Quantity>1</Quantity>
    <ConditionID>${CONDITION_MAP[listing.condition] || 3000}</ConditionID>
    ${picturesXml}
    <ItemSpecifics>
      <NameValueList>
        <Name>Taglia</Name>
        <Value>${escapeXml(listing.size || "M")}</Value>
      </NameValueList>
      ${brandXml}
    </ItemSpecifics>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>IT_Other</ShippingService>
        <ShippingServiceCost currencyID="EUR">5.0</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Seller</ShippingCostPaidByOption>
    </ReturnPolicy>
    <DispatchTimeMax>3</DispatchTimeMax>
    <Location>Italia</Location>
    <Site>Italy</Site>
  </Item>
</AddItemRequest>`;

  const tradingRes = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "AddItem",
      "X-EBAY-API-SITEID": "101",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    },
    body: xml,
  });

  const responseText = await tradingRes.text();

  const itemIdMatch = responseText.match(/<ItemID>(\d+)<\/ItemID>/);
  if (itemIdMatch) {
    return NextResponse.json({
      success: true,
      listingId: itemIdMatch[1],
      url: `https://www.ebay.it/itm/${itemIdMatch[1]}`,
    });
  }

  const errorMatch = responseText.match(/<LongMessage>(.*?)<\/LongMessage>/s);
  const errorMsg = errorMatch?.[1] || responseText.substring(0, 400);
  return NextResponse.json({ success: false, error: errorMsg });
}
