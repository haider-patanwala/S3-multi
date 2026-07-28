import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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

function Stat({ value, label }: { value: number; label: string }) {
	return (
		<span className="flex items-baseline gap-1.5 text-muted-foreground text-sm">
			<span className="font-semibold text-foreground text-lg tabular-nums">
				{value}
			</span>
			{label}
		</span>
	);
}

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
		<div className="space-y-4">
			<Card>
				<CardContent className="flex flex-wrap items-center justify-between gap-4">
					<div className="flex flex-wrap items-center gap-5">
						<Stat label="running" value={runningCount} />
						<Stat label="completed" value={completedCount} />
						<Stat label="failed" value={failedCount} />
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={!completedCount}
							onClick={() => clearCompletedMutation.mutate()}
							size="sm"
							type="button"
							variant="outline"
						>
							Clear completed
						</Button>
						<Button
							disabled={!transfers.length}
							onClick={() => clearAllMutation.mutate()}
							size="sm"
							type="button"
							variant="outline"
						>
							Clear all
						</Button>
					</div>
				</CardContent>
			</Card>

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
							<Card key={transfer.id}>
								<CardContent className="space-y-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="truncate font-medium text-sm">
												{transfer.fileName}
											</div>
											<div className="mt-2 flex flex-wrap gap-1.5">
												<Badge variant="secondary">{transfer.kind}</Badge>
												<Badge
													variant={
														transfer.status === "failed"
															? "destructive"
															: transfer.status === "completed"
																? "default"
																: "secondary"
													}
												>
													{transfer.status}
												</Badge>
												<Badge variant="outline">
													{transfer.resumeSupported
														? "Resume supported"
														: "Retry only"}
												</Badge>
											</div>
											<div className="mt-2 truncate font-mono text-muted-foreground text-xs">
												{transfer.bucket} / {transfer.key}
											</div>
										</div>
										<Button
											onClick={() => dismissMutation.mutate(transfer.id)}
											size="sm"
											type="button"
											variant="outline"
										>
											Dismiss
										</Button>
									</div>

									<Progress value={progress} />

									<div className="grid gap-1 text-muted-foreground text-xs sm:grid-cols-2 lg:grid-cols-4">
										<div>
											{formatBytes(transfer.transferredBytes)} /{" "}
											{formatBytes(transfer.totalBytes)}
										</div>
										<div>Updated {formatTimestamp(transfer.updatedAt)}</div>
										<div
											className={
												transfer.errorMessage ? "text-destructive" : ""
											}
										>
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
								</CardContent>
							</Card>
						);
					})}
				</div>
			) : (
				<Card>
					<CardContent className="py-12 text-center text-muted-foreground text-sm">
						No persisted transfers yet. Start an upload or download from the
						browser to populate this ledger.
					</CardContent>
				</Card>
			)}
		</div>
	);
}
