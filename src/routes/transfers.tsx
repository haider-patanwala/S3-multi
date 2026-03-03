import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { formatBytes, formatTimestamp } from "@/lib/utils";
import { transferQueryOptions } from "../lib/query-options";
import {
	clearAllTransfers,
	clearCompletedTransfers,
	deleteTransfer,
} from "../lib/transfers";

export const Route = createFileRoute("/transfers")({
	component: TransfersPage,
});

function TransfersPage() {
	const queryClient = useQueryClient();
	const transfersQuery = useQuery(transferQueryOptions);
	const transfers = transfersQuery.data ?? [];
	const runningCount = transfers.filter(
		(transfer) => transfer.status === "running",
	).length;
	const completedCount = transfers.filter(
		(transfer) => transfer.status === "completed",
	).length;
	const failedCount = transfers.filter(
		(transfer) => transfer.status === "failed",
	).length;

	const clearCompletedMutation = useMutation({
		mutationFn: clearCompletedTransfers,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["transfers"] });
		},
	});

	const clearAllMutation = useMutation({
		mutationFn: clearAllTransfers,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["transfers"] });
		},
	});

	const dismissMutation = useMutation({
		mutationFn: deleteTransfer,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["transfers"] });
		},
	});

	return (
		<div className="space-y-6">
			<section className="control-panel page-header px-5 py-5 lg:px-6 lg:py-6">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<div className="section-label">Transfers</div>
						<h2 className="page-title mt-2">Queue ledger</h2>
						<p className="page-copy mt-3 max-w-3xl">
							Upload and download metadata is persisted locally. Resume is
							best-effort and surfaced only when the object endpoint supports
							range reads.
						</p>
					</div>
					<div className="page-stat-grid">
						<div className="metric-card">
							<div className="metric-label">Running</div>
							<div className="metric-value text-2xl">{runningCount}</div>
							<div className="metric-subtle">Live activity</div>
						</div>
						<div className="metric-card">
							<div className="metric-label">Completed</div>
							<div className="metric-value text-2xl">{completedCount}</div>
							<div className="metric-subtle">Kept in local history</div>
						</div>
						<div className="metric-card">
							<div className="metric-label">Failed</div>
							<div className="metric-value text-2xl">{failedCount}</div>
							<div className="metric-subtle">Needs retry or cleanup</div>
						</div>
					</div>
				</div>
				<div className="mt-5 flex flex-wrap gap-3">
					<button
						className="button-secondary"
						onClick={() => clearCompletedMutation.mutate()}
						type="button"
					>
						Clear completed
					</button>
					<button
						className="button-danger"
						onClick={() => clearAllMutation.mutate()}
						type="button"
					>
						Clear all
					</button>
				</div>
			</section>

			<section className="control-panel px-5 py-5 lg:px-6">
				{transfers.length ? (
					<div className="space-y-3">
						{transfers.map((transfer) => {
							const progress = transfer.totalBytes
								? Math.min(
										100,
										(transfer.transferredBytes / transfer.totalBytes) * 100,
									)
								: transfer.status === "completed"
									? 100
									: 18;
							return (
								<div className="transfer-row" key={transfer.id}>
									<div className="transfer-row-top">
										<div className="min-w-0">
											<div className="transfer-row-title">
												{transfer.fileName}
											</div>
											<div className="mt-2 flex flex-wrap gap-2">
												<span className="pill">{transfer.kind}</span>
												<span className="pill">{transfer.status}</span>
												{transfer.resumeSupported ? (
													<span className="pill pill-active">
														Resume supported
													</span>
												) : (
													<span className="pill">Retry only</span>
												)}
											</div>
											<div className="transfer-row-path">
												{transfer.bucket} / {transfer.key}
											</div>
										</div>
										<div className="flex flex-wrap gap-3">
											<button
												className="button-secondary"
												onClick={() => dismissMutation.mutate(transfer.id)}
												type="button"
											>
												Dismiss
											</button>
										</div>
									</div>
									<div className="transfer-track mt-4">
										<div
											className="transfer-track-bar"
											style={{ width: `${progress}%` }}
										/>
									</div>
									<div className="transfer-row-meta">
										<div>
											{formatBytes(transfer.transferredBytes)} /{" "}
											{formatBytes(transfer.totalBytes)}
										</div>
										<div>Updated {formatTimestamp(transfer.updatedAt)}</div>
										<div>
											{transfer.errorMessage
												? `Error: ${transfer.errorMessage}`
												: "No errors"}
										</div>
										<div>
											{transfer.resumeSupported
												? "Resume (if supported)"
												: "Resume unavailable, retry restarts"}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<div className="empty-state">
						No persisted transfers yet. Start an upload or download from the
						browser to populate this ledger.
					</div>
				)}
			</section>
		</div>
	);
}
