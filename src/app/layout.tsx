import "./globals.css";

import Link from "next/link";
import type { Metadata } from "next";
import dynamic from "next/dynamic";

const AdSenseAutoLoader = dynamic(() => import("@/components/AdSenseAutoLoader"), { ssr: false });

export const metadata: Metadata = {
  title: "Fabric Mod Client Detector",
  description: "Identify Minecraft Fabric client-only mods before migrating to a server.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const year = new Date().getFullYear();
  return (
    <html lang="en">
      <body>
        <AdSenseAutoLoader />
        {children}
        <footer className="site-footer">
          <div className="container is-flex is-justify-content-space-between is-align-items-center is-flex-wrap-wrap">
            <span className="is-size-7">© {year} Fabric Mod Client Detector</span>
            <nav className="footer-links">
              <Link className="is-size-7" href="/privacy">
                Privacy Policy
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}


