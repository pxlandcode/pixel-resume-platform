-- Sweden/EU legal pack publish script
-- Version: 2026-03-03-se-eu-v3
-- Effective date: 2026-03-03

BEGIN;

INSERT INTO public.legal_documents (
	doc_type,
	version,
	content_html,
	effective_date,
	acceptance_scope,
	is_active
)
VALUES (
	'tos'::public.legal_document_type,
	'2026-03-03-se-eu-v3',
	$tos_doc$
<h1>Terms of Service</h1>
<p><strong>Version:</strong> 2026-03-03-se-eu-v3</p>
<p><strong>Effective date:</strong> 2026-03-03</p>
<p>
	These Terms of Service ("Terms") govern access to and use of the Resume Platform service
	("Service"), operated by Pixel&amp;Code AB ("Provider", "we", "us", "our"), established in
	Sweden.
</p>
<p>
	By accessing or using the Service, you confirm that you are either (i) authorized to accept
	these Terms on behalf of your organization ("Customer"), or (ii) accessing the Service as an
	authorized user under an existing agreement between Pixel&amp;Code AB and the Customer.
</p>

<h2>1. Scope of Service</h2>
<p>
	The Service provides tools to manage talent profiles, create and edit resume content, export
	resumes, configure organization templates, support cross-organization sharing, and use
	AI-assisted drafting, searching, filtering, and PDF import features.
</p>

<h2>2. Customer Account and Access</h2>
<ul>
	<li>Customer must provide accurate account and profile information.</li>
	<li>Customer is responsible for credentials, user provisioning, and role assignments.</li>
	<li>
		Customer must promptly disable access for users who are no longer authorized to use the Service.
	</li>
	<li>
		Provider may suspend access where necessary to protect security, legal compliance, or Service
		integrity.
	</li>
</ul>

<h2>3. Acceptable Use</h2>
<p>Customer and users must not:</p>
<ul>
	<li>use the Service for unlawful, infringing, discriminatory, or abusive purposes;</li>
	<li>attempt to bypass access controls, audit controls, or legal acceptance controls;</li>
	<li>upload malware or otherwise interfere with availability, confidentiality, or integrity;</li>
	<li>reverse engineer or misuse the Service except where mandatory law permits.</li>
</ul>

<h2>4. Personal Data and Compliance Responsibilities</h2>
<p>
	Customer is responsible for ensuring a valid legal basis for all personal data submitted to the
	Service, including candidate and consultant data. Customer must comply with Regulation (EU)
	2016/679 (GDPR), applicable Swedish data protection law, and applicable employment and labor laws.
</p>
<p>Customer is responsible for:</p>
<ul>
	<li>providing required transparency information to data subjects;</li>
	<li>documenting lawful basis where required;</li>
	<li>maintaining data accuracy and minimizing unnecessary personal data;</li>
	<li>responding to data subject requests concerning Customer-controlled data.</li>
</ul>
<p>
	Where Provider processes personal data on behalf of Customer, the parties shall enter into a
	separate Data Processing Agreement ("DPA") forming part of these Terms in accordance with
	Article 28 GDPR.
</p>
<p>
	Provider supplies technical infrastructure and does not independently supervise Customer's GDPR
	compliance.
</p>

<h2>5. AI Features</h2>
<p>
	The Service includes AI-assisted features for drafting resume text, searching, filtering, and
	extracting data from PDF files. AI outputs are probabilistic and may be inaccurate or incomplete.
	Customer is solely responsible for reviewing, validating, and approving all AI output before use
	or disclosure.
</p>
<p>
	Customer must not rely on AI output as legal, regulatory, or employment advice and must ensure that
	any submitted data is lawful to process and share with AI subprocessors.
</p>

<h2>6. Data Sharing Between Organizations</h2>
<p>
	The Service supports controlled data sharing and export between organizations. Customer may only
	share data where it has authority and legal basis to do so. Sharing permissions and export scope
	controls in the Service do not replace Customer's independent legal obligations.
</p>

<h2>7. Intellectual Property</h2>
<p>
	Provider and its licensors retain all rights in the Service software, branding, and underlying
	technology. Customer retains rights in Customer data and content submitted to the Service.
</p>

<h2>8. Confidentiality and Security</h2>
<p>
	Each party must protect confidential information received from the other party using reasonable
	technical and organizational safeguards. Provider applies security controls appropriate to the
	Service risk profile, but no system can be guaranteed as fully secure.
</p>
<p>
	If Provider becomes aware of a personal data breach affecting Customer-controlled data, Provider
	shall notify the Customer without undue delay after becoming aware of the breach and provide
	reasonable information necessary for Customer to comply with its obligations under applicable data
	protection law.
</p>
<p>
	Provider may engage subprocessors to support the Service. Provider remains responsible for
	subprocessors' compliance with applicable data protection obligations and shall maintain an
	up-to-date list of subprocessors available upon request.
</p>

<h2>9. Availability, Changes, and Support</h2>
<p>
	Provider may update the Service, including features, APIs, and security controls. Provider may
	modify or discontinue features where reasonably required for legal, security, or technical reasons.
</p>

<h2>10. Term and Termination</h2>
<p>
	These Terms apply while Customer uses the Service. Provider may suspend or terminate access for
	material breach, security risk, or unlawful use. Customer may stop using the Service at any time,
	subject to contractual commitments.
</p>

<h2>11. Disclaimer and Liability</h2>
<p>
	To the maximum extent permitted by law, the Service is provided "as is" and "as available."
	Provider disclaims implied warranties, including fitness for a particular purpose and
	non-infringement.
</p>
<p>
	To the maximum extent permitted by law, Provider is not liable for indirect, incidental, special,
	consequential, or punitive damages, or for loss of profits, revenue, data, goodwill, or business
	interruption. Provider's aggregate liability under these Terms is limited to fees paid for the
	Service during the 12 months preceding the claim, except where mandatory law requires otherwise.
</p>

<h2>12. Governing Law and Disputes</h2>
<p>
	These Terms are governed by the laws of Sweden, without regard to conflict-of-laws rules. Disputes
	shall be settled by Swedish courts, with Stockholm District Court as first instance, unless
	mandatory law requires another forum.
</p>

<h2>13. Changes to These Terms</h2>
<p>
	Provider may update these Terms. New versions become effective from the published effective date and
	may require renewed acceptance before continued use of the Service.
</p>

<h2>14. Contact</h2>
<p>
	Legal entity: Pixel&amp;Code AB<br>
	Organization number: 5594-206400<br>
	Address: Tegn&eacute;rgatan 34<br>
	113 59 Stockholm<br>
	Sweden<br>
	Legal contact: legal@pixelcode.se
</p>
$tos_doc$,
	DATE '2026-03-03',
	'platform_access'::public.legal_acceptance_scope,
	true
)
ON CONFLICT (doc_type, version)
DO UPDATE
SET
	content_html = EXCLUDED.content_html,
	effective_date = EXCLUDED.effective_date,
	acceptance_scope = EXCLUDED.acceptance_scope,
	is_active = true;

