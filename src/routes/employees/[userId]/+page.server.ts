import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { siteMeta } from '$lib/seo';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	const { userId } = params;
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return {
			employee: null,
			employeeInfo: null,
			emergencyContact: null,
			employmentStatuses: [],
			canEdit: false,
			meta: null
		};
	}

	// Get current user to check permissions
	const {
		data: { user: currentUser }
	} = await supabase.auth.getUser();

	// Fetch user roles
	const { data: userRoles } = await adminClient
		.from('user_roles')
		.select('role')
		.eq('user_id', currentUser?.id ?? '');

	const roles = (userRoles ?? []).map((r) => r.role);
	const isAdmin = roles.includes('admin');
	const isEmployer = roles.includes('employer');
	const isCmsAdmin = roles.includes('cms_admin');
	const isOwnProfile = currentUser?.id === userId;

	// Employees without elevated roles can only view their own profile.
	if (!isAdmin && !isEmployer && !isCmsAdmin && !isOwnProfile) {
		const destination = currentUser?.id
			? `/employees/${currentUser.id}`
			: '/employees';
		throw redirect(303, destination);
	}

	// Can edit if: admin, employer, or own profile
	const canEdit = isAdmin || isEmployer || isOwnProfile;
	// Only admin/employer can edit employment details (start date, status, personal identity number)
	const canEditEmployment = isAdmin || isEmployer;

	// Fetch employee data
	const [
		profileResult,
		authUserResult,
		employeeInfoResult,
		emergencyContactResult,
		statusesResult
	] = await Promise.all([
		adminClient.from('profiles').select('*').eq('id', userId).single(),
		adminClient.auth.admin.getUserById(userId),
		adminClient.from('employee_info').select('*').eq('user_id', userId).single(),
		adminClient.from('employee_emergency_contact').select('*').eq('user_id', userId).single(),
		supabase.from('employment_statuses').select('id, key, label').order('id')
	]);

	const profile = profileResult.data;
	const authUser = authUserResult.data?.user;

	if (!profile && !authUser) {
		return {
			employee: null,
			employeeInfo: null,
			emergencyContact: null,
			employmentStatuses: [],
			canEdit: false,
			meta: null
		};
	}

	const employee = {
		id: userId,
		first_name: profile?.first_name ?? '',
		last_name: profile?.last_name ?? '',
		avatar_url: profile?.avatar_url ?? null,
		email: authUser?.email ?? null
	};

	return {
		employee,
		employeeInfo: employeeInfoResult.data ?? null,
		emergencyContact: emergencyContactResult.data ?? null,
		employmentStatuses: statusesResult.data ?? [],
		canEdit,
		canEditEmployment,
		isOwnProfile,
		meta: {
			title: `${siteMeta.name} — ${employee.first_name} ${employee.last_name}`.trim() || 'Employee',
			description: 'View and manage employee information.',
			noindex: true,
			path: `/employees/${userId}`
		}
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, params, cookies }) => {
		const { userId } = params;
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(500, { error: 'Server error' });
		}

		// Check permissions
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		const { data: userRoles } = await adminClient
			.from('user_roles')
			.select('role')
			.eq('user_id', currentUser?.id ?? '');

		const roles = (userRoles ?? []).map((r) => r.role);
		const isAdmin = roles.includes('admin');
		const isEmployer = roles.includes('employer');
		const isOwnProfile = currentUser?.id === userId;

		if (!isAdmin && !isEmployer && !isOwnProfile) {
			return fail(403, { error: 'Not authorized' });
		}

		const formData = await request.formData();
		const firstName = formData.get('first_name')?.toString() ?? '';
		const lastName = formData.get('last_name')?.toString() ?? '';

		const { error } = await adminClient
			.from('profiles')
			.update({
				first_name: firstName,
				last_name: lastName,
				updated_at: new Date().toISOString()
			})
			.eq('id', userId);

		if (error) {
			return fail(500, { error: error.message });
		}

		return { success: true, message: 'Profile updated' };
	},

	updateEmployeeInfo: async ({ request, params, cookies }) => {
		const { userId } = params;
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(500, { error: 'Server error' });
		}

		// Check permissions
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		const { data: userRoles } = await adminClient
			.from('user_roles')
			.select('role')
			.eq('user_id', currentUser?.id ?? '');

		const roles = (userRoles ?? []).map((r) => r.role);
		const isAdmin = roles.includes('admin');
		const isEmployer = roles.includes('employer');
		const isOwnProfile = currentUser?.id === userId;

		if (!isAdmin && !isEmployer && !isOwnProfile) {
			return fail(403, { error: 'Not authorized' });
		}

		const formData = await request.formData();
		const phone = formData.get('phone')?.toString() ?? '';
		const address = formData.get('address')?.toString() ?? '';
		const bankName = formData.get('bank_name')?.toString() ?? '';
		const bankAccount = formData.get('bank_account')?.toString() ?? '';
		const personalIdentityNumber = formData.get('personal_identity_number')?.toString() ?? '';
		const startDate = formData.get('start_date')?.toString() || null;
		const employmentStatusId = formData.get('employment_status_id')?.toString();

		const employeeData = {
			user_id: userId,
			phone,
			address,
			bank_name: bankName,
			bank_account: bankAccount,
			personal_identity_number: personalIdentityNumber,
			start_date: startDate,
			employment_status_id: employmentStatusId ? parseInt(employmentStatusId, 10) : null,
			updated_at: new Date().toISOString()
		};

		const { error } = await adminClient.from('employee_info').upsert(employeeData, {
			onConflict: 'user_id'
		});

		if (error) {
			return fail(500, { error: error.message });
		}

		return { success: true, message: 'Employee info updated' };
	},

	updateEmergencyContact: async ({ request, params, cookies }) => {
		const { userId } = params;
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(500, { error: 'Server error' });
		}

		// Check permissions
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		const { data: userRoles } = await adminClient
			.from('user_roles')
			.select('role')
			.eq('user_id', currentUser?.id ?? '');

		const roles = (userRoles ?? []).map((r) => r.role);
		const isAdmin = roles.includes('admin');
		const isEmployer = roles.includes('employer');
		const isOwnProfile = currentUser?.id === userId;

		if (!isAdmin && !isEmployer && !isOwnProfile) {
			return fail(403, { error: 'Not authorized' });
		}

		const formData = await request.formData();
		const name = formData.get('emergency_name')?.toString() ?? '';
		const relationship = formData.get('emergency_relationship')?.toString() ?? '';
		const phone = formData.get('emergency_phone')?.toString() ?? '';

		const contactData = {
			user_id: userId,
			name,
			relationship,
			phone
		};

		const { error } = await adminClient.from('employee_emergency_contact').upsert(contactData, {
			onConflict: 'user_id'
		});

		if (error) {
			return fail(500, { error: error.message });
		}

		return { success: true, message: 'Emergency contact updated' };
	},

	updatePassword: async ({ request, params, cookies }) => {
		const { userId } = params;
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(500, { error: 'Server error' });
		}

		// Check permissions - only own profile can change password
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		if (currentUser?.id !== userId) {
			return fail(403, { error: 'You can only change your own password' });
		}

		const formData = await request.formData();
		const password = formData.get('password')?.toString();

		if (!password || password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters' });
		}

		const { error } = await adminClient.auth.admin.updateUserById(userId, {
			password
		});

		if (error) {
			return fail(500, { error: error.message });
		}

		return { success: true, message: 'Password updated' };
	}
};
