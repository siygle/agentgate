import posthog from "posthog-js";
import { getPostHogProjectToken } from "@/lib/posthog-env";

const token = getPostHogProjectToken();
if (token) {
  posthog.init(token, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
}
