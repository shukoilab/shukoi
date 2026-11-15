---
"@shukoi/core": patch
"@shukoi/api": patch
"@shukoi/mcp": patch
"@shukoi/cloudflare": patch
"@shukoi/lambda": patch
"@shukoi/selfhost": patch
"create-shukoi": patch
---

Release v1.0.2:
- **Licenses**: Distributed official MIT `LICENSE` files into all 7 packages and added `"license": "MIT"` along with `"LICENSE"` to package tarball manifests.
- **NPM Discoverability & SEO**: Added rich package descriptions, repository directory pointers, bug trackers, and curated keywords (`shukoi`, `mcp`, `hono`, `typebox`, `micro-framework`, etc.) across all 7 packages.
- **CI/CD Automation**: Enabled `SHUKOI_BOT_TOKEN` in release workflow to ensure automated release PRs execute without manual approval gates.
