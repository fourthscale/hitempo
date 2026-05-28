import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    // Next.js 16 caps the request body the middleware / proxy layer can read
    // at 10 MB by default. Our Supabase auth middleware runs on every request
    // including Server Action calls, so without bumping this it truncates
    // outbound Gmail PDF uploads (sprint 10.5) before our action ever sees
    // them. Matches the Server Action cap below.
    //
    // The error message in dev still mentions the deprecated name
    // `middlewareClientMaxBodySize` ; the public Next.js type only exposes
    // the new `proxyClientMaxBodySize` (same default, same behavior).
    proxyClientMaxBodySize: "25mb",

    // Outbound Gmail attachments (sprint 10.5) ship raw PDF bytes through a
    // Server Action. Per-file cap = 15 MB, combined cap = 20 MB ; we set the
    // Server Actions body cap a bit above the latter to leave room for the
    // form fields and the multipart framing. See
    // lib/gmail/attachment-limits.ts for the canonical limits.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default withNextIntl(nextConfig);
