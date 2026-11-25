// Each tab owns its requests. The worker serializes shared OPFS access across tabs.
let worker;
let sequence = 0;
const waiting = new Map();

function databaseWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./browser-db-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    const request = waiting.get(data.id);
    if (!request) return;
    waiting.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.rows);
  };
  worker.onerror = () => {
    worker.terminate();
    worker = undefined;
    for (const request of waiting.values()) request.reject(new Error("DATA_UNAVAILABLE"));
    waiting.clear();
  };
  return worker;
}

export function readPublic(name, params = []) {
  return new Promise((resolve, reject) => {
    const handle = databaseWorker();
    const id = ++sequence;
    waiting.set(id, { resolve, reject });
    try {
      handle.postMessage({ id, name, params });
    } catch (error) {
      waiting.delete(id);
      reject(error);
    }
  });
}
