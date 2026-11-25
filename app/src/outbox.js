// Only unsent operations contain private text. Opening Pages creates no personal account.
const name = "didaske-local";
const pending = "pending_changes";
const leases = "sync_leases";
let opening;

function database() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const changes = db.createObjectStore(pending, { keyPath: ["accountId", "operationId"] });
      changes.createIndex("target", ["accountId", "repositoryId", "branch", "path"], { unique: true });
      changes.createIndex("account", "accountId");
      db.createObjectStore(leases, { keyPath: "accountId" });
      db.createObjectStore("preferences", { keyPath: ["scope", "key"] });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("STORAGE_BLOCKED")); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = undefined; };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(stores, mode, work) {
  const db = await database();
  const tx = db.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : {});
  const completion = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("STORAGE_ABORTED"));
  });
  try {
    const [value] = await Promise.all([work(tx), completion]);
    return value;
  } catch (error) {
    try { tx.abort(); } catch { /* A storage failure may have aborted already. */ }
    throw error;
  }
}

export function getPreference(scope, key) {
  return transact("preferences", "readonly", async tx =>
    (await resultOf(tx.objectStore("preferences").get([scope, key])))?.value);
}

export function setPreference(scope, key, value) {
  return transact("preferences", "readwrite", tx => resultOf(tx.objectStore("preferences").put({ scope, key, value })));
}

export function getPending(accountId) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new Error("INVALID_ACCOUNT");
  return transact(pending, "readonly", tx => resultOf(tx.objectStore(pending).index("account").getAll(accountId)));
}

export async function hashText(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export async function saveNote({ accountId, repositoryId, branch, path, markdown, baseSha = null, baseMarkdown = null }, expectedRevision) {
  if (![accountId, repositoryId].every(id => Number.isSafeInteger(id) && id > 0) ||
      typeof branch !== "string" || !branch || !/^kdzj\/notes\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.md$/i.test(path) ||
      typeof markdown !== "string" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("INVALID_NOTE");
  const payloadHash = await hashText(markdown);
  return transact(pending, "readwrite", async tx => {
    const store = tx.objectStore(pending);
    const old = await resultOf(store.index("target").get([accountId, repositoryId, branch, path]));
    const record = old ?? {
      accountId, repositoryId, branch, path, operationId: crypto.randomUUID(), revision: 0,
      formatVersion: 1, kind: "note-upsert", state: "pending", baseSha, baseMarkdown,
      createdAt: new Date().toISOString(), alternatives: []
    };
    if (record.revision !== expectedRevision || record.state === "conflict") {
      if (!old) throw new Error("STALE_EDITOR"); // Keep the caller's unsaved buffer.
      if (record.payloadHash === payloadHash || record.alternatives.some(item => item.payloadHash === payloadHash)) return record;
      record.alternatives.push({ markdown, payloadHash, expectedRevision, baseSha });
      record.state = "conflict";
    } else {
      Object.assign(record, { markdown, payloadHash });
    }
    record.updatedAt = new Date().toISOString();
    record.revision++;
    await resultOf(store.put(record));
    return record;
  });
}

export function acquireLease(accountId, ownerId, ttl = 30000) {
  if (!ownerId || !Number.isSafeInteger(ttl) || ttl < 1) throw new Error("INVALID_LEASE");
  return transact(leases, "readwrite", async tx => {
    const store = tx.objectStore(leases);
    const before = await resultOf(store.get(accountId));
    const now = Date.now();
    if (before?.ownerId && before.until > now) return null;
    const lease = { accountId, ownerId, fence: (before?.fence ?? 0) + 1, until: now + ttl };
    await resultOf(store.put(lease));
    return lease;
  });
}

function sameLease(a, b) {
  return a && b && a.ownerId === b.ownerId && a.fence === b.fence && a.accountId === b.accountId;
}

export function releaseLease(lease) {
  return transact(leases, "readwrite", async tx => {
    const store = tx.objectStore(leases);
    if (!sameLease(await resultOf(store.get(lease.accountId)), lease)) return false;
    await resultOf(store.put({ ...lease, ownerId: null, until: 0 }));
    return true;
  });
}

// proof describes a verified reread of the private file, including its exact content digest.
export function acknowledge(operation, proof, lease) {
  return transact([pending, leases], "readwrite", async tx => {
    const currentLease = await resultOf(tx.objectStore(leases).get(operation.accountId));
    if (!sameLease(currentLease, lease) || currentLease.until <= Date.now()) return false;
    const store = tx.objectStore(pending);
    const key = [operation.accountId, operation.operationId];
    const row = await resultOf(store.get(key));
    if (!row || row.state !== "pending" || row.revision !== operation.revision || row.payloadHash !== operation.payloadHash ||
        !proof?.private || !proof.blobSha || !["accountId", "repositoryId", "branch", "path", "payloadHash"].every(field => row[field] === proof[field])) return false;
    await resultOf(store.delete(key));
    return true;
  });
}

export async function exportPending(accountId) {
  return JSON.stringify({ formatVersion: 1, operations: await getPending(accountId) }, null, 2);
}

export function recordRemoteConflict(operation, remote, lease) {
  return transact([pending, leases], "readwrite", async tx => {
    const currentLease = await resultOf(tx.objectStore(leases).get(operation.accountId));
    if (!sameLease(currentLease, lease) || currentLease.until <= Date.now()) return false;
    const store = tx.objectStore(pending);
    const row = await resultOf(store.get([operation.accountId, operation.operationId]));
    if (!row || row.revision !== operation.revision) return false;
    row.remote = remote;
    row.state = "conflict";
    row.revision++;
    await resultOf(store.put(row));
    return true;
  });
}

export async function resolveNote(operation, markdown, remote) {
  const payloadHash = await hashText(markdown);
  return transact(pending, "readwrite", async tx => {
    const store = tx.objectStore(pending);
    const row = await resultOf(store.get([operation.accountId, operation.operationId]));
    if (!row || row.revision !== operation.revision || row.state !== "conflict") throw new Error("STALE_EDITOR");
    Object.assign(row, {
      revision: row.revision + 1, markdown, payloadHash, baseSha: remote?.blobSha ?? null,
      baseMarkdown: remote?.markdown ?? null, alternatives: [], state: "pending", updatedAt: new Date().toISOString()
    });
    delete row.remote;
    await resultOf(store.put(row));
    return row;
  });
}
