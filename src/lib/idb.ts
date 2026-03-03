const DB_NAME = "s3-multi-control-room";
const DB_VERSION = 1;

export const STORE_PROVIDERS = "providers";
export const STORE_META = "meta";
export const STORE_TRANSFERS = "transfers";

type StoreName =
	| typeof STORE_PROVIDERS
	| typeof STORE_META
	| typeof STORE_TRANSFERS;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onerror = () => reject(request.error);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(STORE_PROVIDERS)) {
					database.createObjectStore(STORE_PROVIDERS, { keyPath: "id" });
				}
				if (!database.objectStoreNames.contains(STORE_META)) {
					database.createObjectStore(STORE_META, { keyPath: "key" });
				}
				if (!database.objectStoreNames.contains(STORE_TRANSFERS)) {
					database.createObjectStore(STORE_TRANSFERS, { keyPath: "id" });
				}
			};
			request.onsuccess = () => resolve(request.result);
		});
	}

	return dbPromise;
}

async function withStore<T>(
	storeName: StoreName,
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
) {
	const database = await openDatabase();
	return new Promise<T>((resolve, reject) => {
		const transaction = database.transaction(storeName, mode);
		const store = transaction.objectStore(storeName);
		const request = run(store);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
}

export function idbGet<T>(storeName: StoreName, key: IDBValidKey) {
	return withStore<T | undefined>(storeName, "readonly", (store) =>
		store.get(key),
	);
}

export function idbGetAll<T>(storeName: StoreName) {
	return withStore<T[]>(storeName, "readonly", (store) => store.getAll());
}

export function idbPut<T>(storeName: StoreName, value: T) {
	return withStore<IDBValidKey>(storeName, "readwrite", (store) =>
		store.put(value),
	);
}

export function idbDelete(storeName: StoreName, key: IDBValidKey) {
	return withStore<undefined>(storeName, "readwrite", (store) =>
		store.delete(key),
	);
}

export function idbClear(storeName: StoreName) {
	return withStore<undefined>(storeName, "readwrite", (store) => store.clear());
}