INSERT INTO public.legal_documents (
	doc_type,
	version,
	content_html,
	effective_date,
	acceptance_scope,
	is_active
)
VALUES (
	'privacy'::public.legal_document_type,
	'2026-03-03-se-eu-v2',
	$privacy_doc$
<h1>Privacy Notice</h1>
<p><strong>Version:</strong> 2026-03-03-se-eu-v2</p>
<p><strong>Effective date:</strong> 2026-03-03</p>

<p>
	This Privacy Notice explains how personal data is processed in the Resume Platform service
	("Service").
</p>

<h2>1. Controller and Contact</h2>
<p>
	Pixel&amp;Code AB<br>
	Organization number: 5594-206400<br>
	Tegn&eacute;rgatan 34<br>
	113 59 Stockholm<br>
	Sweden<br>
	Privacy contact: privacy@pixelcode.se
</p>
<p>No Data Protection Officer has been appointed.</p>

<h2>2. Roles in Data Processing</h2>
<p>
	For account, platform security, legal acceptance, and operational metadata, Pixel&amp;Code AB acts as
	controller.
</p>
<p>
	For talent and resume content uploaded by a Customer organization, Pixel&amp;Code AB acts as processor
	on behalf of that Customer where applicable. Customer remains responsible for lawful basis,
	transparency, and lawful use of the Service.
</p>
<p>
	Pixel&amp;Code AB provides technical infrastructure and does not independently determine or supervise
	Customer compliance decisions unless explicitly agreed otherwise in writing.
</p>

<h2>3. Categories of Personal Data</h2>
<ul>
	<li>Account data: user ID, name, email, role assignments, active status, organization links.</li>
	<li>Profile data: avatar URL, language and view preferences, organization filter settings.</li>
	<li>
		Talent and resume data: names, titles, work history, education, technologies, availability, and
		other resume content entered by users.
	</li>
	<li>
		Technical and security data: IP address, user-agent, authentication metadata, audit log records,
		import job metadata, and request metadata.
	</li>
	<li>
		Legal compliance data: legal document acceptance snapshots and employer lawful-basis assertions.
	</li>
	<li>
		AI feature data: prompts, search/filter instructions, contextual resume text, and PDF file content
		submitted for extraction.
	</li>
</ul>

<h2>4. Purposes and Legal Bases</h2>
<table>
	<thead>
		<tr>
			<th>Purpose</th>
			<th>Data used</th>
			<th>Legal basis (GDPR)</th>
		</tr>
	</thead>
	<tbody>
		<tr>
			<td>Provide account access and core platform functionality</td>
			<td>Account, profile, organization linkage data</td>
			<td>Article 6(1)(b) contract; Article 6(1)(f) legitimate interests</td>
		</tr>
		<tr>
			<td>Protect security, prevent abuse, and keep auditability</td>
			<td>Technical data, audit logs, legal acceptance metadata</td>
			<td>Article 6(1)(f) legitimate interests; Article 6(1)(c) legal obligation where applicable</td>
		</tr>
		<tr>
			<td>Manage talent and resume content for Customer organizations</td>
			<td>Talent and resume data</td>
			<td>
				Article 6(1)(b)/(f) under Customer instructions; Pixel&amp;Code AB acts as processor where
				applicable
			</td>
		</tr>
		<tr>
			<td>Provide AI-assisted drafting, searching, filtering, and PDF import</td>
			<td>AI prompts, search/filter inputs, resume context, staged PDF data</td>
			<td>Article 6(1)(b) contract; Article 6(1)(f) legitimate interests</td>
		</tr>
		<tr>
			<td>Handle support, troubleshooting, and service communications</td>
			<td>Account, usage, and message context data</td>
			<td>Article 6(1)(b) contract; Article 6(1)(f) legitimate interests</td>
		</tr>
	</tbody>
</table>

<h2>5. Recipients and Subprocessors</h2>
<p>Personal data may be disclosed to:</p>
<ul>
	<li>Supabase (authentication, database, and storage infrastructure).</li>
	<li>Netlify (hosting and serverless execution infrastructure).</li>
	<li>OpenAI (AI text generation, search/filter support, and PDF extraction features).</li>
	<li>
		Authorized Customer organizations and users, including cross-organization recipients where sharing
		permissions exist.
	</li>
	<li>Professional advisors, auditors, or authorities where legally required.</li>
</ul>

<h2>6. International Transfers</h2>
<p>
	Personal data may be processed in the EEA and, where needed, outside the EEA/UK. For restricted
	transfers, we use safeguards under GDPR Chapter V, such as adequacy decisions or Standard
	Contractual Clauses with supplementary measures where required.
</p>
<p>
	Where OpenAI or other subprocessors process data outside the EEA, Standard Contractual Clauses and
	additional safeguards are implemented as required under GDPR Chapter V.
</p>

<h2>7. Storage and Retention</h2>
<p>We retain personal data only as long as necessary for the stated purposes.</p>
<ul>
	<li>Account and organization data: while account access is active and as needed for operations.</li>
	<li>
		Resume and talent content: retained for the duration of the Customer relationship and deleted or
		anonymized upon Customer instruction, account termination, or in accordance with contractual
		retention periods.
	</li>
	<li>
		Legal acceptance and audit records: retained for compliance, traceability, and dispute handling.
	</li>
	<li>
		Staged PDF import files: intended to be removed after job completion/failure, subject to technical
		recovery needs.
	</li>
	<li>User settings in browser storage: retained until user/browser clears local data.</li>
</ul>

<h2>8. Cookies and Similar Technologies</h2>
<p>
	The Service currently uses strictly necessary authentication cookies and local browser storage for
	session and product preference handling.
</p>
<ul>
	<li><strong>sb-access-token</strong>: session authentication.</li>
	<li><strong>sb-refresh-token</strong>: session renewal.</li>
	<li>
		Browser storage keys (for example <code>user-settings:v1:*</code>): user interface preferences.
	</li>
</ul>
<p>
	We do not currently use optional analytics or marketing cookies in the authenticated app. If that
	changes, we will request consent where required by applicable law.
</p>

<h2>9. Data Subject Rights</h2>
<p>Under GDPR, data subjects may have rights to:</p>
<ul>
	<li>access personal data;</li>
	<li>rectify inaccurate data;</li>
	<li>erase data in certain cases;</li>
	<li>restrict processing in certain cases;</li>
	<li>object to processing based on legitimate interests;</li>
	<li>data portability where applicable;</li>
	<li>withdraw consent where processing relies on consent.</li>
</ul>
<p>
	Requests can be sent to privacy@pixelcode.se. We may require identity verification before acting on
	a request. You also have the right to lodge a complaint with Integritetsskyddsmyndigheten (IMY) in
	Sweden.
</p>

<h2>10. Security</h2>
<p>
	We apply technical and organizational safeguards including role-based access controls, audit logging
	for sensitive actions, and controlled legal acceptance flows. No security control can guarantee
	absolute protection.
</p>

<h2>11. Updates to This Notice</h2>
<p>
	We may update this Privacy Notice when processing, legal requirements, or Service features change.
	Updated versions are published with a new effective date and may require renewed acceptance.
</p>
$privacy_doc$,
	DATE '2026-03-03',
	'platform_access'::public.legal_acceptance_scope,
	true
)
ON CONFLICT (doc_type, version)
DO UPDATE
SET
	content_html = EXCLUDED.content_html,
	effective_date = EXCLUDED.effective_date,
	acceptance_scope = EXCLUDED.acceptance_scope,
	is_active = true;

