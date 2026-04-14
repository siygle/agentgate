import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const rules: Array<{ source: string; destination: string }> = [
      {
        source: "/docs/:path*.mdx",
        destination: "/llms.mdx/docs/:path*",
      },
    ];

    if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
      rules.push(
        {
          source: "/ingest/static/:path*",
          destination: "https://us-assets.i.posthog.com/static/:path*",
        },
        {
          source: "/ingest/:path*",
          destination: "https://us.i.posthog.com/:path*",
        },
      );
    }

    return rules;
  },
};

const withMDX = createMDX();

export default withMDX(config);
