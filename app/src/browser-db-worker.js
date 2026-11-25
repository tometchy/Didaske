import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import queries from "./queries.json";
import config from "./app-config.json";

const dataUrl = new URL(config.basePath + "data/", self.location.origin);
let context;
let pool;
let memory;

async function fetchAsset(file) {
  const response = await fetch(new URL(file, dataUrl));
  if (!response.ok) throw new Error("DATA_UNAVAILABLE");
  return response;
}

async function initialize() {
  const manifest = await (await fetchAsset("manifest.json")).json();
  if (Number(manifest.schemaVersion) !== 1 || !/^[0-9a-f]{64}$/.test(manifest.sha256) ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0) throw new Error("UNSUPPORTED_SCHEMA");
  return { sqlite: await sqlite3InitModule(), manifest };
}

// OPFS accepts a pull callback. Verify each chunk while writing and expose the
// immutable filename only when the final size and digest match the manifest.
async function verifiedChunks(manifest) {
  const response = await fetchAsset("content.sqlite3.gz");
  const reader = response.body.getReader();
  let prefix = new Uint8Array(0);
  while (prefix.length < 2) {
    const { done, value } = await reader.read();
    if (done) throw new Error("SNAPSHOT_SIZE");
    if (!prefix.length) prefix = value;
    else {
      const joined = new Uint8Array(prefix.length + value.length);
      joined.set(prefix); joined.set(value, prefix.length); prefix = joined;
    }
  }
  const compressed = prefix[0] === 0x1f && prefix[1] === 0x8b;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(prefix); },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close(); else controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); }
  });
  const decoded = (compressed ? stream.pipeThrough(new DecompressionStream("gzip")) : stream).getReader();
  const digest = sha256.create();
  let length = 0;
  return async () => {
    const { done, value } = await decoded.read();
    if (done) {
      if (length !== manifest.bytes) throw new Error("SNAPSHOT_SIZE");
      if (bytesToHex(digest.digest()) !== manifest.sha256) throw new Error("SNAPSHOT_CHECKSUM");
      return undefined;
    }
    length += value.length;
    if (length > manifest.bytes) {
      await decoded.cancel();
      throw new Error("SNAPSHOT_SIZE");
    }
    digest.update(value);
    return value;
  };
}

async function memoryDatabase(sqlite, manifest) {
  if (memory) return memory;
  const bytes = new Uint8Array(manifest.bytes);
  const next = await verifiedChunks(manifest);
  for (let offset = 0, chunk; (chunk = await next()) !== undefined; offset += chunk.length) bytes.set(chunk, offset);
  const db = new sqlite.oo1.DB(":memory:", "c");
  const buffer = sqlite.wasm.allocFromTypedArray(bytes);
  try {
    // FREEONCLOSE transfers the allocated buffer to SQLite, including its error path.
    const rc = sqlite.capi.sqlite3_deserialize(db.pointer, "main", buffer, bytes.length, bytes.length,
      sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_READONLY);
    db.checkRc(rc);
    db.exec("PRAGMA query_only=ON");
    memory = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

async function read(name, params) {
  if (!Object.hasOwn(queries, name) || !Array.isArray(params)) throw new Error("INVALID_QUERY");
  context ??= initialize().catch(error => { context = undefined; throw error; });
  const { sqlite, manifest } = await context;
  if (navigator.locks && navigator.storage?.getDirectory && !memory) {
    const result = await navigator.locks.request("didaske-public-snapshot-v1", async () => {
      let db;
      try {
        pool ??= await sqlite.installOpfsSAHPoolVfs({ name: "didaske-public", initialCapacity: 3, preserveOnInitFailure: true });
        if (pool.isPaused()) await pool.unpauseVfs();
        const path = "/" + manifest.sha256 + ".sqlite3";
        if (!pool.getFileNames().includes(path)) await pool.importDb(path, await verifiedChunks(manifest));
        db = new pool.OpfsSAHPoolDb(path, "r");
      } catch (error) {
        if (pool && !pool.isPaused()) pool.pauseVfs();
        if (error.message === "SNAPSHOT_CHECKSUM" || error.message === "SNAPSHOT_SIZE") throw error;
        return null;
      }
      try {
        return db.selectObjects(queries[name], params);
      } finally {
        db.close();
        pool.pauseVfs();
      }
    });
    if (result !== null) return result;
  }
  const db = await memoryDatabase(sqlite, manifest);
  return db.selectObjects(queries[name], params);
}

// Await one local request at a time, including on engines without Web Locks.
let previous = Promise.resolve();
self.onmessage = ({ data: { id, name, params } }) => {
  previous = previous.then(async () => {
    try {
      self.postMessage({ id, rows: await read(name, params) });
    } catch (error) {
      self.postMessage({ id, error: error.message || "DATA_UNAVAILABLE" });
    }
  });
};
