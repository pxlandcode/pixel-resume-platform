import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const loadDotenv = () => {
	const path = resolve(process.cwd(), '.env');
	let contents = '';
	try {
		contents = readFileSync(path, 'utf8');
	} catch {
		return;
	}

	for (const line of contents.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const equalsIndex = trimmed.indexOf('=');
		if (equalsIndex < 0) continue;
		const key = trimmed.slice(0, equalsIndex).trim();
		let value = trimmed.slice(equalsIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] ??= value;
	}
};

const requiredEnv = (names) => {
	for (const name of Array.isArray(names) ? names : [names]) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	throw new Error(`${Array.isArray(names) ? names.join(' or ') : names} is required.`);
};

const listAllUsers = async (admin) => {
	const users = [];
	let page = 1;
	while (true) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw error;
		users.push(...(data.users ?? []));
		if ((data.users ?? []).length < 200) break;
		page += 1;
	}
	return users;
};

const ensureUser = async (admin, payload) => {
	const users = await listAllUsers(admin);
	const existing = users.find((user) => user.email?.toLowerCase() === payload.email.toLowerCase());
	const userMetadata = {
		first_name: payload.firstName,
		last_name: payload.lastName
	};
	const appMetadata = {
		role: payload.roles[0],
		roles: payload.roles,
		active: true
	};

	if (!existing) {
		const { data, error } = await admin.auth.admin.createUser({
			email: payload.email,
			password: payload.password,
			email_confirm: true,
			user_metadata: userMetadata,
			app_metadata: appMetadata
		});
		if (error) throw error;
		return data.user;
	}

	const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
		password: payload.password,
		email_confirm: true,
		user_metadata: userMetadata,
		app_metadata: appMetadata
	});
	if (error) throw error;
	return data.user;
};

loadDotenv();

const supabaseUrl = requiredEnv('SUPABASE_URL');
const supabaseSecretKey = requiredEnv(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
const adminEmail = process.env.DEMO_ADMIN_EMAIL?.trim() || 'demo.admin@test.se';
const talentEmail = process.env.DEMO_TALENT_EMAIL?.trim() || 'demo.talent@test.se';
const adminPassword = requiredEnv('DEMO_ADMIN_PASSWORD');
const talentPassword = requiredEnv('DEMO_TALENT_PASSWORD');

const admin = createClient(supabaseUrl, supabaseSecretKey, {
	auth: {
		persistSession: false,
		autoRefreshToken: false
	}
});

await ensureUser(admin, {
	email: adminEmail,
	password: adminPassword,
	firstName: 'Demo',
	lastName: 'Admin',
	roles: ['organisation_admin', 'employer']
});

await ensureUser(admin, {
	email: talentEmail,
	password: talentPassword,
	firstName: 'Alex',
	lastName: 'Lind',
	roles: ['talent']
});

const { data, error } = await admin.rpc('reset_demo_organisation', {
	p_admin_email: adminEmail,
	p_talent_email: talentEmail
});

if (error) throw error;

console.log('Demo organisation reset complete.');
console.log(JSON.stringify(data, null, 2));
console.log(`Admin login: ${adminEmail}`);
console.log(`Talent login: ${talentEmail}`);
