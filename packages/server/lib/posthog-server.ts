import { PostHog } from "posthog-node";
import { getPostHogProjectToken } from "@/lib/posthog-env";

let posthogClient: PostHog | null = null;

/** Server-side PostHog; `null` when no project token is configured. */
export function getPostHogClient(): PostHog | null {
  const token = getPostHogProjectToken();
  if (!token) {
    return null;
  }
  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}
