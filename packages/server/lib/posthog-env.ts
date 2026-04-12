/** Non-empty project token — when unset, PostHog is disabled everywhere. */
export function getPostHogProjectToken(): string | undefined {
  const t = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  return t?.trim() || undefined;
}
