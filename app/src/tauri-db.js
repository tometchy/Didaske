export function isNative() {
  return typeof globalThis.__TAURI__?.core?.invoke === 'function';
}

export function readPublic(name, params = []) {
  if (!isNative()) throw new Error('The installed reader is required.');
  return globalThis.__TAURI__.core.invoke('read_public', { name, params });
}
