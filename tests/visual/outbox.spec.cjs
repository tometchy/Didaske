const { test, expect } = require('../../app/node_modules/@playwright/test');
const path = require('node:path');
const sample = { accountId: 12, repositoryId: 44, branch: 'main',
  path: 'kdzj/notes/11111111-1111-4111-8111-111111111111.md', markdown: 'one' };

test('Two windows preserve concurrent drafts and reject stale acknowledgements', async ({context,baseURL}) => {
  // Load the production module into a real origin, apart from release-gated native login.
  await context.route('**/__test__/outbox.js', r => r.fulfill({
    path: path.resolve(__dirname,'../../app/src/outbox.js'), contentType:'text/javascript'
  }));
  const a = await context.newPage(), b = await context.newPage();
  for (const p of [a,b]) {
    await p.goto(baseURL + '/en/');
    await p.evaluate(async () => { window.queue = await import('/__test__/outbox.js'); });
  }
  const saved = await a.evaluate(input => queue.saveNote(input,0), sample);
  const lease = await a.evaluate(() => queue.acquireLease(12,'a'));
  expect(await b.evaluate(() => queue.acquireLease(12,'b'))).toBeNull();
  const second = await b.evaluate(input => queue.saveNote({...input,markdown:'two'},0), sample);
  expect(second.state).toEqual('conflict');
  const proof = {...sample, private:true, payloadHash:saved.payloadHash, blobSha:'test-sha'};
  expect(await a.evaluate(args => queue.acknowledge(...args),[saved,proof,lease])).toBe(false);
  await a.evaluate(l => queue.releaseLease(l),lease);
  const newLease = await b.evaluate(() => queue.acquireLease(12,'b'));
  expect(newLease.fence).toBeGreaterThan(lease.fence);
  await a.reload();
  const restored = await a.evaluate(async () => (await import('/__test__/outbox.js')).getPending(12));
  expect(restored[0].markdown).toEqual('one');
  expect(restored[0].alternatives.map(item => item.markdown)).toEqual(['two']);
  const isolated = await a.evaluate(async () => (await import('/__test__/outbox.js')).getPending(13));
  expect(isolated).toEqual([]);
  const clean = await b.evaluate(input => queue.saveNote({...input,path:input.path.replace('4111','4222')},0),sample);
  const cleanProof = {...proof,path:clean.path,payloadHash:clean.payloadHash};
  expect(await b.evaluate(args => queue.acknowledge(...args),[clean,cleanProof,lease])).toBe(false);
  expect(await b.evaluate(args => queue.acknowledge(...args),[clean,{...cleanProof,private:false},newLease])).toBe(false);
  expect(await b.evaluate(args => queue.acknowledge(...args),[clean,cleanProof,newLease])).toBe(true);
  expect((await b.evaluate(() => queue.getPending(12))).map(x=>x.operationId)).toEqual([saved.operationId]);
});
