<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Button,
		FormControl,
		Input,
		Select,
		Toaster,
		toast
	} from '@pixelcode_/blocks/components';
	import {
		ArrowLeft,
		User,
		Phone,
		MapPin,
		Building2,
		CreditCard,
		Calendar,
		Shield,
		AlertTriangle,
		Save,
		Pencil,
		X,
		Key
	} from 'lucide-svelte';

	const { data, form } = $props();

	const employee = $derived(data.employee);
	const employeeInfo = $derived(data.employeeInfo);
	const emergencyContact = $derived(data.emergencyContact);
	const employmentStatuses = $derived(data.employmentStatuses ?? []);
	const canEdit = $derived(data.canEdit ?? false);
	const canEditEmployment = $derived(data.canEditEmployment ?? false);
	const isOwnProfile = $derived(data.isOwnProfile ?? false);

	let profileSaving = $state(false);
	let infoSaving = $state(false);
	let emergencySaving = $state(false);
	let passwordSaving = $state(false);

	let editingProfile = $state(false);
	let editingInfo = $state(false);
	let editingEmergency = $state(false);
	let passwordUnlocked = $state(false);

	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordError = $state<string | null>(null);

	// Helper to get employment status label
	const getStatusLabel = (statusId: number | null | undefined) => {
		if (!statusId) return '—';
		const status = employmentStatuses.find((s) => s.id === statusId);
		return status?.label ?? '—';
	};
</script>

<Toaster />

