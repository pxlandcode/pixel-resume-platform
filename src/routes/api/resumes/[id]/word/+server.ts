import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { ResumeService, getText } from '$lib/services/resume';
import type { LocalizedText, ResumeData, TechCategory } from '$lib/types/resume';

const toSafeFilename = (value: string) =>
	value
		.replace(/[\\/:*?"<>|]+/g, '')
		.trim()
		.replace(/\s+/g, ' ') || 'resume';

const buildFilename = async (resumeId: string, lang: 'sv' | 'en') => {
	try {
		const resume = await ResumeService.getResume(resumeId);
		if (!resume) {
			console.error('[word] Resume not found for ID:', resumeId);
			return 'Resume.doc';
		}
		const person = await ResumeService.getPerson(resume.personId);
		const name = toSafeFilename(person?.name ?? 'resume');
		const kind = lang === 'sv' ? 'CV' : 'Resume';
		const filename = `${name} - Pixel&Code - ${kind}.doc`;
		console.log('[word] Generated filename:', filename);
		return filename;
	} catch (err) {
		console.error('[word] Error generating filename:', err);
		return 'Resume.doc';
	}
};

const localize = (value: LocalizedText, lang: 'sv' | 'en') => getText(value, lang);

const renderInlineList = (items: string[]): string => {
	if (!items.length) return '';
	return items.join(', ');
};

const renderLabeledItems = (
	items: ResumeData['languages'],
	lang: 'sv' | 'en',
	title: string
): string => {
	if (!items?.length) return '';
	return `<section>
	<h3>${title}</h3>
	<ul>
		${items
			.map(
				(item) =>
					`<li><strong>${localize(item.label, lang)}:</strong> ${localize(item.value, lang)}</li>`
			)
			.join('')}
	</ul>
</section>`;
};

const renderCategories = (categories: TechCategory[]) => {
	if (!categories.length) return '';
	return categories
		.map(
			(cat) =>
				`<section><h3>${cat.name}</h3><p>${cat.skills
					.map((s) => s.trim())
					.filter(Boolean)
					.join(', ')}</p></section>`
		)
		.join('');
};

const renderHtmlSection = (
	resume: ResumeData,
	lang: 'sv' | 'en',
	profileSkills: TechCategory[],
	labelFor: (name: string, lang: 'sv' | 'en') => string
) => {
	const highlighted = resume.highlightedExperiences
		.filter((exp) => !exp.hidden)
		.map(
			(exp) => `<div class="card">
	<h3>${exp.company}</h3>
	<p><strong>${localize(exp.role, lang)}</strong></p>
	<div class="rich">${localize(exp.description, lang)}</div>
	${exp.technologies.length ? `<p class="muted">${renderInlineList(exp.technologies)}</p>` : ''}
</div>`
		)
		.join('');

	const experiences = resume.experiences
		.filter((exp) => !exp.hidden)
		.map(
			(exp) => `<div class="card">
	<div class="muted">${exp.startDate} – ${exp.endDate ?? 'Present'}</div>
	<h3>${exp.company}</h3>
	<p><strong>${localize(exp.role, lang)}</strong>${exp.location ? ` — ${localize(exp.location, lang)}` : ''}</p>
	<div class="rich">${localize(exp.description, lang)}</div>
	${exp.technologies.length ? `<p class="muted">${renderInlineList(exp.technologies)}</p>` : ''}
</div>`
		)
		.join('');

	const profileSkillSet = new Set(
		profileSkills.flatMap((cat) => cat.skills).map((skill) => skill.trim().toLowerCase())
	);
	const techniques = renderInlineList(
		resume.techniques.filter((tech) => !profileSkillSet.has(tech.trim().toLowerCase()))
	);
	const methods = renderInlineList(resume.methods);
	const categories: TechCategory[] = [
		...profileSkills.map((cat) => ({ ...cat, name: labelFor(cat.name, lang) }))
	];
	if (techniques) {
		categories.push({
			id: 'other',
			name: labelFor('other', lang),
			skills: techniques
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		});
	}
	if (methods) {
		categories.push({
			id: 'methods',
			name: labelFor('methods', lang),
			skills: methods
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		});
	}
	const nonEmptyCategories = categories.filter((cat) => (cat.skills ?? []).length > 0);

	const education = resume.education
		.map(
			(item) =>
				`<li><strong>${typeof item.label === 'string' ? item.label : localize(item.label, lang)}</strong>: ${localize(item.value, lang)}</li>`
		)
		.join('');

	const portfolio = resume.portfolio?.length
		? `<section><h3>Portfolio</h3><ul>${resume.portfolio
				.map((url) => `<li><a href="${url}">${url}</a></li>`)
				.join('')}</ul></section>`
		: '';

	return `
<div class="resume-doc">
	<header>
		<h1>${resume.name}</h1>
		<h2>${localize(resume.title, lang)}</h2>
	</header>

	<section>
		<h3>Summary</h3>
		<div class="rich">${localize(resume.summary, lang)}</div>
	</section>

	<section>
		<h3>Contacts</h3>
		<ul>
			${resume.contacts
				.map(
					(c) =>
						`<li><strong>${c.name}</strong>${c.email ? ` • ${c.email}` : ''}${c.phone ? ` • ${c.phone}` : ''}</li>`
				)
				.join('')}
		</ul>
	</section>

	<section>
		<h3>Example Skills</h3>
		<p>${renderInlineList(resume.exampleSkills)}</p>
	</section>

	<section>
		<h3>Highlighted Experience</h3>
		${highlighted}
	</section>

	<section>
		<h3>Experience</h3>
		${experiences}
	</section>

	<section>
		<h3>Skills</h3>
		${renderCategories(nonEmptyCategories)}
	</section>

	${renderLabeledItems(resume.languages, lang, lang === 'sv' ? 'Språk' : 'Languages')}
	<section>
		<h3>${lang === 'sv' ? 'Utbildning' : 'Education'}</h3>
		<ul>${education}</ul>
	</section>
	${portfolio}

	${resume.footerNote ? `<footer class="muted">${localize(resume.footerNote, lang)}</footer>` : ''}
</div>
`;
};

const DOC_STYLES = `
<style>
	* { box-sizing: border-box; }
	body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; padding: 24px; }
	h1 { font-size: 28px; margin: 0 0 4px; }
	h2 { font-size: 18px; margin: 0 0 16px; color: #334155; }
	h3 { font-size: 16px; margin: 24px 0 8px; color: #0f172a; }
	p { margin: 0 0 10px; line-height: 1.6; }
	ul { margin: 0 0 12px 18px; padding: 0; }
	.rich ul { margin: 0 0 12px 18px; }
	.rich p { margin: 0 0 12px; }
	.resume-doc { max-width: 900px; margin: 0 auto; }
	section { margin-bottom: 18px; }
	.card { border: 1px solid #e2e8f0; padding: 12px; margin-bottom: 10px; border-radius: 6px; }
	.muted { color: #64748b; font-size: 12px; }
	a { color: #2563eb; text-decoration: none; }
	a:hover { text-decoration: underline; }
</style>
`;

export const GET: RequestHandler = async ({ params, url }) => {
	const resumeId = params.id;
	if (!resumeId) {
		throw error(400, 'Invalid resume id');
	}

	const langParam = url.searchParams.get('lang');
	const lang: 'sv' | 'en' = langParam === 'en' ? 'en' : 'sv';

	const resume = await ResumeService.getResume(resumeId);
	if (!resume) {
		throw error(404, 'Resume not found');
	}
	const person = await ResumeService.getPerson(resume.personId);
	const profileSkills = person?.techStack ?? [];
	const translations: Record<string, { sv: string; en: string }> = {
		frontend: { sv: 'Frontend', en: 'Frontend' },
		backend: { sv: 'Backend', en: 'Backend' },
		tools: { sv: 'Verktyg', en: 'Tools' },
		design: { sv: 'Design', en: 'Design' },
		'ui/ux': { sv: 'UI/UX', en: 'UI/UX' },
		devops: { sv: 'DevOps', en: 'DevOps' },
		methods: { sv: 'Metoder', en: 'Methods' },
		other: { sv: 'Övrigt', en: 'Other' }
	};
	const labelFor = (name: string, l: 'sv' | 'en') => {
		const key = name.trim().toLowerCase();
		const entry = translations[key];
		return entry ? entry[l] : name;
	};

	const html = `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>Resume ${resume.title}</title>
	${DOC_STYLES}
</head>
<body>
${renderHtmlSection(resume.data, lang, profileSkills, labelFor)}
</body>
</html>`;

	const filename = await buildFilename(resumeId, lang);
	console.log('[word] Response filename:', filename, 'type:', typeof filename);

	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'application/msword',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache, no-store, must-revalidate'
		}
	});
};
