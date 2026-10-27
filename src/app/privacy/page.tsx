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
            read in the browser and sent, one at a time, to the backend so it can query the Modrinth API
            and, when needed, search results and AI classification.
          </p>
          <p>
            The server is stateless and keeps nothing: no accounts, no scan database, no files. Your mod
            list and your classification results live only in your browser&apos;s <code>localStorage</code>,
            which is also what lets a scan resume after a refresh. Resetting the workspace or clearing
            your browser data deletes them.
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
            We do not set tracking cookies. Browser-side storage holds your mod list, your classification
            results, and the API key (only when you opt in to remembering it), so scans remain resumable
            after refresh. Nothing about your scan is stored on the server.
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
