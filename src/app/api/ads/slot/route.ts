import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const token = process.env.AD_PROVIDER_KEY;
  if (!token) {
    return NextResponse.json({ enabled: false });
  }

  // Placeholder ad descriptor. Real integrations would fetch from provider using the token.
  return NextResponse.json({
    enabled: true,
    html: `<div class="box has-text-centered">
      <p class="has-text-weight-semibold">Sponsored Tools</p>
      <p class="is-size-7">Verified Minecraft hosting platforms curated for Fabric.</p>
      <a class="button is-small is-link mt-2" href="https://www.minecraft.net/en-us/download/server" target="_blank" rel="noreferrer">Explore Hosts</a>
    </div>`,
  });
}
