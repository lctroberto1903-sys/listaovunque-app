import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get("ebay_token");
  const refresh = cookieStore.get("ebay_refresh");
  const allCookies = cookieStore.getAll().map(c => c.name);

  return NextResponse.json({
    ebay_token: token ? `presente (${token.value.substring(0, 20)}...)` : "assente",
    ebay_refresh: refresh ? `presente (${refresh.value.substring(0, 20)}...)` : "assente",
    all_cookies: allCookies,
  });
}
