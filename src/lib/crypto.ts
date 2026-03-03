import { idbGet, idbPut, STORE_META } from "./idb";

const APP_KEY = "app-encryption-key";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

async function getAppKey() {
	const existing = await idbGet<{ key: string; value: CryptoKey }>(
		STORE_META,
		APP_KEY,
	);
	if (existing?.value) {
		return existing.value;
	}

	const generated = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);

	await idbPut(STORE_META, {
		key: APP_KEY,
		value: generated,
	});

	return generated;
}

export async function encryptSecret(value: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await getAppKey();
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoder.encode(value),
	);
	return JSON.stringify({
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(encrypted)),
	});
}

export async function decryptSecret(serialized: string) {
	const payload = JSON.parse(serialized) as {
		iv: string;
		ciphertext: string;
	};
	const key = await getAppKey();
	const decrypted = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: base64ToBytes(payload.iv),
		},
		key,
		base64ToBytes(payload.ciphertext),
	);

	return decoder.decode(decrypted);
}
