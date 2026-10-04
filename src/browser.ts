// The browser surface the monitor needs.
//
// It is a subset of the X reply engine's XBrowser in nextbrowser-app
// (src/lib/xreply/browser.ts), so the app can hand the monitor the same
// nextctl-backed browser it already builds for a prepared profile. Outside the
// app, src/node/nbc.ts implements it over the nbc CLI.
//
// TikTok is read two ways from a tiktok.com tab of the profile. A creator's
// page is opened and read as tiktok.com drew it, because a profile page is the
// one flow the site serves to any browser without asking for anything else.
// The rest — the home page that names the signed-in account, a video's page,
// a video's comment list — is fetched from that tab with the profile's
// cookies. Nothing is clicked, typed or scrolled.
//
// Nothing here may depend on Node: the app runs its engines in the renderer.

export interface MonitorBrowser {
  /** Navigate the active tab. */
  open(url: string): Promise<void>;
  /** Evaluate one expression on the active page and return its value. The
   *  expression may be a promise: nbc evaluates with awaitPromise. The label
   *  names the read in logs and lets test fakes route by it. */
  evaluate<T>(script: string, label?: string): Promise<T>;
  /** Wait until the active page finishes loading. */
  waitForLoad(timeoutSeconds?: number): Promise<void>;
}