INSERT INTO public.legal_documents (
	doc_type,
	version,
	content_html,
	effective_date,
	acceptance_scope,
	is_active
)
VALUES (
	'ai_notice'::public.legal_document_type,
	'2026-03-03-se-eu-v3',
	$ai_doc$
<h1>AI Notice</h1>
<p><strong>Version:</strong> 2026-03-03-se-eu-v3</p>
<p><strong>Effective date:</strong> 2026-03-03</p>

<p>
	This notice explains how AI functionality is used in the Resume Platform service, including
	AI-assisted drafting, searching, filtering, and PDF-to-resume import features.
</p>

<h2>1. AI Features in Scope</h2>
<ul>
	<li>AI-assisted generation or rewriting of resume text sections.</li>
	<li>AI-assisted searching and filtering of resume and talent data based on user instructions.</li>
	<li>AI-assisted extraction and normalization of resume content from PDF files.</li>
	<li>Formatting and language support for resume content drafts.</li>
</ul>

<h2>2. How AI Is Used</h2>
<p>
	When AI features are used, selected input data (for example prompt text, search/filter instructions,
	resume context, and PDF content) is sent to an AI provider to generate output. Output is returned to
	the Service for review and editing by authorized users.
</p>
<p>
	AI-assisted search and filtering operates exclusively on Customer-controlled data within the
	Customer's authorized access scope and does not independently profile individuals outside the
	Customer environment.
</p>

<h2>3. Human Oversight and Responsibility</h2>
<p>
	AI output is probabilistic and may be incorrect, incomplete, biased, or outdated. AI output is not
	automatically treated as verified truth. Users must review and approve all generated content before
	export, sharing, or business use.
</p>
<ul>
	<li>Do not rely on AI output as legal or regulatory advice.</li>
	<li>Do not rely on AI output as an automated hiring decision mechanism.</li>
	<li>Always validate sensitive factual claims, dates, and credentials.</li>
</ul>

<h2>4. Data Sent to AI Providers</h2>
<p>Depending on the feature, submitted data may include:</p>
<ul>
	<li>resume text, project descriptions, technologies, and role information;</li>
	<li>consultant profile context and related narrative text;</li>
	<li>search and filtering instructions entered by users;</li>
	<li>uploaded PDF content for extraction workflows.</li>
</ul>
<p>
	Customer must not submit special-category personal data (as defined in Article 9 GDPR) unless it
	has a documented lawful basis and internal authorization to process and disclose such data to the
	relevant processor.
</p>

<h2>5. Legal Basis and Customer Duties</h2>
<p>
	Use of AI features is part of the Service requested by Customer and is subject to these legal
	documents. Customer is responsible for ensuring lawful basis, transparency, and lawful use of any
	personal data included in AI requests.
</p>
<p>
	Pixel&amp;Code AB provides technical AI-enabled infrastructure and does not independently determine
	Customer legal grounds for processing.
</p>

<h2>6. AI Provider and Retention</h2>
<p>
	OpenAI processes API data in accordance with its applicable API data usage policies. Pixel&amp;Code AB
	does not permit use of submitted data for model training where such controls are contractually
	available.
</p>

<h2>7. Automated Decision-Making</h2>
<p>
	The Service does not use AI to make solely automated legal or similarly significant decisions about
	individuals. AI output is assistive and requires human review.
</p>

<h2>8. Security and Access Control</h2>
<p>
	AI features are available only to authenticated users with relevant role permissions. Access and
	sensitive actions are subject to authentication, authorization, and audit logging controls.
</p>

<h2>9. Changes to AI Functionality</h2>
<p>
	AI features and provider configurations may change over time for legal, quality, security, or
	technical reasons. Material changes may require renewed acceptance of this notice.
</p>

<h2>10. Contact</h2>
<p>
	Questions about AI use in the Service can be sent to privacy@pixelcode.se or legal@pixelcode.se.
</p>
$ai_doc$,
	DATE '2026-03-03',
	'platform_access'::public.legal_acceptance_scope,
	true
)
ON CONFLICT (doc_type, version)
DO UPDATE
SET
	content_html = EXCLUDED.content_html,
	effective_date = EXCLUDED.effective_date,
	acceptance_scope = EXCLUDED.acceptance_scope,
	is_active = true;

