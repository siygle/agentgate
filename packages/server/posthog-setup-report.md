<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into diff4. Client-side tracking was initialized via `instrumentation-client.ts` (Next.js 15.3+ pattern), a server-side PostHog singleton was created in `lib/posthog-server.ts`, and the Next.js reverse proxy rewrites were added to `next.config.ts` for reliable ingestion. Event capture was added across the full user journey — from landing page engagement through content creation (server-side) and decryption (client-side), with exception capture on all error paths.

| Event | Description | File |
|---|---|---|
| `install_to_agent_dialog_opened` | User opens the "Install to Agent" dialog from the hero section — top of the conversion funnel | `components/landing/hero-section.tsx` |
| `install_prompt_copied` | User copies the install prompt to paste into their AI agent | `components/landing/hero-section.tsx` |
| `try_it_prompt_copied` | User copies the "try it" follow-up prompt after installing the skill | `components/landing/hero-section.tsx` |
| `diff_created` | A new encrypted diff was successfully created via the API (server-side) | `app/api/diff/route.ts` |
| `files_created` | A new encrypted file bundle was successfully created via the API (server-side) | `app/api/files/route.ts` |
| `diff_decryption_succeeded` | User successfully decrypted a diff with the correct passphrase | `components/diff-decrypt-viewer.tsx` |
| `diff_decryption_failed` | Diff decryption failed — incorrect passphrase or corrupted data (also captured as exception) | `components/diff-decrypt-viewer.tsx` |
| `files_decryption_succeeded` | User successfully decrypted a file bundle with the correct passphrase | `components/file-decrypt-viewer.tsx` |
| `files_decryption_failed` | File bundle decryption failed — incorrect passphrase or corrupted data (also captured as exception) | `components/file-decrypt-viewer.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/379057/dashboard/1458326)
- **Insight**: [Install-to-Agent Conversion Funnel](https://us.posthog.com/project/379057/insights/k9Draq0b) — Dialog opened → install prompt copied → try-it prompt copied
- **Insight**: [Content Created Daily](https://us.posthog.com/project/379057/insights/Eg6rPOC1) — Daily diffs and file bundles created via the API
- **Insight**: [Diff Decryption Success vs Failure](https://us.posthog.com/project/379057/insights/nxgD2rEl) — Successful vs failed decryption attempts on diff pages
- **Insight**: [File Bundle Decryption Success vs Failure](https://us.posthog.com/project/379057/insights/0Id68Uz8) — Successful vs failed decryption attempts on file bundle pages
- **Insight**: [Prompt Copy Actions Over Time](https://us.posthog.com/project/379057/insights/GTe7tcod) — Daily installs and try-it prompt copies

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
