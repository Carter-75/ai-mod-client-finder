import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const allowedIframeHosts = [
  "https://carter-portfolio.fyi",
  "https://www.carter-portfolio.fyi",
  "https://carter-portfolio.vercel.app",
  "https://*.vercel.app",
  "http://localhost:3000",
];

/**
 * Aligns iframe headers with the portfolio embed requirements. Do not relax these values.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Build frame-ancestors directive
  const frameAncestors = ["'self'", ...allowedIframeHosts.filter((host) => !host.startsWith("https://*"))];
  frameAncestors.push("https://*.vercel.app");

  response.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors.join(" ")};`);
  // No X-Frame-Options header: the previous ALLOWALL value is not a valid
  // X-Frame-Options directive, and CSP frame-ancestors above is the
  // supported control for the portfolio embed.
  response.headers.set("Referrer-Policy", "origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
