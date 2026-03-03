# Legal Pack (Sweden/EU) - 2026-03-03

This folder contains the SQL publishing artifact for legal documents in Resume Platform operated by Pixel&Code AB.

Included files:

- `publish.sql` (upsert + activate all in-product legal documents)

## Versioning in this pack

- In-product legal docs versions:
  - `tos`: `2026-03-03-se-eu-v3`
  - `ai_notice`: `2026-03-03-se-eu-v3`
  - `privacy`: `2026-03-03-se-eu-v2`
  - `data_sharing`: `2026-03-03-se-eu-v2`
  - `data_processing_agreement`: `2026-03-03-se-eu-v2`
  - `subprocessor_list`: `2026-03-03-se-eu-v2`
- Effective date: `2026-03-03`

## Publish the in-product legal documents

Run `publish.sql` in Supabase SQL Editor (or via migration pipeline).

It will:

1. Upsert each legal document by (`doc_type`, `version`).
2. Set `is_active = true` for that version.
3. Trigger the existing active-version logic and re-acceptance flow.

## Source of Truth

- `publish.sql` is the only source of truth for published legal content in this pack.
- Legal content is stored in `public.legal_documents`.

## Pre-launch reset (optional)

If this is truly pre-launch and you want a clean slate, you can delete previous legal rows first,
then run `publish.sql`.

Use with care:

```sql
BEGIN;
DELETE FROM public.user_legal_acceptances;
DELETE FROM public.legal_documents;
COMMIT;
```

Do not run this in production after go-live.

## Notes

- All six legal documents are now stored in `public.legal_documents`.
- Use `acceptance_scope` to control whether a document is mandatory for platform access.
- The current `publish.sql` sets all six documents to `acceptance_scope = platform_access` (mandatory).
- Have Swedish/EU counsel review before production activation.
