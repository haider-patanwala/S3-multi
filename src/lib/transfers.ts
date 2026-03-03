import { idbClear, idbDelete, idbGetAll, idbPut, STORE_TRANSFERS } from "./idb";
import type { TransferRecord } from "./types";

export function listTransfers() {
	return idbGetAll<TransferRecord>(STORE_TRANSFERS).then((records) =>
		records.sort((left, right) => right.updatedAt - left.updatedAt),
	);
}

export function saveTransfer(transfer: TransferRecord) {
	return idbPut(STORE_TRANSFERS, transfer);
}

export function deleteTransfer(transferId: string) {
	return idbDelete(STORE_TRANSFERS, transferId);
}

export async function clearCompletedTransfers() {
	const transfers = await listTransfers();
	await Promise.all(
		transfers
			.filter((transfer) => transfer.status === "completed")
			.map((transfer) => deleteTransfer(transfer.id)),
	);
}

export function clearAllTransfers() {
	return idbClear(STORE_TRANSFERS);
}
