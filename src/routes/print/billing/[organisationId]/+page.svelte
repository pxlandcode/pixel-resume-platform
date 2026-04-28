<script lang="ts">
	import {
		getBillingDisplayStatusLabel,
		getBillingMetricDisplayStatus,
		getBillingPriceSuffix,
		getBillingQuantityUnitLabel
	} from '$lib/types/billing';

	let { data } = $props();

	const formatSek = (ore: number) =>
		new Intl.NumberFormat('sv-SE', {
			style: 'currency',
			currency: 'SEK',
			maximumFractionDigits: 0
		}).format(ore / 100);
	const formatPriceWithMetadata = (ore: number, metadata: Record<string, unknown> | undefined) =>
		`${formatSek(ore)}${getBillingPriceSuffix(metadata)}`;
	const formatQuantityWithMetadata = (
		quantity: number,
		metadata: Record<string, unknown> | undefined
	) => {
		const unitLabel = getBillingQuantityUnitLabel(metadata);
		return unitLabel ? `${quantity} ${unitLabel}` : String(quantity);
	};
	const formatHours = (hours: number) =>
		new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(hours);
	const formatStatus = (value: string) =>
		value === 'upgrade_recommended' ? 'Upgrade recommended' : value.replace(/_/g, ' ');
</script>

<svelte:head>
	<title>{data.organisation.name} billing</title>
</svelte:head>

