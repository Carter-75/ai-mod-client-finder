import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Fabric Mod Client Detector",
  description:
    "Learn how the Fabric Mod Client Detector handles data, API keys, and browsing during classification.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="section">
      <div className="container content">
        <h1 className="title is-3 has-text-white">Privacy Policy</h1>
        <p className="is-size-6 has-text-grey-light">Last updated: October 2026</p>

        <section className="box mt-5">
          <h2 className="title is-5">Data We Collect</h2>
          <p>
            The Fabric Mod Client Detector does not collect, store, or transmit your Minecraft mods or
            world data. When you supply a mods folder, only the file names of <code>.jar</code> files are
            read in the browser and sent to the backend so that the automated scanner can query public
            search engines and request AI classifications.
          </p>
          <p>
            We generate intermediate state files (classification results, logs, and progress markers) on the
            hosting server so a scan can resume after a refresh. These state files never include the actual
            mod JARs. On the hosted deployment they live in temporary server storage and can be cleared when
            the hosting instance recycles, so a resumed session is best effort, not a permanent archive.
          </p>
        </section>

        <section className="box mt-5">
          <h2 className="title is-5">OpenAI API Keys</h2>
          <p>
            An OpenAI API key is optional. Mods are classified from Modrinth&apos;s published client and
            server side data first; a key is used only to classify the mods Modrinth cannot settle. You may
            choose to keep the key stored in your browser&apos;s <code>localStorage</code> for quicker
            re-use or disable storage entirely. The key is forwarded to OpenAI only for those fallback
            classification prompts and is never persisted on our servers or logs.
          </p>
        </section>

        <section className="box mt-5">
          <h2 className="title is-5">Third-Party Services</h2>
          <p>
            The scanner sends each mod file name to the Modrinth API, which publishes the client and server
            requirements for most Fabric mods. For mods Modrinth cannot settle, it falls back to Bing search
            results analysed by OpenAI models, when an API key is available. Optional AdSense auto ads load
            only when a verified
            <code className="mx-1">NEXT_PUBLIC_ADSENSE_CLIENT_ID</code> is configured; when disabled, no AdSense
            scripts are requested.
          </p>
        </section>

        <section className="box mt-5">
          <h2 className="title is-5">Cookies &amp; Storage</h2>
          <p>
            We do not set tracking cookies. Session state lives on the server in isolated directories that can be
            removed once you finish migrating your world. Browser-side storage is limited to the API key (when
            you opt in) and a session identifier so that scans remain resumable after refresh.
          </p>
        </section>

        <section className="box mt-5">
          <h2 className="title is-5">Contact</h2>
          <p>
            Questions about privacy or data handling? Reach out via the project repository or open an issue on our
            <Link className="ml-1" href="https://github.com/Carter-75/ai-mod-client-finder">GitHub project</Link>.
          </p>
        </section>

        <p className="mt-6">
          Return to the <Link href="/">scanner</Link> to continue your migration checklist.
        </p>
      </div>
    </main>
  );
}
