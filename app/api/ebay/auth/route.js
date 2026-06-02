import { redirect } from "next/navigation";

export async function GET() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const ruName = process.env.EBAY_RUNAME;
  const isProd = process.env.EBAY_ENV !== "sandbox";

  const baseUrl = isProd
    ? "https://auth.ebay.com/oauth2/authorize"
    : "https://auth.sandbox.ebay.com/oauth2/authorize";

  const scopes = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  ].join(" ");

  const url = `${baseUrl}?client_id=${clientId}&redirect_uri=${ruName}&response_type=code&scope=${encodeURIComponent(scopes)}`;
  redirect(url);
}