INSERT INTO public.legal_documents (
	doc_type,
	version,
	content_html,
	effective_date,
	acceptance_scope,
	is_active
)
VALUES (
	'data_sharing'::public.legal_document_type,
	'2026-03-03-se-eu-v2',
	$sharing_doc$
<h1>Data Sharing Notice</h1>
<p><strong>Version:</strong> 2026-03-03-se-eu-v2</p>
<p><strong>Effective date:</strong> 2026-03-03</p>

<p>
	This notice explains how talent and resume data may be shared between organizations in the Resume
	Platform service.
</p>

<h2>1. Purpose</h2>
<p>
	The Service allows controlled sharing and export of talent-related data between a source
	organization and a target organization when explicit sharing permissions are configured.
</p>

<h2>2. Sharing Scopes</h2>
<p>Sharing in the Service is permission-based and scope-limited.</p>
<table>
	<thead>
		<tr>
			<th>Scope key</th>
			<th>Meaning</th>
		</tr>
	</thead>
	<tbody>
		<tr>
			<td><code>view</code></td>
			<td>Target organization can view permitted talent/resume information.</td>
		</tr>
		<tr>
			<td><code>export_org_template</code></td>
			<td>Target organization can export using organization template scope.</td>
		</tr>
		<tr>
			<td><code>export_broker_template</code></td>
			<td>Target organization can export using broker template scope (widest export scope).</td>
		</tr>
	</tbody>
</table>

<h2>3. Who Receives Shared Data</h2>
<p>Recipients may include:</p>
<ul>
	<li>authorized users in source and target organizations;</li>
	<li>administrators supervising sharing approvals and controls;</li>
	<li>auditors or authorities where legally required.</li>
</ul>

<h2>4. Legal and Contractual Responsibilities</h2>
<p>
	Each organization remains independently responsible for having a valid legal basis before disclosing
	or using personal data. Sharing permissions in the Service are technical controls and do not replace
	legal obligations under GDPR or local law.
</p>
<p>
	Pixel&amp;Code AB does not independently determine the lawful basis for sharing between organizations
	and acts only as a technical platform provider unless explicitly agreed otherwise in writing.
</p>
<ul>
	<li>Source organization must ensure lawful disclosure.</li>
	<li>Target organization must ensure lawful use and onward handling.</li>
	<li>Both organizations must maintain transparency toward data subjects where required.</li>
</ul>

<h2>5. Auditability and Traceability</h2>
<p>
	Sensitive actions related to sharing and export may be logged for security and compliance purposes.
	Log data may include actor identity, organization context, action type, and related metadata.
</p>

<h2>6. International Transfers</h2>
<p>
	Where sharing or access involves organizations or infrastructure outside the EEA/UK, transfer
	safeguards under GDPR Chapter V must be applied by the responsible controller(s).
</p>

<h2>7. Retention</h2>
<p>
	Shared data remains subject to the applicable retention rules of the source and target
	organizations, contractual obligations, and mandatory legal requirements.
</p>

<h2>8. Data Subject Rights</h2>
<p>
	Data subjects may request access, rectification, erasure, restriction, objection, and portability
	where applicable. Requests should be directed to the relevant controller organization. Where
	necessary, organizations may coordinate responses.
</p>

<h2>9. Changes to This Notice</h2>
<p>
	This notice may be updated to reflect legal, operational, or technical changes. Updated versions may
	require renewed acceptance before continued use.
</p>

<h2>10. Contact</h2>
<p>
	For questions about data sharing controls and compliance in this Service, contact
	privacy@pixelcode.se.
</p>
$sharing_doc$,
	DATE '2026-03-03',
	'platform_access'::public.legal_acceptance_scope,
	true
)
ON CONFLICT (doc_type, version)
DO UPDATE
SET
	content_html = EXCLUDED.content_html,
	effective_date = EXCLUDED.effective_date,
	acceptance_scope = EXCLUDED.acceptance_scope,
	is_active = true;

