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
			<section className="control-panel px-5 py-5 lg:px-7 lg:py-6">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<div className="section-label">Transfers</div>
						<h2 className="mt-2 font-display text-3xl text-stone-100 uppercase tracking-[0.16em]">
							Queue ledger
						</h2>
						<p className="mt-3 max-w-3xl text-sm text-stone-300 leading-6">
							Upload and download metadata is persisted locally. Resume is
							best-effort and surfaced only when the object endpoint supports
							range reads.
						</p>
					</div>
					<div className="flex flex-wrap gap-3">
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
								<div
									className="rounded-[28px] border border-white/10 bg-white/4 px-4 py-4"
									key={transfer.id}
								>
									<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
										<div>
											<div className="font-display text-2xl text-stone-100 uppercase tracking-[0.12em]">
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
											<div className="mt-3 text-sm text-stone-400 leading-6">
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
									<div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
										<div
											className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),#ffd08b)]"
											style={{ width: `${progress}%` }}
										/>
									</div>
									<div className="mt-3 grid gap-2 text-stone-400 text-xs md:grid-cols-4">
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
					<div className="rounded-[30px] border border-white/12 border-dashed bg-white/4 px-5 py-8 text-sm text-stone-400 leading-6">
						No persisted transfers yet. Start an upload or download from the
						browser to populate this ledger.
					</div>
				)}
			</section>
		</div>
	);
}
