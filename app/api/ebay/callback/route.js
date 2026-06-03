import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?ebay_error=no_code", request.url));
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  const isProd = process.env.EBAY_ENV !== "sandbox";

  const tokenUrl = isProd
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    }),
  });

  const data = await res.json();

  if (!data.access_token) {
    return NextResponse.redirect(new URL("/?ebay_error=token_failed", request.url));
  }

  const response = NextResponse.redirect(new URL("/?ebay_connected=1", request.url));

  // Cookie httpOnly per sicurezza server-side
  response.cookies.set("ebay_token", data.access_token, {
    httpOnly: true, secure: true, maxAge: data.expires_in || 7200, path: "/", sameSite: "lax",
  });
  if (data.refresh_token) {
    response.cookies.set("ebay_refresh", data.refresh_token, {
      httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 180, path: "/", sameSite: "lax",
    });
  }

  // Cookie leggibile dal client JS (per fallback)
  response.cookies.set("ebay_token_js", data.access_token, {
    httpOnly: false, secure: true, maxAge: data.expires_in || 7200, path: "/", sameSite: "lax",
  });
  if (data.refresh_token) {
    response.cookies.set("ebay_refresh_js", data.refresh_token, {
      httpOnly: false, secure: true, maxAge: 60 * 60 * 24 * 180, path: "/", sameSite: "lax",
    });
  }

  return response;
}
