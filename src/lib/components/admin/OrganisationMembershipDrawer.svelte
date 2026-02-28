<script lang="ts">
	import { Button, Select } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';

	type Organisation = {
		id: string;
		name: string;
	};

	type UserRow = {
		user_id: string;
		first_name: string;
		last_name: string;
		email: string | null;
		roles: string[];
	};

	type TalentRow = {
		id: string;
		user_id: string | null;
		first_name: string | null;
		last_name: string | null;
	};

	type UserMembership = { user_id: string };
	type TalentMembership = { talent_id: string };
	type AccessGrant = {
		id: string;
		grantee_user_id: string;
		created_at: string | null;
		created_by_user_id: string | null;
	};

	let {
		open = $bindable(false),
		organisation = undefined,
		users = [],
		talents = [],
		userMemberships = [],
		talentMemberships = [],
		accessGrants = [],
		eligibleGrantUsers = []
	}: {
		open: boolean;
		organisation?: Organisation;
		users?: UserRow[];
		talents?: TalentRow[];
		userMemberships?: UserMembership[];
		talentMemberships?: TalentMembership[];
		accessGrants?: AccessGrant[];
		eligibleGrantUsers?: UserRow[];
	} = $props();

	const userById = $derived(
		Object.fromEntries(users.map((user) => [user.user_id, user] as const)) as Record<
			string,
			UserRow
		>
	);

	const talentById = $derived(
		Object.fromEntries(talents.map((talent) => [talent.id, talent] as const)) as Record<
			string,
			TalentRow
		>
	);

	const displayUser = (userId: string) => {
		const user = userById[userId];
		if (!user) return userId;
		const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
		return name || user.email || userId;
	};

	const displayTalent = (talentId: string) => {
		const talent = talentById[talentId];
		if (!talent) return talentId;
		const name = [talent.first_name ?? '', talent.last_name ?? ''].filter(Boolean).join(' ').trim();
		return name || talent.id;
	};

	$effect(() => {
		if (!open) {
			// Reset any local state when drawer closes if needed
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Membership & access"
	subtitle="Manage home users, home talents, and cross-organisation access grants for {organisation?.name ??
		'this organisation'}."
	class="mr-0 w-full max-w-xl"
	dismissable
>
	{#if organisation}
		<div class="flex flex-col gap-6 overflow-y-auto pb-16">
			<!-- Home Users -->
			<div class="space-y-3">
				<div>
					<h3 class="text-foreground text-sm font-semibold">Home users</h3>
					<p class="text-muted-fg text-xs">Users whose primary organisation is this one.</p>
				</div>
				<form method="POST" action="?/connectUserHome" class="flex items-end gap-2">
					<input type="hidden" name="organisation_id" value={organisation.id} />
					<Select name="user_id" class="bg-input text-foreground flex-1">
						{#each users as user (user.user_id)}
							<option value={user.user_id}>
								{displayUser(user.user_id)} ({user.roles.join(', ')})
							</option>
						{/each}
					</Select>
					<Button type="submit" size="sm" variant="outline">Connect</Button>
				</form>
				<ul class="space-y-2">
					{#each userMemberships as membership (membership.user_id)}
						<li
							class="border-border bg-muted flex items-center justify-between gap-2 rounded border px-3 py-2"
						>
							<span class="text-foreground text-sm">{displayUser(membership.user_id)}</span>
							<form method="POST" action="?/disconnectUserHome">
								<input type="hidden" name="user_id" value={membership.user_id} />
								<Button type="submit" variant="ghost" size="sm">Remove</Button>
							</form>
						</li>
					{:else}
						<li class="text-muted-fg text-xs">No home users linked.</li>
					{/each}
				</ul>
			</div>

			<!-- Home Talents -->
			<div class="border-border space-y-3 border-t pt-6">
				<div>
					<h3 class="text-foreground text-sm font-semibold">Home talents</h3>
					<p class="text-muted-fg text-xs">Talents whose primary organisation is this one.</p>
				</div>
				<form method="POST" action="?/connectTalentHome" class="flex items-end gap-2">
					<input type="hidden" name="organisation_id" value={organisation.id} />
					<Select name="talent_id" class="bg-input text-foreground flex-1">
						{#each talents as talent (talent.id)}
							<option value={talent.id}>{displayTalent(talent.id)}</option>
						{/each}
					</Select>
					<Button type="submit" size="sm" variant="outline">Connect</Button>
				</form>
				<ul class="space-y-2">
					{#each talentMemberships as membership (membership.talent_id)}
						<li
							class="border-border bg-muted flex items-center justify-between gap-2 rounded border px-3 py-2"
						>
							<span class="text-foreground text-sm">{displayTalent(membership.talent_id)}</span>
							<form method="POST" action="?/disconnectTalentHome">
								<input type="hidden" name="talent_id" value={membership.talent_id} />
								<Button type="submit" variant="ghost" size="sm">Remove</Button>
							</form>
						</li>
					{:else}
						<li class="text-muted-fg text-xs">No home talents linked.</li>
					{/each}
				</ul>
			</div>

			<!-- Access Grants -->
			<div class="border-border space-y-3 border-t pt-6">
				<div>
					<h3 class="text-foreground text-sm font-semibold">Access grants</h3>
					<p class="text-muted-fg text-xs">Cross-organisation access for brokers and employers.</p>
				</div>
				<form method="POST" action="?/grantOrganisationAccess" class="flex items-end gap-2">
					<input type="hidden" name="organisation_id" value={organisation.id} />
					<Select name="user_id" class="bg-input text-foreground flex-1">
						{#each eligibleGrantUsers as user (user.user_id)}
							<option value={user.user_id}>
								{displayUser(user.user_id)} ({user.roles.join(', ')})
							</option>
						{/each}
					</Select>
					<Button type="submit" size="sm" variant="outline">Grant</Button>
				</form>
				<ul class="space-y-2">
					{#each accessGrants as grant (grant.id)}
						<li
							class="border-border bg-muted flex items-center justify-between gap-2 rounded border px-3 py-2"
						>
							<span class="text-foreground text-sm">{displayUser(grant.grantee_user_id)}</span>
							<form method="POST" action="?/revokeOrganisationAccess">
								<input type="hidden" name="grant_id" value={grant.id} />
								<Button type="submit" variant="ghost" size="sm">Revoke</Button>
							</form>
						</li>
					{:else}
						<li class="text-muted-fg text-xs">No cross-organisation grants.</li>
					{/each}
				</ul>
			</div>

			<!-- Close Button -->
			<div class="sticky bottom-0 flex justify-end bg-transparent pt-4">
				<Button
					variant="outline"
					type="button"
					onclick={() => (open = false)}
					class="bg-input hover:bg-muted/70"
				>
					Close
				</Button>
			</div>
		</div>
	{/if}
</Drawer>
