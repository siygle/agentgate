<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:api-response-rules -->
# API Response Convention

All API routes must use the unified response structure from `@/lib/api-response`. Use `ok(data, status)` for success responses and `err(error, status)` for error responses. Never return raw data or ad-hoc JSON structures from route handlers.
<!-- END:api-response-rules -->