INSERT INTO public.legal_documents (
	doc_type,
	version,
	content_html,
	effective_date,
	acceptance_scope,
	is_active
)
VALUES (
	'data_processing_agreement'::public.legal_document_type,
	'2026-03-03-se-eu-v2',
	$dpa_doc$
<h1>Data Processing Agreement (DPA)</h1>
<p><strong>Version:</strong> 2026-03-03-se-eu-v2</p>
<p><strong>Effective date:</strong> 2026-03-03</p>
<p>
	This Data Processing Agreement ("DPA") forms part of the agreement between Pixel&amp;Code AB
	("Processor") and the Customer organization using Resume Platform ("Controller").
</p>

<h2>1. Parties</h2>
<p>
	Processor: Pixel&amp;Code AB, organization number 5594-206400, Tegn&eacute;rgatan 34, 113 59 Stockholm,
	Sweden.
</p>
<p>Controller: The Customer entity identified in the applicable commercial agreement or order.</p>

<h2>2. Subject Matter and Duration</h2>
<p>
	This DPA governs Processor's processing of personal data on behalf of Controller in connection with
	the Resume Platform service. This DPA applies for the duration of the Services and until all
	Controller personal data is deleted or returned in accordance with Section 12.
</p>

<h2>3. Nature and Purpose of Processing</h2>
<p>Processor processes personal data solely to provide the Services, including:</p>
<ul>
	<li>user account and access management;</li>
	<li>storage and management of talent and resume content;</li>
	<li>controlled sharing and export workflows across organizations;</li>
	<li>AI-assisted drafting, searching, filtering, and PDF extraction features;</li>
	<li>security logging, troubleshooting, and support.</li>
</ul>

<h2>4. Types of Personal Data</h2>
<ul>
	<li>identity and contact data (name, email, phone where provided);</li>
	<li>professional profile and resume data (roles, experience, skills, education);</li>
	<li>account metadata and role/access settings;</li>
	<li>technical and security data (IP address, user agent, logs);</li>
	<li>AI request inputs and outputs submitted by authorized users.</li>
</ul>

<h2>5. Categories of Data Subjects</h2>
<ul>
	<li>Controller users and administrators;</li>
	<li>consultants, candidates, or talents represented in the Service;</li>
	<li>other business contacts included in resume or profile data by Controller users.</li>
</ul>

<h2>6. Processor Obligations (Article 28 GDPR)</h2>
<ul>
	<li>Process personal data only on documented instructions from Controller.</li>
	<li>
		Processor shall promptly inform Controller if, in its opinion, an instruction infringes GDPR
		or other applicable data protection law.
	</li>
	<li>Ensure personnel authorized to process personal data are bound by confidentiality.</li>
	<li>Implement appropriate technical and organizational security measures.</li>
	<li>Assist Controller in meeting obligations under Articles 32 to 36 GDPR where applicable.</li>
	<li>
		Assist Controller, as reasonably possible, in responding to data subject rights requests under
		Chapter III GDPR.
	</li>
	<li>Maintain records and information required by Article 28 and applicable law.</li>
	<li>Not sell Controller personal data or process it for independent marketing purposes.</li>
</ul>

<h2>7. Subprocessors</h2>
<p>
	Controller authorizes Processor to use subprocessors necessary to deliver the Services, including:
	Supabase, Netlify, and OpenAI.
</p>
<p>
	Processor remains responsible for subprocessors' performance of data protection obligations relevant
	to the processing they perform.
</p>
<p>
	Processor may update subprocessors from time to time. An up-to-date subprocessor list is available
	upon request or through Processor documentation.
</p>

<h2>8. International Transfers</h2>
<p>
	Where personal data is transferred outside the EEA/UK, Processor shall implement transfer safeguards
	under GDPR Chapter V, including Standard Contractual Clauses and supplementary measures where
	required.
</p>

<h2>9. Security Measures (High-Level Appendix)</h2>
<p>Processor applies appropriate technical and organizational measures, including:</p>
<ul>
	<li>role-based access controls and authentication controls;</li>
	<li>encryption in transit and platform-level security controls;</li>
	<li>audit logging for sensitive actions;</li>
	<li>segregation of environments and least-privilege principles where applicable;</li>
	<li>processes for vulnerability handling and incident response.</li>
</ul>

<h2>10. Personal Data Breach Notification</h2>
<p>
	If Processor becomes aware of a personal data breach affecting Controller personal data, Processor
	shall notify Controller without undue delay and provide available information reasonably necessary
	for Controller to meet legal obligations.
</p>

<h2>11. Assistance with Data Subject Rights</h2>
<p>
	Processor shall provide reasonable assistance to Controller to support Controller's handling of data
	subject rights requests, taking into account the nature of processing and information available to
	Processor.
</p>

<h2>12. Deletion or Return of Data</h2>
<p>
	Upon termination of the Services and at Controller's choice, Processor shall delete or return
	Controller personal data, unless retention is required by applicable law.
</p>

<h2>13. Audit Rights</h2>
<p>
	Controller may request information reasonably necessary to demonstrate compliance with this DPA.
	Audits are limited to once per 12-month period unless required by law or a confirmed security
	incident justifies additional review.
</p>
<p>
	Audits shall be remote-first, conducted during business hours, with at least 30 days' prior written
	notice, and must avoid unreasonable disruption to Processor operations or other customers.
	Controller bears its own audit costs unless material non-compliance is confirmed.
</p>

<h2>14. Contact</h2>
<p>
	Privacy contact: privacy@pixelcode.se<br>
	Legal contact: legal@pixelcode.se
</p>
$dpa_doc$,
	DATE '2026-03-03',
	'platform_access'::public.legal_acceptance_scope,
	true
)
ON CONFLICT (doc_type, version)
DO UPDATE
SET
	content_html = EXCLUDED.content_html,
	effective_date = EXCLUDED.effective_date,
	acceptance_scope = EXCLUDED.acceptance_scope,
	is_active = true;

