# Brand website training

Open **AI Agents → Train Agent**. Available separately for each brand with AI Agents enabled. Brand admins can edit; other members can view.

1. Enter the brand's public HTTPS website, or use its connected Shopify/WooCommerce store URL.
2. Scan the site. The scanner reads up to six linked HTML pages, prioritizing FAQs, policies, contact/about and product pages. It shows actual sources, fetch timestamps and skipped-page/coverage warnings. This is a bounded public-page scan, not a full-site browser crawler. JavaScript-only and password-protected stores need another readable page or manual knowledge.
3. Review generated brand-specific customer questions. Each suggested question needs an exact website excerpt establishing relevance. Automatic answers are continuous excerpts verified against the captured source text; invented/paraphrased answers become blank. Relevant questions with no answer stay blank for the merchant. There is no generic fallback question list.
4. Edit answers, fill gaps or add custom questions. Source evidence stays visible separately from merchant-edited text. Approve answers individually and save the draft.
5. Publish approved answers. Only answered, approved questions enter live knowledge; each Q&A has its own keyword-search chunk. Publishing replaces this section's managed FAQ document atomically, preserving manual knowledge and imported policies. For semantic retrieval, use Setup → Knowledge → Reindex after publishing if an embeddings key is configured.
6. Rescan after website changes. Merchant edits remain; generated answers refresh and all approvals reset. Missing automatic answers become blank rather than silently keeping obsolete facts. Previous published knowledge remains live until a new revision is explicitly published or withdrawn. Draft edits and scanning never enable auto-replies.
7. Withdraw published FAQ when needed. This removes the managed live document/chunks and keeps the editable draft, which can be published again.

Apply `supabase/migrations/20261014140325_brand_agent_training.sql` before deployment. It adds brand-scoped `ai_training_sets` with RLS and an invoker-only atomic publication RPC. All API operations derive the account from authenticated context; revisions prevent stale tabs/scans from overwriting newer edits. Public website fetches use HTTPS, public IPv4 validation, DNS pinning, manual redirect validation, no account cookies/credentials, a 1 MB page cap, six-page/ten-attempt limits and a 35-second scan deadline. IPv6-only sites are currently unsupported.

Question generation uses the super-admin-configured provider/model even when the assistant is off. It has a separate bounded output budget and a two-scan-per-minute per-process account rate limit. No provider/model/credential controls move to the merchant. Generation can incur provider charges; the UI warns before scanning. Drafting does not prove every excerpt semantically answers its question: merchant review is required, especially for contradictory or outdated website policies.

Verification covers fabricated answers, missing sources, topic relevance, merchant edit retention, SSRF/DNS pinning, fetch limits, account isolation, stale revisions, approval filtering, withdrawal, and transactional rollback. Live provider/website coverage and deployed migration application require a deployment smoke test.
