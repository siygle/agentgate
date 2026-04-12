import posthog from "posthog-js";
import { getPostHogProjectToken } from "@/lib/posthog-env";

export function isPostHogConfigured(): boolean {
  return getPostHogProjectToken() !== undefined;
}

export function phCapture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!isPostHogConfigured()) return;
  posthog.capture(event, properties);
}

export function phCaptureException(error: unknown): void {
  if (!isPostHogConfigured()) return;
  posthog.captureException(error);
}
