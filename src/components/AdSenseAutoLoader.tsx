"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
const testMode = process.env.NEXT_PUBLIC_ADSENSE_TEST_MODE;

const AdSenseAutoLoader = () => {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!clientId) {
      console.error("AdSense auto ads skipped. Provide NEXT_PUBLIC_ADSENSE_CLIENT_ID to enable ads.");
      return;
    }

    window.adsbygoogle = window.adsbygoogle || [];

    const scriptId = "adsense-auto-loader";
    const existingScript = document.getElementById(scriptId);

    const initializeAds = () => {
      try {
        window.adsbygoogle?.push({});
      } catch (error) {
        console.error("AdSense auto ads initialization failed. Verify the client ID.", error);
      }
    };

    if (existingScript) {
      initializeAds();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    script.crossOrigin = "anonymous";
    if (testMode) {
      script.setAttribute("data-adtest", testMode);
    }

    script.addEventListener("load", initializeAds);
    script.addEventListener("error", () => {
      console.error("AdSense auto ads script failed to load. Check the client ID and network connectivity.");
    });

    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", initializeAds);
    };
  }, []);

  return null;
};

export default AdSenseAutoLoader;
