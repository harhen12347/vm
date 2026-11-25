export interface Preferences {
  scaleViewport: boolean;
}

const DATABASE_NAME = 'aether-browser-vm';
const STORE_NAME = 'preferences';
const PREFERENCES_KEY = 'desktop';
const DEFAULT_PREFERENCES: Preferences = { scaleViewport: true };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
  });
}

export async function loadPreferences(): Promise<Preferences> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(PREFERENCES_KEY);
    request.onsuccess = () => {
      const value: unknown = request.result;
      resolve(
        typeof value === 'object' && value !== null && 'scaleViewport' in value
          && typeof value.scaleViewport === 'boolean'
          ? { scaleViewport: value.scaleViewport }
          : DEFAULT_PREFERENCES
      );
    };
    request.onerror = () => reject(request.error ?? new Error('Could not read browser preferences.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not read browser preferences.'));
  });
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(preferences, PREFERENCES_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Could not save browser preferences.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Browser preference storage was aborted.'));
    };
  });
}
