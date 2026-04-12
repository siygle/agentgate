/** Origin with no trailing slash (for string concatenation, e.g. canonical URLs). */
export function siteOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Served from `public/og-image.png`. */
export const OG_IMAGE_PATH = "/og-image.png" as const;
