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
        <p className="is-size-6 has-text-grey-light">
          Last updated on {new Date().toLocaleDateString()}
        </p>

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
            hosting server to guarantee resumability. These state files never include the actual mod JARs and
            can be deleted at any time from <code>storage/sessions/&lt;session-id&gt;</code>.
          </p>
        </section>

        <section className="box mt-5">
          <h2 className="title is-5">OpenAI API Keys</h2>
          <p>
            Your OpenAI API key is required to mirror the original classification workflow. You may choose to
            keep the key stored in your browser&apos;s <code>localStorage</code> for quicker re-use or disable
            storage entirely. The key is forwarded to OpenAI only for the classification prompts described in the
            documentation and is never persisted on our servers or logs.
          </p>
        </section>

        <section className="box mt-5">
          <h2 className="title is-5">Third-Party Services</h2>
          <p>
            The scanner relies on DuckDuckGo search results and OpenAI models to analyse publicly available
            information about each mod. Optional AdSense auto ads load only when a verified
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
