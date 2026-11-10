// Keep a readable error state when the browser refuses the Storage getter.
// This is deliberately not an in-memory substitute for a saved choice.
export function getBrowserStorage(windowRef) {
  try {
    const storage=windowRef.localStorage;
    if (!storage || ['getItem','setItem','removeItem'].some(key=>typeof storage[key]!=='function')) {
      throw new Error('Site storage is unavailable');
    }
    return storage;
  } catch (error) {
    const unavailable=()=>{throw error;};
    return Object.freeze({getItem:unavailable,setItem:unavailable,removeItem:unavailable});
  }
}