INSERT INTO public.legal_documents (
	doc_type,
	version,
	content_html,
	effective_date,
	acceptance_scope,
	is_active
)
VALUES (
	'subprocessor_list'::public.legal_document_type,
	'2026-03-03-se-eu-v2',
	$subprocessor_doc$
<h1>Subprocessor List - Resume Platform</h1>
<p><strong>Version:</strong> 2026-03-03-se-eu-v2</p>
<p><strong>Effective date:</strong> 2026-03-03</p>

<table>
	<thead>
		<tr>
			<th>Subprocessor</th>
			<th>Service Function</th>
			<th>Location</th>
			<th>Purpose</th>
		</tr>
	</thead>
	<tbody>
		<tr>
			<td>Supabase</td>
			<td>Database, authentication, storage</td>
			<td>European Union (project region-based hosting)</td>
			<td>Infrastructure hosting</td>
		</tr>
		<tr>
			<td>Netlify</td>
			<td>Hosting and serverless infrastructure</td>
			<td>Global CDN and serverless infrastructure (including EU and United States regions)</td>
			<td>Application delivery and background processing</td>
		</tr>
		<tr>
			<td>OpenAI</td>
			<td>AI text generation and PDF extraction</td>
			<td>
				United States (with Standard Contractual Clauses and GDPR Chapter V safeguards
				implemented)
			</td>
			<td>AI-assisted drafting, searching/filtering support, and import workflows</td>
		</tr>
	</tbody>
</table>

<p>
	Where personal data is transferred outside the EEA/UK, Pixel&amp;Code AB implements appropriate
	safeguards in accordance with GDPR Chapter V, including Standard Contractual Clauses where
	applicable.
</p>

<p>
	Pixel&amp;Code AB may update this list from time to time. Customers will be informed of material
	changes where required.
</p>
$subprocessor_doc$,
	DATE '2026-03-03',
	'platform_access'::public.legal_acceptance_scope,
	true
)
ON CONFLICT (doc_type, version)
DO UPDATE
SET
	content_html = EXCLUDED.content_html,
	effective_date = EXCLUDED.effective_date,
	acceptance_scope = EXCLUDED.acceptance_scope,
	is_active = true;
COMMIT;