<div class="billing-print-page">
	<header class="hero">
		<div>
			<p class="eyebrow">Billing statement</p>
			<h1>{data.organisation.name}</h1>
			<p class="subtle">{data.monthView.periodLabel}</p>
		</div>
		<div class="status-block">
			<div class="status-label">{data.monthView.isFrozen ? 'Frozen' : 'Draft / live'}</div>
			<div class="status-date">
				Usage as of {new Date(data.monthView.usageAsOf).toLocaleString('sv-SE')}
			</div>
		</div>
	</header>

	<section class="summary-grid">
		<div class="summary-card">
			<div class="label">Plan</div>
			<div class="value">{data.monthView.plan?.planName ?? 'No plan assigned'}</div>
			<div class="meta">
				{#if data.monthView.plan}
					{formatSek(data.monthView.plan.monthlyPriceOre)}
				{:else}
					0 SEK
				{/if}
			</div>
		</div>
		<div class="summary-card">
			<div class="label">Invoice total</div>
			<div class="value">{formatSek(data.monthView.totals.totalOre)}</div>
			<div class="meta">{data.monthView.lineItems.length} line items</div>
		</div>
		<div class="summary-card">
			<div class="label">Month state</div>
			<div class="value">{data.monthView.isFrozen ? 'Frozen' : 'Live month'}</div>
			<div class="meta">
				{data.monthView.isPartialPeriod ? 'Partial history available' : 'Full period tracked'}
			</div>
		</div>
	</section>

	<section class="section">
		<div class="section-header">
			<h2>Usage metrics</h2>
		</div>
		<table>
			<thead>
				<tr>
					<th>Metric</th>
					<th>Limit</th>
					<th>Current</th>
					<th>Max</th>
					<th>Average</th>
					<th>Over limit</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.monthView.metrics as metric (metric.key)}
					<tr>
						<td>{metric.label}</td>
						<td>{metric.limit === null ? 'Unlimited' : metric.limit}</td>
						<td>{metric.currentUsage}</td>
						<td>{metric.maxUsage}</td>
						<td>{metric.averageUsage}</td>
						<td>{formatHours(metric.durationAboveLimitHours)} h</td>
						<td>{getBillingDisplayStatusLabel(getBillingMetricDisplayStatus(metric))}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="section">
		<div class="section-header">
			<h2>Invoice preview</h2>
		</div>
		<table>
			<thead>
				<tr>
					<th>Description</th>
					<th>Type</th>
					<th>Qty</th>
					<th>Unit</th>
					<th>Total</th>
				</tr>
			</thead>
			<tbody>
				{#each data.monthView.lineItems as lineItem (`${lineItem.kind}-${lineItem.code}`)}
					<tr>
						<td>
							<div>{lineItem.name}</div>
							{#if lineItem.notes}
								<div class="cell-note">{lineItem.notes}</div>
							{/if}
						</td>
						<td>{lineItem.kind}</td>
						<td>{formatQuantityWithMetadata(lineItem.quantity, lineItem.metadata)}</td>
						<td>{formatPriceWithMetadata(lineItem.unitPriceOre, lineItem.metadata)}</td>
						<td>{formatSek(lineItem.totalPriceOre)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5">No billable items for the selected month.</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="totals">
			<div class="totals-row">
				<span>Subtotal</span>
				<span>{formatSek(data.monthView.totals.subtotalOre)}</span>
			</div>
			<div class="totals-row total">
				<span>Total</span>
				<span>{formatSek(data.monthView.totals.totalOre)}</span>
			</div>
		</div>
	</section>

	{#if data.monthView.review}
		<section class="section">
			<div class="section-header">
				<h2>Stored review</h2>
			</div>
			<div class="review-grid">
				{#each data.monthView.metrics as metric (metric.key)}
					<div class="review-card">
						<h3>{metric.label}</h3>
						<p class="review-decision">
							{data.monthView.review?.decisionFlags?.[metric.key]?.decision
								? formatStatus(data.monthView.review.decisionFlags[metric.key]?.decision ?? '')
								: getBillingDisplayStatusLabel(getBillingMetricDisplayStatus(metric))}
						</p>
						<p>{data.monthView.review?.decisionFlags?.[metric.key]?.note ?? 'No note.'}</p>
					</div>
				{/each}
			</div>
			{#if data.monthView.review.notes}
				<p class="review-notes">{data.monthView.review.notes}</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		background: #f3f1eb;
		color: #14231b;
		font-family:
			'IBM Plex Sans',
			'SF Pro Text',
			-apple-system,
			BlinkMacSystemFont,
			sans-serif;
	}

	.billing-print-page {
		min-height: 100vh;
		padding: 18mm 16mm;
		background:
			radial-gradient(circle at top right, rgba(199, 220, 210, 0.8), transparent 30%),
			linear-gradient(180deg, #f7f5ef 0%, #fbfaf6 100%);
	}

	.hero {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		padding-bottom: 18px;
		border-bottom: 1px solid rgba(20, 35, 27, 0.12);
	}

	.eyebrow {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #466053;
	}

	h1 {
		margin: 0;
		font-size: 34px;
		line-height: 1.05;
	}

	.subtle,
	.status-date,
	.cell-note,
	.review-notes {
		color: #5d6f66;
	}

	.status-block {
		min-width: 180px;
		padding: 14px 16px;
		border: 1px solid rgba(20, 35, 27, 0.12);
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.7);
	}

	.status-label {
		font-size: 16px;
		font-weight: 700;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
		margin-top: 18px;
	}

	.summary-card,
	.review-card {
		padding: 16px;
		border: 1px solid rgba(20, 35, 27, 0.1);
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.78);
	}

	.label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #5d6f66;
	}

	.value {
		margin-top: 10px;
		font-size: 22px;
		font-weight: 700;
	}

	.meta {
		margin-top: 6px;
		font-size: 13px;
		color: #5d6f66;
	}

	.section {
		margin-top: 20px;
		padding: 18px;
		border: 1px solid rgba(20, 35, 27, 0.1);
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.82);
	}

	.section-header {
		margin-bottom: 12px;
	}

	h2,
	h3 {
		margin: 0;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th,
	td {
		padding: 10px 8px;
		text-align: left;
		border-top: 1px solid rgba(20, 35, 27, 0.08);
		vertical-align: top;
	}

	thead th {
		border-top: none;
		padding-top: 0;
		color: #5d6f66;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.totals {
		margin-top: 12px;
		margin-left: auto;
		max-width: 240px;
	}

	.totals-row {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		font-size: 14px;
	}

	.totals-row.total {
		font-size: 18px;
		font-weight: 700;
		border-top: 1px solid rgba(20, 35, 27, 0.12);
		margin-top: 6px;
		padding-top: 10px;
	}

	.review-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}

	.review-decision {
		margin: 8px 0 6px;
		font-weight: 700;
	}

	.review-notes {
		margin: 14px 0 0;
		font-size: 13px;
	}

	@page {
		size: A4;
		margin: 0;
	}
</style>
