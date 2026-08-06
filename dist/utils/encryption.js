/**
 * Shared encryption helpers for oxView SPA.
 * Used by historyStorageService (loading encrypted commits) and
 * commitHistoryWindow-script (sharing encrypted commits).
 */
/**
 * Reads the AES-GCM encryption key from localStorage.enc_key_data.
 * Returns null if missing or expired (24-hour TTL).
 */
export function getStoredEncryptionKey() {
    try {
        const stored = localStorage.getItem('enc_key_data');
        if (!stored)
            return null;
        const data = JSON.parse(stored);
        if (Date.now() >= data.expiresAt) {
            console.warn('Encryption key expired');
            localStorage.removeItem('enc_key_data');
            return null;
        }
        return data.key;
    }
    catch {
        return null;
    }
}
/**
 * Imports a base64-encoded AES-256-GCM key into a CryptoKey for decryption.
 */
export async function importAesKey(keyBase64) {
    const keyBuffer = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
/**
 * Decrypts an encrypted commit's data using AES-GCM.
 * Returns the decrypted ArrayBuffer, or null if key is missing/expired.
 */
export async function decryptCommitData(encryptedData, iv) {
    const keyBase64 = getStoredEncryptionKey();
    if (!keyBase64)
        return null;
    const aesKey = await importAesKey(keyBase64);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, encryptedData);
}
