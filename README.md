# Pixel Resume Platform

Pixel Resume Platform är en SvelteKit-applikation för att hantera talanger,
konsult-CV:n, organisationsprofiler, delningslänkar och exportfärdiga CV-paket.
Plattformen använder Supabase för auth, datalager, storage och RLS, OpenAI för
AI-stöd i CV-flöden, samt Netlify Functions för längre bakgrundsjobb i
produktion.

## Innehåll

- [Teknikstack](#teknikstack)
- [Funktioner](#funktioner)
- [Snabbstart](#snabbstart)
- [Miljövariabler](#miljövariabler)
- [Vanliga kommandon](#vanliga-kommandon)
- [Applikationsstruktur](#applikationsstruktur)
- [Supabase och databas](#supabase-och-databas)
- [Demoorganisation](#demoorganisation)
- [Legal documents och consent](#legal-documents-och-consent)
- [CV-import, sök och AI](#cv-import-sök-och-ai)
- [PDF-, Word- och delningsexport](#pdf--word--och-delningsexport)
- [Deployment](#deployment)
- [Kvalitet och felsökning](#kvalitet-och-felsökning)

## Teknikstack

- SvelteKit 2, Svelte 5 och Vite 7.
- TypeScript.
- Tailwind CSS 4 via `@tailwindcss/vite`.
- Supabase Auth, Postgres, Storage och server-side service-role-flöden.
- OpenAI SDK för AI-skrivstöd, PDF-import och semantisk CV-sökning.
- Playwright/Chromium för PDF-rendering.
- Netlify Functions för bakgrundskörning av PDF-import och CV-sökjobb.

Projektet är låst mot Node via `.tool-versions`:

```sh
nodejs 22.22.1
```

## Funktioner

- Rollstyrd dashboard för `admin`, `organisation_admin`, `broker`, `employer`
  och `talent`.
- Talent- och användarhantering med organisationstillhörighet.
- Organisationsadmin med branding, logotyper, typsnitt, e-postdomäner,
  templates och talent labels.
- CV-hantering med huvud-CV, versioner, tech stack, erfarenheter, certifikat,
  kommentarer och tillgänglighet.
- AI-assisterad CV-text och PDF-import till strukturerad CV-data.
- Enkel och AI-stödd CV-sökning, inklusive indexerade sökdokument och
  semantiska embeddings när OpenAI är konfigurerat.
- PDF- och Word-export med organisationsbranding, anonymiseringsstöd och audit
  logging.
- Delningslänkar för CV:n via signerade tokens.
- Legal consent-gate för villkor, privacy, AI notice, data sharing och relaterade
  dokument.
- Billing-vyer och fakturerings-PDF:er för admin och organisation admin.

## Snabbstart

Installera beroenden:

```sh
npm install
```

Skapa en lokal `.env` med minst Supabase-variablerna. Se
[Miljövariabler](#miljövariabler) för komplett lista.

Starta utvecklingsservern:

```sh
npm run dev
```

Öppna appen på den URL som Vite skriver ut, normalt:

```text
http://localhost:5173
```

Kör typkontroll:

```sh
npm run check
```

Bygg produktionsbundle:

```sh
npm run build
```

Förhandsgranska byggd app:

```sh
npm run preview
```

## Miljövariabler

Lägg lokala värden i `.env`. Checka aldrig in riktiga nycklar. Projektet läser
både nya Supabase publishable/secret keys och äldre anon/service-role-namn där
det finns fallback.

### Obligatoriska för normal körning

| Variabel                          | Beskrivning                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                    | Supabase project URL för serverkod och Netlify Functions.                                   |
| `SUPABASE_PUBLISHABLE_KEY`        | Server-side publishable key. Legacy fallback: `SUPABASE_ANON_KEY`.                          |
| `SUPABASE_SECRET_KEY`             | Service-role/secret key för adminoperationer. Legacy fallback: `SUPABASE_SERVICE_ROLE_KEY`. |
| `PUBLIC_SUPABASE_URL`             | Supabase project URL exponerad till browser-klienten.                                       |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser publishable key. Legacy fallback: `PUBLIC_SUPABASE_ANON_KEY`.                       |
| `RESUME_SHARE_SECRET`             | Minst 32 tecken. Används för hashing/kryptering av CV-delningstokens.                       |

### AI, import och sök

| Variabel                                | Beskrivning                                                          |
| --------------------------------------- | -------------------------------------------------------------------- |
| `OPENAI_API_KEY`                        | Krävs för AI-skrivstöd, PDF-import och embeddings.                   |
| `LLM_MODEL`                             | Standardmodell för AI-flöden. Default i koden är `gpt-4o-mini`.      |
| `LLM_MODEL_PDF_IMPORT`                  | Modelloverride för PDF-import. Faller tillbaka till `LLM_MODEL`.     |
| `LLM_MODEL_SEARCH_QUERY`                | Modelloverride för sökfrågeanalys. Faller tillbaka till `LLM_MODEL`. |
| `OPENAI_EMBEDDING_MODEL`                | Modell för semantiska embeddings. Koden har egen default.            |
| `OPENAI_DEBUG`                          | Sätt till `true` för init-loggning av OpenAI-konfiguration.          |
| `RESUME_SEARCH_EMBEDDING_REFRESH_LIMIT` | Begränsar hur många embeddings som refreshas per sökflöde.           |

### Export och rendering

| Variabel                              | Beskrivning                                                      |
| ------------------------------------- | ---------------------------------------------------------------- |
| `RESUME_EXPORTS_BUCKET`               | Supabase Storage bucket för exporter. Default: `resume-exports`. |
| `PDF_TARGET_MAX_BYTES`                | Målstorlek för PDF-komprimering. Default: 1 MB.                  |
| `PDF_ALLOW_SVG_RASTERIZATION`         | Sätt till `1` för SVG-rasterisering i PDF-flödet.                |
| `CHROME_PATH`                         | Lokal Chrome/Chromium-binär om automatisk lookup misslyckas.     |
| `CHROMIUM_EXECUTABLE_PATH`            | Alternativ lokal Chromium-path.                                  |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Alternativ Playwright Chromium-path.                             |
| `PUBLIC_SUPABASE_IMAGE_BASE_URL`      | Override för publik Supabase Storage image base URL.             |

### Demo

| Variabel               | Beskrivning                                        |
| ---------------------- | -------------------------------------------------- |
| `DEMO_ADMIN_EMAIL`     | Demo admin-login. Default: `demo.admin@test.se`.   |
| `DEMO_ADMIN_PASSWORD`  | Krävs när `npm run demo:setup` körs.               |
| `DEMO_TALENT_EMAIL`    | Demo talent-login. Default: `demo.talent@test.se`. |
| `DEMO_TALENT_PASSWORD` | Krävs när `npm run demo:setup` körs.               |

Exempel på lokal `.env`-mall:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_service_role_or_secret_key

PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
PUBLIC_SUPABASE_IMAGE_BASE_URL=https://your-project.supabase.co/storage/v1/object/public

OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
LLM_MODEL_PDF_IMPORT=gpt-4o-mini
LLM_MODEL_SEARCH_QUERY=gpt-4o-mini

RESUME_SHARE_SECRET=replace_with_at_least_32_random_characters
RESUME_EXPORTS_BUCKET=resume-exports
```

Generera en delningshemlighet lokalt:

```sh
openssl rand -base64 32
```

## Vanliga kommandon

| Kommando              | Användning                                                      |
| --------------------- | --------------------------------------------------------------- |
| `npm run dev`         | Startar Vite/SvelteKit i utvecklingsläge.                       |
| `npm run build`       | Bygger appen för produktion.                                    |
| `npm run preview`     | Förhandsgranskar produktionsbygget lokalt.                      |
| `npm run check`       | Kör `svelte-kit sync` och `svelte-check`.                       |
| `npm run check:watch` | Kör typkontroll i watch mode.                                   |
| `npm run lint`        | Kör Prettier check och ESLint.                                  |
| `npm run format`      | Formaterar projektet med Prettier.                              |
| `npm run demo:setup`  | Skapar/uppdaterar demoanvändare och resetar demoorganisationen. |

## Applikationsstruktur

```text
src/routes/
  +page.*                         Dashboard
  login/, logout/, reset-password/ Auth-flöden
  resumes/                        CV-lista och CV-detalj per talent
  talents/                        Talent-register
  users/                          Användaradmin
  organisations/                  Global organisationsadmin
  settings/                       Personliga och organisationsspecifika inställningar
  billing/                        Faktureringsvyer
  legal/accept/                   Consent-gate
  s/[token]/                      Publik vy för CV-delningslänk
  print/                          Printvyer för CV och billing
  api/                            Publika server endpoints
  internal/api/                   Inloggade interna endpoints

src/lib/server/
  access.ts                       Roller, organisationstillgång och exportpolicy
  supabase.ts                     Supabase-klienter, auth cookies och service-role client
  legal*.ts                       Consent, audit och legal gate
  resumeShares.ts                 Delningslänkar och tokenhantering
  resumes/                        CV-store, AI, import, search och exportpolicy

supabase/migrations/              Timestampade inkrementella migrationer
supabase-migrations-*.sql         Foundation/manuala SQL-artefakter i rotmappen
netlify/functions/                Bakgrundsjobb för produktion
docs/legal/                       Publiceringspaket för juridiska dokument
```

## Supabase och databas

Koden förutsätter en talent-native datamodell med tabeller som `user_profiles`,
`talents`, `organisations`, `organisation_users`, `organisation_talents`,
`roles`, `user_roles`, `resumes` och de normaliserade CV-tabellerna.

### Fresh setup

För en helt ny databas behöver foundation-artefakterna i rotmappen appliceras
först, eftersom de timestampade migrationerna i `supabase/migrations/` bygger
vidare på dessa tabeller.

Rekommenderad basordning:

1. `supabase-migrations-foundation-talent-org.sql`
2. `supabase-migrations-foundation-roles-org-links-refactor.sql`
3. `supabase-migrations-profile-availability.sql`
4. `supabase-migrations-resume-normalized-schema.sql`
5. `supabase-migrations-resume-normalized-cutover.sql`
6. `supabase-migrations-resume-import-jobs.sql`
7. `supabase-migrations-resume-import-jobs-storage.sql`
8. `supabase-migrations-storage-buckets.sql`

Hoppa över äldre eller avsiktligt deprekerade filer vid fresh setup:

- `supabase-migrations-resumes.sql`
- `supabase-migrations-employee-availability.sql`
- legacy-filer som refererar till `profiles`, `employee`, `employees` eller
  `cms_admin`.

Applicera därefter de timestampade filerna i `supabase/migrations/` i
filnamnsordning.

Viktiga senare migrationer inkluderar:

- legal consent och audit layer.
- organisation templates, email domains och Microsoft OAuth provisioning.
- share rules och resume share links.
- billing catalog och organisation subscriptions.
- talent comments och organisation talent labels.
- tech catalog och organisation-specifika overrides.
- resume import jobs storage.
- resume search documents, jobs, semantic embeddings och job titles.

### Storage buckets

Appen använder minst följande buckets:

- `organisation-images` för logotyper, mallbilder, avatars och uppladdade fonts.
- `resume-exports` för genererade exporter. Kan bytas med
  `RESUME_EXPORTS_BUCKET`.
- importrelaterade buckets/paths skapas av migrationsfilerna för PDF-importjobb.

### Roller

Aktuella rollnycklar i appen:

- `admin`
- `organisation_admin`
- `broker`
- `employer`
- `talent`

Route-skydd ligger i `src/lib/server/routePolicy.ts`. Djupare åtkomstkontroll
för organisationer, talanger, CV och export ligger i `src/lib/server/access.ts`
och relaterade servermoduler.

## Demoorganisation

Migrationen `supabase/migrations/20260429100000_demo_organisation_reset.sql`
skapar resetfunktionen `public.reset_demo_organisation(admin_email,
talent_email)` och en demoorganisation med slug `demo`.

Kör efter att databasens migreringar är applicerade:

```sh
DEMO_ADMIN_EMAIL=demo.admin@test.se \
DEMO_ADMIN_PASSWORD='set-a-stable-password' \
DEMO_TALENT_EMAIL=demo.talent@test.se \
DEMO_TALENT_PASSWORD='set-a-stable-password' \
npm run demo:setup
```

Scriptet:

- läser även `.env` lokalt.
- skapar eller uppdaterar två Supabase Auth users.
- ger adminanvändaren rollerna `organisation_admin` och `employer`.
- ger talentanvändaren rollen `talent`.
- anropar `public.reset_demo_organisation`.

Demoorganisationen är avsedd som sandbox. Lägg inte riktig kunddata eller riktig
persondata där.

## Legal documents och consent

Skyddade appflöden kräver att användaren har accepterat de aktiva juridiska
dokumenten för sin organisation. Gate-logiken ligger i:

- `src/hooks.server.ts`
- `src/lib/server/legalGate.ts`
- `src/lib/server/legalService.ts`

Publiceringspaketet för Sverige/EU ligger i:

```text
docs/legal/2026-03-02-se-eu/
```

Kör `docs/legal/2026-03-02-se-eu/publish.sql` i Supabase SQL Editor eller via
migrationspipeline för att upserta och aktivera dokumentversionerna.

Aktiva dokument styr re-acceptance. Om någon aktiv dokumentversion ändras blir
användaren blockerad från skyddade actions tills `/legal/accept` är genomförd.

Audit events skrivs server-side via service-role client. Klienter ska inte kunna
skriva direkt till `audit_logs`.

## CV-import, sök och AI

AI-funktionerna använder `OPENAI_API_KEY`. Utan nyckel faller vissa sökflöden
tillbaka till enklare beteende, men AI-skrivstöd och PDF-import behöver nyckeln
för att fungera fullt ut.

Viktiga API:er:

- `POST /api/resumes/[id]/ai-write`
- `POST /internal/api/resumes/import-from-pdf`
- `POST /internal/api/resumes/import-from-pdf/jobs`
- `POST /internal/api/resumes/import-from-pdf/jobs/[jobId]/run`
- `POST /internal/api/resumes/search`
- `POST /internal/api/resumes/search/jobs`
- `POST /internal/api/resumes/search/jobs/[jobId]/run`
- `GET /internal/api/resumes/search/simple`

I produktion på Netlify delegeras längre jobb till:

- `netlify/functions/resume-import-from-pdf-background.ts`
- `netlify/functions/resume-search-background.ts`

Lokalt körs jobben direkt via SvelteKit-endpointsen.

Semantisk sökning kräver migrationen
`supabase/migrations/20260604120000_resume_search_semantic_embeddings.sql`,
som aktiverar `vector`-extension och skapar embeddingtabell/index.

## PDF-, Word- och delningsexport

Exportflöden:

- `GET /api/resumes/[id]/pdf`
- `GET /api/resumes/[id]/word`
- `GET /api/billing/[organisationId]/pdf`
- `GET /s/[token]/pdf`

PDF-rendering använder Chromium. I serverless används `@sparticuz/chromium`.
Lokalt försöker koden hitta Chrome/Chromium automatiskt. Om det misslyckas,
sätt någon av:

```env
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium
```

CV-delning kräver `RESUME_SHARE_SECRET`. Länkar hanteras i
`src/lib/server/resumeShares.ts` och audit-loggas vid skapande, uppdatering,
revokering och regenerering.

## Deployment

Projektet använder `@sveltejs/adapter-auto`. Netlify-konfiguration finns i
`netlify.toml` och inkluderar extra moduler/filer för Chromium och canvas i
functions-miljön.

Minimikrav för Netlify:

1. Sätt samma miljövariabler som lokalt, men med produktionsvärden.
2. Säkerställ att Supabase-migreringar och storage buckets är applicerade.
3. Publicera legal documents innan riktiga användare släpps in.
4. Kontrollera att bakgrundsfunktionerna kan läsa Supabase- och OpenAI-nycklar.
5. Testa PDF-export i deployad miljö, eftersom Chromium-path och filstorlek kan
   skilja sig från lokal körning.

## Kvalitet och felsökning

Kör alltid innan merge/deploy:

```sh
npm run check
npm run lint
npm run build
```

Vanliga problem:

- Inloggning redirectar tillbaka till `/login`: kontrollera Supabase URL,
  publishable key och auth cookies.
- Skyddade sidor redirectar till `/legal/accept`: aktiva legal docs har ändrats
  eller saknas acceptance för användarens organisation.
- Adminflöden saknar data: kontrollera `SUPABASE_SECRET_KEY` och RLS/policies.
- AI-import eller AI-skrivning failar: kontrollera `OPENAI_API_KEY` och vald
  `LLM_MODEL`.
- Semantisk sökning ger inga träffar: kontrollera `vector`-migrationen,
  embeddingtabellen och `OPENAI_EMBEDDING_MODEL`.
- PDF-export failar lokalt: installera Chrome/Chromium eller sätt `CHROME_PATH`.
- Delningslänkar fungerar inte: kontrollera att `RESUME_SHARE_SECRET` är satt
  och är samma mellan deploys.

## Underhållsnoteringar

- `package.json` heter fortfarande `kit-boilerplate`; ändra paketnamn separat om
  metadata ska matcha projektet.
- README:n beskriver nuvarande kodstruktur. Vid större schemaändringar bör
  både migrationsordning och miljövariabellistor uppdateras samtidigt.
