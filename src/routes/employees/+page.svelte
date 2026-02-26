<script lang="ts">
	import { Card } from '@pixelcode_/blocks/components';
	import { User, Phone, Calendar, Briefcase, Mail } from 'lucide-svelte';

	const { data } = $props();

	const employees = $derived(data.employees ?? []);
	const currentUserId = $derived(data.user?.id ?? null);
	const roles = $derived((data.roles ?? []) as string[]);
	const canViewAllProfiles = $derived(
		roles.some((role) => role === 'admin' || role === 'employer' || role === 'cms_admin')
	);
</script>

<div class="">
	<div class="mb-12">
		<h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Employees</h1>
		<p class="mt-4 text-lg text-slate-500">
			Manage employee information, payroll details, and emergency contacts.
		</p>
	</div>

	<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each employees as employee}
			{@const canView = canViewAllProfiles || (!!currentUserId && employee.id === currentUserId)}
			<svelte:element
				this={canView ? 'a' : 'div'}
				href={canView ? `/employees/${employee.id}` : undefined}
				class="block h-full"
				aria-disabled={!canView}
			>
				<Card
					class={`flex h-full flex-col overflow-hidden rounded-none transition-all ${
						canView ? 'hover:shadow-md' : 'cursor-not-allowed opacity-95'
					}`}
				>
					<div class="aspect-square w-full overflow-hidden bg-slate-100">
						{#if employee.avatar_url}
							<img
								src={employee.avatar_url}
								alt={[employee.first_name, employee.last_name].filter(Boolean).join(' ')}
								class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center text-slate-300">
								<User size={64} />
							</div>
						{/if}
					</div>

					<div class="flex flex-1 flex-col p-5">
						<div class="mb-3">
							<h3 class="text-lg font-semibold text-slate-900">
								{[employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unnamed'}
							</h3>
							{#if employee.email}
								<div class="flex items-center gap-1.5">
									<Mail size={14} />
									<p class="truncate text-sm text-slate-500">{employee.email}</p>
								</div>
							{/if}
						</div>

						<div class="mt-auto space-y-2 text-xs text-slate-500">
							{#if employee.phone}
								<div class="flex items-center gap-1.5">
									<Phone size={14} />
									<span>{employee.phone}</span>
								</div>
							{/if}
						</div>
					</div>
				</Card>
			</svelte:element>
		{/each}
	</div>

	{#if employees.length === 0}
		<div class="rounded-lg border border-dashed border-slate-300 p-12 text-center">
			<User size={48} class="mx-auto mb-4 text-slate-300" />
			<h3 class="text-lg font-medium text-slate-900">No employees found</h3>
			<p class="mt-2 text-sm text-slate-500">
				Employees will appear here once they have the employee role assigned.
			</p>
		</div>
	{/if}
</div>
