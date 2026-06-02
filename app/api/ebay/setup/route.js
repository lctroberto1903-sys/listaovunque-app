import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const EBAY_API = process.env.EBAY_ENV !== "sandbox"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

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

async function createPolicy(token, type, body) {
  const res = await fetch(`${EBAY_API}/sell/account/v1/${type}_policy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "it-IT",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function hasPolicy(token, type) {
  const res = await fetch(`${EBAY_API}/sell/account/v1/${type}_policy?marketplace_id=EBAY_IT`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return (data[`${type}Policies`]?.length ?? 0) > 0;
}

export async function GET() {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ success: false, error: "eBay non autorizzato. Vai su /api/ebay/auth prima." });
  }

  const results = {};

  // Fulfillment policy — prova tutti i codici spedizione italiani noti
  if (!(await hasPolicy(token, "fulfillment"))) {
    const IT_CODES = [
      "IT_PosteItaliane",
      "IT_BRT",
      "IT_GLS",
      "IT_SDAExpressCourier",
      "IT_TNT",
      "IT_DHL",
      "IT_UPS",
      "IT_Nacex",
      "IT_StandardShipping",
      "IT_OtherShipping",
      "IT_Freight",
    ];

    let created = false;
    let lastError = "";
    for (const code of IT_CODES) {
      const data = await createPolicy(token, "fulfillment", {
        name: `Spedizione IT`,
        marketplaceId: "EBAY_IT",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        handlingTime: { value: 3, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                sortOrder: 1,
                shippingServiceCode: code,
                shippingCost: { value: "5.00", currency: "EUR" },
                buyerResponsibleForShipping: false,
              },
            ],
          },
        ],
      });
      if (data.fulfillmentPolicyId) {
        results.fulfillment = `✅ creata (${code})`;
        created = true;
        break;
      }
      lastError = code;
    }
    if (!created) {
      results.fulfillment = `❌ Nessun codice valido trovato. Ultimo tentato: ${lastError}`;
    }
  } else {
    results.fulfillment = "✅ già esistente";
  }

  // Payment policy — eBay managed payments: nessun metodo da specificare
  if (!(await hasPolicy(token, "payment"))) {
    const data = await createPolicy(token, "payment", {
      name: "Pagamento Standard IT",
      marketplaceId: "EBAY_IT",
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      immediatePay: true,
    });
    results.payment = data.paymentPolicyId ? "✅ creata" : `❌ ${JSON.stringify(data).substring(0, 150)}`;
  } else {
    results.payment = "✅ già esistente";
  }

  // Return policy
  if (!(await hasPolicy(token, "return"))) {
    const data = await createPolicy(token, "return", {
      name: "Resi 30 giorni IT",
      marketplaceId: "EBAY_IT",
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "SELLER",
      refundMethod: "MONEY_BACK",
    });
    results.return = data.returnPolicyId ? "✅ creata" : `❌ ${JSON.stringify(data).substring(0, 100)}`;
  } else {
    results.return = "✅ già esistente";
  }

  // Merchant location
  const locRes = await fetch(`${EBAY_API}/sell/inventory/v1/location`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const locData = await locRes.json();
  if (!locData.locations?.length) {
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
    results.location = "✅ creata";
  } else {
    results.location = "✅ già esistente";
  }

  return NextResponse.json({ success: true, results });
}
