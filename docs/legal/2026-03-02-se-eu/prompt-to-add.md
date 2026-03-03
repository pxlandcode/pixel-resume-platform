Use this prompt when you want to regenerate or revise the legal documents:

```text
You are updating the legal documentation for a Swedish SaaS product called “Resume Platform” operated by Pixel&Code AB.

This is a B2B SaaS platform handling consultant resumes, cross-organization sharing, and AI-assisted drafting.

AI is also used for searching and filtering.

Apply the following updates precisely and output updated final versions of all documents.

1️⃣ COMPANY INFORMATION (REPLACE ALL PLACEHOLDERS)

Use the following legal entity information everywhere:

Legal entity: Pixel&Code AB
Organization number: 5594-206400
Registered address:
Tegnérgatan 34
113 59 Stockholm
Sweden

Legal contact email: legal@pixelcode.se

Privacy contact email: privacy@pixelcode.se

Remove all placeholder variables like:
{{LEGAL_ENTITY_NAME}}
{{ORGANISATION_NUMBER}}
{{REGISTERED_ADDRESS}}
{{LEGAL_EMAIL}}
{{PRIVACY_EMAIL}}
{{DPO_CONTACT}}

2️⃣ TERMS OF SERVICE — REQUIRED MODIFICATIONS
A. Insert Binding DPA Reference

Replace any wording stating that parties “shall enter into a DPA” with:

“Where Provider processes personal data on behalf of Customer, the parties shall enter into a separate Data Processing Agreement (“DPA”) forming part of these Terms in accordance with Article 28 GDPR.”

B. Add Personal Data Breach Clause

Under the Confidentiality and Security section, insert:

“If Provider becomes aware of a personal data breach affecting Customer-controlled data, Provider shall notify the Customer without undue delay after becoming aware of the breach and provide reasonable information necessary for Customer to comply with its obligations under applicable data protection law.”

C. Add Subprocessor Clause

Insert:

“Provider may engage subprocessors to support the Service. Provider remains responsible for subprocessors’ compliance with applicable data protection obligations and shall maintain an up-to-date list of subprocessors available upon request.”

D. Ensure Liability Cap Remains

Keep aggregate liability limited to fees paid during the preceding 12 months.

Do not expand liability.

3️⃣ PRIVACY NOTICE — REQUIRED MODIFICATIONS
A. Controller Section

Replace with:

Pixel&Code AB
Organization number: 5594-206400
Tegnérgatan 34
113 59 Stockholm
Sweden
Privacy contact: privacy@pixelcode.se

No Data Protection Officer has been appointed.

Remove DPO placeholder completely.

B. Strengthen Retention Language

Replace resume retention wording with:

“Resume and talent content: retained for the duration of the Customer relationship and deleted or anonymized upon Customer instruction, account termination, or in accordance with contractual retention periods.”

C. International Transfers Clarification

Add:

“Where OpenAI or other subprocessors process data outside the EEA, Standard Contractual Clauses and additional safeguards are implemented as required under GDPR Chapter V.”

4️⃣ AI NOTICE — REQUIRED MODIFICATIONS
A. Strengthen Special Category Restriction

Replace wording with:

“Customer must not submit special-category personal data (as defined in Article 9 GDPR) unless it has a documented lawful basis and internal authorization to process and disclose such data to the relevant processor.”

B. OpenAI Retention Clarification

Replace OpenAI retention paragraph with:

“OpenAI processes API data in accordance with its applicable API data usage policies. Pixel&Code AB does not permit use of submitted data for model training where such controls are contractually available.”

5️⃣ DATA SHARING NOTICE — REQUIRED MODIFICATION

Under Legal and Contractual Responsibilities, add:

“Pixel&Code AB does not independently determine the lawful basis for sharing between organizations and acts only as a technical platform provider unless explicitly agreed otherwise in writing.”

6️⃣ REMOVE

Remove:

Any DPO references

Any implication that Pixel&Code supervises customers’ GDPR compliance

Any guarantee of legal compliance

Pixel&Code provides technical infrastructure. Customers remain responsible for lawful use.

7️⃣ CREATE A NEW DOCUMENT

Create a separate document titled:

“Data Processing Agreement (DPA)”

Between:
Pixel&Code AB (Processor)
Customer (Controller)

Include the following sections:

Subject matter and duration

Nature and purpose of processing

Types of personal data

Categories of data subjects

Processor obligations (Article 28 GDPR compliant)

Subprocessors (Supabase, Netlify, OpenAI)

International transfers (SCC reference)

Security measures (high-level appendix)

Personal data breach notification

Assistance with data subject rights

Deletion or return of data upon termination

Audit rights (limited, reasonable, remote-first, with notice)

Keep language balanced and not overly enterprise-heavy.

Do not create unlimited audit rights.

8️⃣ CREATE A SUBPROCESSOR LIST PAGE CONTENT

Generate a separate short document titled:

“Subprocessor List – Resume Platform”

Include:

Supabase – database, authentication, storage – infrastructure hosting
Netlify – hosting and serverless infrastructure
OpenAI – AI text generation and PDF extraction

Include a note:

“Pixel&Code AB may update this list from time to time. Customers will be informed of material changes where required.”

9️⃣ PRE-LAUNCH RESET OPTION (ONLY IF NOT LIVE)

If this environment has not launched and no legal history must be preserved, also output a SQL cleanup block that deletes previous legal documents before publishing the new version:

```sql
BEGIN;
DELETE FROM public.user_legal_acceptances;
DELETE FROM public.legal_documents
WHERE doc_type IN ('tos', 'privacy', 'ai_notice', 'data_sharing');
COMMIT;
```

Important:
- Label this as pre-launch only.
- Do not use this cleanup block for a live production environment.

🔟 OUTPUT FORMAT

Output:

Updated Terms of Service

Updated Privacy Notice

Updated AI Notice

Updated Data Sharing Notice

New Data Processing Agreement

New Subprocessor List

Plus:

Pre-launch cleanup SQL block (clearly marked optional / pre-launch only)

All clean, finalized, no placeholders, ready to publish.

Do not include commentary. Only output final documents.
```
