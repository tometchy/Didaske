import assert from 'node:assert/strict';
import test from 'node:test';
import { syncOne } from '../../app/src/notes-sync.js';
import { hashText } from '../../app/src/outbox.js';

test('Reconcile a lost PUT response without repeating a successful write', async () => {
  const row = {accountId:14,repositoryId:77,branch:'main',path:'kdzj/notes/fixture.md',markdown:'draft',baseSha:null,state:'pending',payloadHash:await hashText('draft')};
  let remote=null, writes=0, acks=0;
  const queue = {acquireLease:async () => ({fence:5}),releaseLease:async () => {},acknowledge:async (saved,proof) => {
    assert.equal(saved,row); assert.equal(proof.payloadHash,row.payloadHash); acks++;return true;
  }};
  const transport = {get:async () => remote,put:async change => { remote={markdown:change.markdown,blobSha:'sha-1'}; writes++;throw Error('lost response'); }};
  await assert.rejects(syncOne(row,transport,queue),/lost response/);
  assert.equal(acks,0);
  assert.equal(await syncOne(row,transport,queue),'synced');
  assert.equal(acks,1);assert.equal(writes,1);
});

test('Retain local and remote text on an intervening manual edit',async () => {
  const remote={markdown:'edited on GitHub',blobSha:'new'};
  const row={state:'pending',accountId:11,markdown:'local edit',baseSha:'old'};
  let recorded;
  const queue={acquireLease:async () => ({fence:1}),releaseLease:async () => {},recordRemoteConflict:async (_,r) => {recorded=r;}};
  assert.equal(await syncOne(row,{get:async () => remote,put:assert.fail},queue),'conflict');
  assert.equal(recorded,remote);
});