<div class="">
	<div class="mb-8">
		<Button
			variant="ghost"
			href="/employees"
			class="mb-6 pl-0 hover:bg-transparent hover:text-indigo-600"
		>
			<ArrowLeft size={16} class="mr-2" />
			Back to employees
		</Button>
	</div>

	<div class="mx-auto max-w-3xl">
		{#if !employee}
			<div class="order border-dashed border-slate-300 p-12 text-center">
				<User size={48} class="mx-auto mb-4 text-slate-300" />
				<h3 class="text-lg font-medium text-slate-900">Employee not found</h3>
				<p class="mt-2 text-sm text-slate-500">This employee does not exist or has been removed.</p>
			</div>
		{:else}
			<div class="mb-8 flex items-start gap-6">
				<div class="h-24 w-24 shrink-0 overflow-hidden border border-slate-200 bg-slate-100">
					{#if employee.avatar_url}
						<img
							src={employee.avatar_url}
							alt={[employee.first_name, employee.last_name].filter(Boolean).join(' ')}
							class="h-full w-full object-cover"
						/>
					{:else}
						<div class="flex h-full w-full items-center justify-center text-slate-300">
							<User size={40} />
						</div>
					{/if}
				</div>
				<div>
					<h1 class="text-2xl font-bold text-slate-900">
						{[employee.first_name, employee.last_name].filter(Boolean).join(' ') ||
							'Unnamed Employee'}
					</h1>
					{#if employee.email}
						<p class="mt-1 text-slate-500">{employee.email}</p>
					{/if}
					{#if data.isOwnProfile}
						<span
							class="mt-2 inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
						>
							Your profile
						</span>
					{/if}
				</div>
			</div>

			<div class="space-y-8">
				<!-- Profile Section -->
				<section class="border border-slate-200 bg-white p-6">
					<div class="mb-6 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center bg-indigo-50 text-indigo-600">
								<User size={20} />
							</div>
							<div>
								<h2 class="text-lg font-semibold text-slate-900">Profile</h2>
								<p class="text-sm text-slate-500">Basic profile information</p>
							</div>
						</div>
						{#if canEdit && !editingProfile}
							<Button variant="ghost" size="sm" onclick={() => (editingProfile = true)}>
								<Pencil size={16} class="mr-2" />
								Edit profile
							</Button>
						{:else if editingProfile}
							<Button variant="ghost" size="sm" onclick={() => (editingProfile = false)}>
								<X size={16} class="mr-2" />
								Cancel
							</Button>
						{/if}
					</div>

					{#if editingProfile}
						<form
							method="POST"
							action="?/updateProfile"
							use:enhance={() => {
								profileSaving = true;
								return async ({ result, update }) => {
									profileSaving = false;
									if (result.type === 'success') {
										toast.success?.('Profile updated') ?? toast('Profile updated');
										editingProfile = false;
									} else if (result.type === 'failure') {
										const errorMsg = (result.data as { error?: string })?.error ?? 'Update failed';
										toast.error?.(errorMsg) ?? toast(errorMsg);
									}
									await update({ reset: false });
								};
							}}
						>
							<div class="grid gap-4 sm:grid-cols-2">
								<FormControl label="First name" class="gap-2 text-sm">
									<Input
										name="first_name"
										value={employee.first_name ?? ''}
										class="bg-white text-gray-900"
									/>
								</FormControl>

								<FormControl label="Last name" class="gap-2 text-sm">
									<Input
										name="last_name"
										value={employee.last_name ?? ''}
										class="bg-white text-gray-900"
									/>
								</FormControl>
							</div>

							<div class="mt-4 flex justify-end">
								<Button
									type="submit"
									variant="primary"
									loading={profileSaving}
									loading-text="Saving…"
								>
									<Save size={16} class="mr-2" />
									Save
								</Button>
							</div>
						</form>
					{:else}
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<p class="text-sm font-medium text-slate-500">First name</p>
								<p class="mt-1 text-slate-900">{employee.first_name || '—'}</p>
							</div>
							<div>
								<p class="text-sm font-medium text-slate-500">Last name</p>
								<p class="mt-1 text-slate-900">{employee.last_name || '—'}</p>
							</div>
						</div>
					{/if}
				</section>

				<!-- Employee Info Section -->
				<section class="border border-slate-200 bg-white p-6">
					<div class="mb-6 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div
								class="flex h-10 w-10 items-center justify-center bg-emerald-50 text-emerald-600"
							>
								<Building2 size={20} />
							</div>
							<div>
								<h2 class="text-lg font-semibold text-slate-900">Employee Information</h2>
								<p class="text-sm text-slate-500">Contact, payroll, and employment details</p>
							</div>
						</div>
						{#if canEdit && !editingInfo}
							<Button variant="ghost" size="sm" onclick={() => (editingInfo = true)}>
								<Pencil size={16} class="mr-2" />
								Edit employee info
							</Button>
						{:else if editingInfo}
							<Button variant="ghost" size="sm" onclick={() => (editingInfo = false)}>
								<X size={16} class="mr-2" />
								Cancel
							</Button>
						{/if}
					</div>

					{#if editingInfo}
						<form
							method="POST"
							action="?/updateEmployeeInfo"
							use:enhance={() => {
								infoSaving = true;
								return async ({ result, update }) => {
									infoSaving = false;
									if (result.type === 'success') {
										toast.success?.('Employee info updated') ?? toast('Employee info updated');
										editingInfo = false;
									} else if (result.type === 'failure') {
										const errorMsg = (result.data as { error?: string })?.error ?? 'Update failed';
										toast.error?.(errorMsg) ?? toast(errorMsg);
									}
									await update({ reset: false });
								};
							}}
						>
							<!-- Contact -->
							<div class="mb-6">
								<h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
									<Phone size={14} />
									Contact
								</h3>
								<div class="grid gap-4 sm:grid-cols-2">
									<FormControl label="Phone" class="gap-2 text-sm">
										<Input
											name="phone"
											type="tel"
											value={employeeInfo?.phone ?? ''}
											class="bg-white text-gray-900"
										/>
									</FormControl>

									<FormControl label="Address" class="gap-2 text-sm">
										<Input
											name="address"
											value={employeeInfo?.address ?? ''}
											class="bg-white text-gray-900"
										/>
									</FormControl>
								</div>
							</div>

							<!-- Payroll -->
							<div class="mb-6">
								<h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
									<CreditCard size={14} />
									Payroll (Sweden)
								</h3>
								<div class="grid gap-4 sm:grid-cols-2">
									<FormControl label="Bank name" class="gap-2 text-sm">
										<Input
											name="bank_name"
											value={employeeInfo?.bank_name ?? ''}
											class="bg-white text-gray-900"
										/>
									</FormControl>

									<FormControl
										label="Bank account"
										class="gap-2 text-sm"
										bl="Clearing + account number"
									>
										<Input
											name="bank_account"
											value={employeeInfo?.bank_account ?? ''}
											class="bg-white text-gray-900"
										/>
									</FormControl>
								</div>
							</div>

							<!-- Employment -->
							<div class="mb-6">
								<h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
									<Calendar size={14} />
									Employment
								</h3>
								<div class="space-y-4">
									<div class="grid gap-4 sm:grid-cols-2">
										<FormControl label="Personal identity number" class="gap-2 text-sm">
											<Input
												name="personal_identity_number"
												value={employeeInfo?.personal_identity_number ?? ''}
												placeholder="YYYYMMDD-XXXX"
												class="bg-white text-gray-900"
											/>
										</FormControl>
									</div>

									<div class="grid gap-4 sm:grid-cols-2">
										<FormControl label="Start date" class="gap-2 text-sm">
											<Input
												name="start_date"
												type="date"
												value={employeeInfo?.start_date ?? ''}
												disabled={!canEditEmployment}
												class="bg-white text-gray-900"
											/>
										</FormControl>

										<FormControl label="Employment status" class="gap-2 text-sm">
											<Select
												name="employment_status_id"
												value={employeeInfo?.employment_status_id?.toString() ?? ''}
												disabled={!canEditEmployment}
												class="bg-white text-gray-900"
											>
												<option value="">Select status…</option>
												{#each employmentStatuses as status}
													<option value={status.id.toString()}>{status.label}</option>
												{/each}
											</Select>
										</FormControl>
									</div>
								</div>
							</div>

							<div class="flex justify-end">
								<Button type="submit" variant="primary" loading={infoSaving} loading-text="Saving…">
									<Save size={16} class="mr-2" />
									Save
								</Button>
							</div>
						</form>
					{:else}
						<!-- Contact -->
						<div class="mb-6">
							<h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
								<Phone size={14} />
								Contact
							</h3>
							<div class="grid gap-4 sm:grid-cols-2">
								<div>
									<p class="text-sm font-medium text-slate-500">Phone</p>
									<p class="mt-1 text-slate-900">{employeeInfo?.phone || '—'}</p>
								</div>
								<div>
									<p class="text-sm font-medium text-slate-500">Address</p>
									<p class="mt-1 text-slate-900">{employeeInfo?.address || '—'}</p>
								</div>
							</div>
						</div>

						<!-- Payroll -->
						<div class="mb-6">
							<h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
								<CreditCard size={14} />
								Payroll (Sweden)
							</h3>
							<div class="grid gap-4 sm:grid-cols-2">
								<div>
									<p class="text-sm font-medium text-slate-500">Bank name</p>
									<p class="mt-1 text-slate-900">{employeeInfo?.bank_name || '—'}</p>
								</div>
								<div>
									<p class="text-sm font-medium text-slate-500">Bank account</p>
									<p class="mt-1 text-slate-900">{employeeInfo?.bank_account || '—'}</p>
								</div>
							</div>
						</div>

						<!-- Employment -->
						<div>
							<h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
								<Calendar size={14} />
								Employment
							</h3>
							<div class="space-y-4">
								<div class="grid gap-4 sm:grid-cols-2">
									<div>
										<p class="text-sm font-medium text-slate-500">Personal identity number</p>
										<p class="mt-1 text-slate-900">
											{employeeInfo?.personal_identity_number || '—'}
										</p>
									</div>
								</div>
								<div class="grid gap-4 sm:grid-cols-2">
									<div>
										<p class="text-sm font-medium text-slate-500">Start date</p>
										<p class="mt-1 text-slate-900">{employeeInfo?.start_date || '—'}</p>
									</div>
									<div>
										<p class="text-sm font-medium text-slate-500">Employment status</p>
										<p class="mt-1 text-slate-900">
											{getStatusLabel(employeeInfo?.employment_status_id)}
										</p>
									</div>
								</div>
							</div>
						</div>
					{/if}
				</section>

				<!-- Emergency Contact Section -->
				<section class="border border-slate-200 bg-white p-6">
					<div class="mb-6 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center bg-amber-50 text-amber-600">
								<AlertTriangle size={20} />
							</div>
							<div>
								<h2 class="text-lg font-semibold text-slate-900">Emergency Contact</h2>
								<p class="text-sm text-slate-500">Person to contact in case of emergency</p>
							</div>
						</div>
						{#if canEdit && !editingEmergency}
							<Button variant="ghost" size="sm" onclick={() => (editingEmergency = true)}>
								<Pencil size={16} class="mr-2" />
								Edit emergency contact
							</Button>
						{:else if editingEmergency}
							<Button variant="ghost" size="sm" onclick={() => (editingEmergency = false)}>
								<X size={16} class="mr-2" />
								Cancel
							</Button>
						{/if}
					</div>

					{#if editingEmergency}
						<form
							method="POST"
							action="?/updateEmergencyContact"
							use:enhance={() => {
								emergencySaving = true;
								return async ({ result, update }) => {
									emergencySaving = false;
									if (result.type === 'success') {
										toast.success?.('Emergency contact updated') ??
											toast('Emergency contact updated');
										editingEmergency = false;
									} else if (result.type === 'failure') {
										const errorMsg = (result.data as { error?: string })?.error ?? 'Update failed';
										toast.error?.(errorMsg) ?? toast(errorMsg);
									}
									await update({ reset: false });
								};
							}}
						>
							<div class="grid gap-4 sm:grid-cols-3">
								<FormControl label="Name" class="gap-2 text-sm">
									<Input
										name="emergency_name"
										value={emergencyContact?.name ?? ''}
										class="bg-white text-gray-900"
									/>
								</FormControl>

								<FormControl label="Relationship" class="gap-2 text-sm">
									<Input
										name="emergency_relationship"
										value={emergencyContact?.relationship ?? ''}
										placeholder="e.g. Spouse, Parent"
										class="bg-white text-gray-900"
									/>
								</FormControl>

								<FormControl label="Phone" class="gap-2 text-sm">
									<Input
										name="emergency_phone"
										type="tel"
										value={emergencyContact?.phone ?? ''}
										class="bg-white text-gray-900"
									/>
								</FormControl>
							</div>

							<div class="mt-4 flex justify-end">
								<Button
									type="submit"
									variant="primary"
									loading={emergencySaving}
									loading-text="Saving…"
								>
									<Save size={16} class="mr-2" />
									Save
								</Button>
							</div>
						</form>
					{:else}
						<div class="grid gap-4 sm:grid-cols-3">
							<div>
								<p class="text-sm font-medium text-slate-500">Name</p>
								<p class="mt-1 text-slate-900">{emergencyContact?.name || '—'}</p>
							</div>
							<div>
								<p class="text-sm font-medium text-slate-500">Relationship</p>
								<p class="mt-1 text-slate-900">{emergencyContact?.relationship || '—'}</p>
							</div>
							<div>
								<p class="text-sm font-medium text-slate-500">Phone</p>
								<p class="mt-1 text-slate-900">{emergencyContact?.phone || '—'}</p>
							</div>
						</div>
					{/if}
				</section>

				{#if isOwnProfile}
					<!-- Password Section - Only for own profile -->
					<section class="border border-slate-200 bg-white p-6">
						<div class="mb-6 flex items-center justify-between">
							<div class="flex items-center gap-3">
								<div
									class="flex h-10 w-10 items-center justify-center bg-violet-50 text-violet-600"
								>
									<Key size={20} />
								</div>
								<div>
									<h2 class="text-lg font-semibold text-slate-900">Password</h2>
									<p class="text-sm text-slate-500">Change your account password</p>
								</div>
							</div>
							{#if !passwordUnlocked}
								<Button variant="ghost" size="sm" onclick={() => (passwordUnlocked = true)}>
									<Pencil size={16} class="mr-2" />
									Edit password
								</Button>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										passwordUnlocked = false;
										newPassword = '';
										confirmPassword = '';
										passwordError = null;
									}}
								>
									<X size={16} class="mr-2" />
									Cancel
								</Button>
							{/if}
						</div>

						{#if passwordUnlocked}
							<form
								method="POST"
								action="?/updatePassword"
								use:enhance={() => {
									passwordSaving = true;
									return async ({ result, update }) => {
										passwordSaving = false;
										if (result.type === 'success') {
											toast.success?.('Password updated') ?? toast('Password updated');
											passwordUnlocked = false;
											newPassword = '';
											confirmPassword = '';
										} else if (result.type === 'failure') {
											const errorMsg =
												(result.data as { error?: string })?.error ?? 'Update failed';
											passwordError = errorMsg;
										}
										await update({ reset: false });
									};
								}}
								onsubmit={(e) => {
									passwordError = null;

									if (!newPassword) {
										e.preventDefault();
										passwordError = 'Password is required.';
										return;
									}

									if (newPassword.length < 6) {
										e.preventDefault();
										passwordError = 'Password must be at least 6 characters.';
										return;
									}

									if (newPassword !== confirmPassword) {
										e.preventDefault();
										passwordError = 'Passwords do not match.';
										return;
									}
								}}
							>
								<div class="grid gap-4 sm:grid-cols-2">
									<FormControl label="New password" class="gap-2 text-sm">
										<Input
											name="password"
											type="password"
											minlength={6}
											bind:value={newPassword}
											class="bg-white text-gray-900"
										/>
									</FormControl>

									<FormControl label="Confirm password" class="gap-2 text-sm">
										<Input
											type="password"
											minlength={6}
											bind:value={confirmPassword}
											class="bg-white text-gray-900"
										/>
									</FormControl>
								</div>

								{#if passwordError}
									<p class="mt-2 text-sm text-red-600">{passwordError}</p>
								{/if}

								<div class="mt-4 flex justify-end">
									<Button
										type="submit"
										variant="primary"
										loading={passwordSaving}
										loading-text="Saving…"
									>
										<Save size={16} class="mr-2" />
										Save password
									</Button>
								</div>
							</form>
						{:else}
							<p class="text-sm text-slate-500">
								Your password is securely stored. Click "Unlock to change" to set a new password.
							</p>
						{/if}
					</section>
				{/if}

				{#if !canEdit}
					<div class="border border-amber-200 bg-amber-50 p-4">
						<div class="flex items-start gap-3">
							<Shield size={20} class="mt-0.5 text-amber-600" />
							<div>
								<p class="font-medium text-amber-800">View only</p>
								<p class="mt-1 text-sm text-amber-700">
									You don't have permission to edit this employee's information. Contact an admin if
									you need to make changes.
								</p>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
