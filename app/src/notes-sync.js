import * as local from "./outbox.js";

function pinnedFile(row) {
  const { accountId, repositoryId, branch, path } = row;
  return { accountId, repositoryId, branch, path };
}

// The native transport revalidates account, repository ownership, privacy and branch
// before touching this path. A dropped PUT response always leaves the draft queued.
export async function syncOne(operation, transport, queue = local) {
  if (operation.state !== "pending") return "conflict";
  const file = pinnedFile(operation);
  const lease = await queue.acquireLease(file.accountId, crypto.randomUUID(), 90000);
  if (!lease) return "busy";
  try {
    let remote = await transport.get(file);
    if (remote?.markdown !== operation.markdown) {
      if ((remote?.blobSha ?? null) !== operation.baseSha) {
        await queue.recordRemoteConflict(operation, remote, lease);
        return "conflict";
      }
      await transport.put({ ...file, markdown: operation.markdown, baseSha: remote?.blobSha ?? null });
      remote = await transport.get(file);
    }
    if (!remote || remote.markdown !== operation.markdown) {
      await queue.recordRemoteConflict(operation, remote, lease);
      return "conflict";
    }
    const proof = { ...file, private: true, blobSha: remote.blobSha, payloadHash: await local.hashText(remote.markdown) };
    return await queue.acknowledge(operation, proof, lease) ? "synced" : "pending";
  } finally {
    await queue.releaseLease(lease);
  }
}
