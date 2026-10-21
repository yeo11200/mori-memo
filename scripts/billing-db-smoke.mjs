import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const bin = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@18/bin';
const root = await mkdtemp('/tmp/mori-billing-pg-');
const data = join(root, 'data');
const psql = async sql => (await run(join(bin, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', root, '-p', '55439', '-U', 'mori_test', '-d', 'postgres', '-c', sql])).stdout.trim();
await run(join(bin, 'initdb'), ['-D', data, '-U', 'mori_test', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
await run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-F -k ${root} -h '' -p 55439`, '-w', 'start']);
try {
  await psql('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);');
  await psql(await readFile('server/billing/migrations/001_billing.sql', 'utf8'));
  await psql(await readFile('server/billing/migrations/002_sharing.sql', 'utf8'));
  const user = randomUUID();
  await psql(`insert into auth.users values ('${user}');`);
  const base = { id: user, revision: 0, email: 'fixture@example.com', devices: [], attempts: [], trialEnd: null, paidUntil: null, cancelAtEnd: false };
  const literal = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  await psql(`set role service_role; select mori_billing_ensure('${user}',${literal(base)});`);
  const cas = value => `set role service_role; select mori_billing_cas('${user}',0,${literal(value)},null);`;
  const concurrent = await Promise.all([psql(cas({ ...base, revision: 1, trialEnd: '2026-11-03T00:00:00Z' })), psql(cas({ ...base, revision: 1, trialEnd: '2026-11-04T00:00:00Z' }))]);
  assert.deepEqual(concurrent.sort(), ['f', 't']);
  assert.equal(await psql('set role service_role; select count(*) from mori_billing_audit;'), '1');
  assert.equal(await psql("set role service_role; select mori_billing_rate('test',1,60); select mori_billing_rate('test',1,60);"), 't\nf');
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(psql(`set role ${role}; select state from mori_billing_accounts;`));
    await assert.rejects(psql(`set role ${role}; select mori_billing_cas('${user}',0,${literal({ ...base, revision: 1 })},null);`));
  }
  const bad = { ...base, id: randomUUID(), revision: 2 };
  await assert.rejects(psql(`set role service_role; select mori_billing_cas('${user}',1,${literal(bad)},null);`));
  assert.equal(await psql(`set role service_role; select revision from mori_billing_accounts where user_id='${user}';`), '1');
  const shareId = randomUUID(); const source = 'a'.repeat(64); const token = 'A'.repeat(43);
  const mutate = (operation, revision, nextToken = token) => `set role service_role; select revision from mori_share_mutate('${user}','${source}','${operation}',${revision},'${shareId}','${nextToken}','공유 문서','공개 본문','digest');`;
  assert.equal(await psql(mutate('create', 0)), '1');
  assert.equal(await psql(mutate('create', 0)), '1');
  const updates = await Promise.allSettled([psql(mutate('update', 1)), psql(mutate('update', 1))]);
  assert.equal(updates.filter(result=>result.status==='fulfilled').length, 1);
  assert.equal(await psql(mutate('revoke', 2)), '3');
  assert.equal(await psql(`set role service_role; select body='' and revoked from mori_shares where id='${shareId}';`), 't');
  assert.equal(await psql(mutate('create', 3, 'B'.repeat(43))), '4');
  assert.equal(await psql(`set role service_role; select count(*) from mori_shares where token='${token}' and not revoked;`), '0');
  for (const role of ['anon','authenticated']) await assert.rejects(psql(`set role ${role}; select * from mori_shares;`));
  const quotaUser = randomUUID(); await psql(`insert into auth.users values ('${quotaUser}');`);
  await psql(`set role service_role; do $$ begin for i in 1..20 loop perform mori_share_mutate('${quotaUser}',lpad(to_hex(i),64,'0'),'create',0,gen_random_uuid(),lpad(i::text,43,'Q'),'문서','본문','hash'); end loop; end $$;`);
  await assert.rejects(psql(`set role service_role; select * from mori_share_mutate('${quotaUser}','${'f'.repeat(64)}','create',0,gen_random_uuid(),'${'Z'.repeat(43)}','초과','본문','hash');`));
  console.log(JSON.stringify({ ok: true, checks: ['migration', 'concurrent CAS', 'audit', 'atomic rate limit', 'client role denial', 'identity guard', 'share migration', 'share idempotency', 'share revision conflict', 'revoke erases body', 'republish rotates token', 'share role isolation', 'active share quota'], root }));
} finally {
  await run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
}
