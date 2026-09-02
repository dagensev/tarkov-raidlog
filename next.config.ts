import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Static export.
   *
   * Everything the app does happens in the browser -- logs are parsed locally, tarkov.dev
   * is fetched client-side -- so there is nothing to server-render. Exporting means the UI
   * ships as static assets, which Cloudflare serves free and unlimited without invoking a
   * Worker, sidestepping the 10 ms CPU cap on the Workers free plan. Only /api/* runs code.
   */
  output: "export",

  // Emit `/tasks/index.html` rather than `/tasks.html`, which is what static hosts
  // resolve cleanly for directory-style URLs.
  trailingSlash: true,

  images: { unoptimized: true },
};

export default nextConfig;
