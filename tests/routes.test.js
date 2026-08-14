process.env.DB_PATH = ':memory:';

const { before, after, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { resetDb } = require('./helpers');
const { allAsync } = require('../helpers/dbAsync');

let server;
let base;

before(async () => {
  ({ server } = createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

beforeEach(async () => {
  await resetDb();
});

// fetch helper: manual redirects, form-encoded or JSON bodies, cookie passthrough
async function req(path, { method = 'GET', body, json, headers = {} } = {}) {
  const h = { ...headers };
  let payload;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  }
  const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
  return res;
}

// First cookie value from a Set-Cookie header
function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('routes', () => {
  it('serves health and the home page', async () => {
    const health = await req('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const home = await req('/');
    assert.equal(home.status, 200);
  });

  it('creates a court via POST /courts/add', async () => {
    const res = await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    assert.equal(res.status, 302);
    const home = await req('/');
    const html = await home.text();
    assert.ok(html.includes('Court A'));
  });

  it('shows the queue page for an existing court', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    const res = await req('/court/1');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Court A'));
  });

  it('redirects to the home page for a missing court', async () => {
    const res = await req('/court/999');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
  });

  it('joins the queue and rejects empty names', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });

    const join = await req('/court/1/join', { method: 'POST', body: { name: 'Alice' } });
    assert.equal(join.status, 200);
    assert.deepEqual(await join.json(), { success: true });

    const empty = await req('/court/1/join', { method: 'POST', body: { name: '   ' } });
    assert.equal(empty.status, 302);
  });

  it('renames and reorders queue members via POST', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    await req('/court/1/join', { method: 'POST', body: { name: 'Alice' } });
    await req('/court/1/join', { method: 'POST', body: { name: 'Bob' } });

    const rename = await req('/court/1/rename/1', { method: 'POST', body: { name: 'AliceRenamed' } });
    assert.equal(rename.status, 200);

    const reorder = await req('/court/1/reorder-queue', {
      method: 'POST',
      json: { order: [{ id: 2, position: 1 }, { id: 1, position: 2 }] }
    });
    assert.equal(reorder.status, 200);

    // The queue page renders members client-side via sockets, so verify the DB
    const renamed = await allAsync('SELECT name FROM queue WHERE id = 1');
    assert.equal(renamed[0].name, 'AliceRenamed');
    const positions = await allAsync('SELECT id, position FROM queue ORDER BY position');
    assert.deepEqual(positions.map((r) => [r.id, r.position]), [[2, 1], [1, 2]]);
  });

  it('rejects invalid reorder payloads', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    const res = await req('/court/1/reorder-queue', { method: 'POST', json: { order: 'nope' } });
    assert.equal(res.status, 400);
  });

  it('exposes match actions as POST only', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });

    const getStart = await req('/court/1/start');
    assert.equal(getStart.status, 404);

    const getEnd = await req('/court/1/end?w=A');
    assert.equal(getEnd.status, 404);
  });

  it('starts a match via POST and validates player count', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    await req('/court/1/join', { method: 'POST', body: { name: 'Alice' } });

    const tooFew = await req('/court/1/start', { method: 'POST' });
    assert.equal(tooFew.status, 409);
    assert.deepEqual(await tooFew.json(), { error: 'not_enough_players' });

    await req('/court/1/join', { method: 'POST', body: { name: 'Bob' } });
    const start = await req('/court/1/start', { method: 'POST' });
    assert.equal(start.status, 200);
    assert.deepEqual(await start.json(), { success: true });
  });

  it('validates side and winner on score and end endpoints', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    await req('/court/1/join', { method: 'POST', body: { name: 'Alice' } });
    await req('/court/1/join', { method: 'POST', body: { name: 'Bob' } });
    await req('/court/1/start', { method: 'POST' });

    const badSide = await req('/court/1/add-match/X', { method: 'POST' });
    assert.equal(badSide.status, 400);
    assert.deepEqual(await badSide.json(), { error: 'Invalid side' });

    const badWinner = await req('/court/1/end', { method: 'POST', body: { winner: 'Z' } });
    assert.equal(badWinner.status, 400);
    assert.deepEqual(await badWinner.json(), { error: 'Invalid winner' });

    const end = await req('/court/1/end', { method: 'POST', body: { winner: 'A' } });
    assert.equal(end.status, 200);
  });

  it('protects password-protected courts on the page route', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Locked', password: 'secret123' } });

    const blocked = await req('/court/1');
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get('location'), '/court/1/open');

    const form = await req('/court/1/open');
    assert.equal(form.status, 200);

    const wrong = await req('/court/1/open?password=wrong');
    assert.equal(wrong.status, 403);

    const right = await req('/court/1/open?password=secret123');
    assert.equal(right.status, 302);
    assert.equal(right.headers.get('location'), '/court/1');
    const cookie = cookieFrom(right);
    assert.ok(cookie, 'should set an auth cookie');

    const page = await req('/court/1', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
  });

  it('requires the access cookie on match API routes for protected courts', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Locked', password: 'secret123' } });

    const denied = await req('/court/1/start', { method: 'POST' });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'Court is password protected' });

    const cookieRes = await req('/court/1/open?password=secret123');
    const cookie = cookieFrom(cookieRes);
    const allowed = await req('/court/1/start', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(allowed.status, 409); // auth passed -> reaches business logic
    assert.deepEqual(await allowed.json(), { error: 'not_enough_players' });
  });

  it('requires the password to delete a protected court', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Locked', password: 'secret123' } });

    const wrong = await req('/court/1/delete', { method: 'POST', body: { password: 'nope' } });
    assert.equal(wrong.status, 403);

    const right = await req('/court/1/delete', { method: 'POST', body: { password: 'secret123' } });
    assert.equal(right.status, 302);
    assert.equal(right.headers.get('location'), '/?msg=court_deleted');
  });

  it('undo and clear-queue redirect with their messages', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    await req('/court/1/join', { method: 'POST', body: { name: 'Alice' } });

    const undo = await req('/court/1/undo');
    assert.equal(undo.status, 302);
    assert.equal(undo.headers.get('location'), '/court/1?msg=undone');

    const undoEmpty = await req('/court/1/undo');
    assert.equal(undoEmpty.status, 302);
    assert.equal(undoEmpty.headers.get('location'), '/court/1?msg=undoerror');

    const clear = await req('/court/1/clear-queue');
    assert.equal(clear.status, 302);
    assert.equal(clear.headers.get('location'), '/court/1?msg=queuecleared');
  });

  it('serves history pages', async () => {
    await req('/courts/add', { method: 'POST', body: { name: 'Court A' } });
    const global = await req('/history');
    assert.equal(global.status, 200);
    const court = await req('/court/1/history');
    assert.equal(court.status, 200);
  });

  it('rejects invalid court ids', async () => {
    const page = await req('/court/abc');
    assert.equal(page.status, 400);
    const join = await req('/court/0/join', { method: 'POST', body: { name: 'Alice' } });
    assert.equal(join.status, 400);
  });
});
