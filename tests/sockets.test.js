process.env.DB_PATH = ':memory:';

const { before, after, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { io: Client } = require('socket.io-client');
const { createApp } = require('../app');
const { resetDb, seedCourt } = require('./helpers');

let server;
let io;
let port;
const clients = [];

before(async () => {
  ({ server, io } = createApp());
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});

after(async () => {
  for (const c of clients) c.disconnect();
  io.close();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

beforeEach(async () => {
  await resetDb();
});

function connect() {
  return new Promise((resolve, reject) => {
    const socket = Client(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false
    });
    clients.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('socket scoping', () => {
  it('delivers the initial state to a client that joins the room', async () => {
    const client = await connect();
    const p = once(client, 'court:1');
    client.emit('join-court', 1);
    const data = await p;
    assert.ok(Array.isArray(data.queue));
    assert.equal(data.queue.length, 0);
    assert.equal(data.match, null);
    assert.equal(typeof data.avgDuration, 'number');
  });

  it('does not broadcast to clients outside the room', async () => {
    const a = await connect();
    const b = await connect();

    const aInit = once(a, 'court:1');
    a.emit('join-court', 1);
    await aInit;

    let bReceived = 0;
    b.on('court:1', () => bReceived++);

    a.emit('join-queue', { courtId: 1, name: 'Alice' });
    await settle();

    assert.equal(bReceived, 0, 'non-member received a scoped broadcast');
  });

  it('late joiners receive current state and then further updates', async () => {
    await seedCourt('Court A');
    const a = await connect();
    const b = await connect();

    const aInit = once(a, 'court:1');
    a.emit('join-court', 1);
    await aInit;

    a.emit('join-queue', { courtId: 1, name: 'Alice' });
    await settle();

    const bInit = once(b, 'court:1');
    b.emit('join-court', 1);
    const bState = await bInit;
    assert.deepEqual(bState.queue.map((q) => q.name), ['Alice']);

    const aP = once(a, 'court:1');
    const bP = once(b, 'court:1');
    a.emit('join-queue', { courtId: 1, name: 'Bob' });
    const [aAfter, bAfter] = await Promise.all([aP, bP]);
    assert.deepEqual(aAfter.queue.map((q) => q.name), ['Alice', 'Bob']);
    assert.deepEqual(bAfter.queue.map((q) => q.name), ['Alice', 'Bob']);
  });

  it('leaving the room stops broadcasts', async () => {
    const a = await connect();
    const b = await connect();

    const aInit = once(a, 'court:1');
    a.emit('join-court', 1);
    await aInit;
    const bInit = once(b, 'court:1');
    b.emit('join-court', 1);
    await bInit;

    b.emit('leave-court', 1);
    await settle();

    let bReceived = 0;
    b.on('court:1', () => bReceived++);
    a.emit('join-queue', { courtId: 1, name: 'Alice' });
    await settle();

    assert.equal(bReceived, 0, 'left member still received broadcasts');
  });

  it('isolates broadcasts between different courts', async () => {
    await seedCourt('Court A');
    await seedCourt('Court B');
    const a = await connect();
    const b = await connect();

    const aInit = once(a, 'court:1');
    a.emit('join-court', 1);
    await aInit;
    const bInit = once(b, 'court:2');
    b.emit('join-court', 2);
    await bInit;

    let bGotCourt1 = 0;
    b.on('court:1', () => bGotCourt1++);

    a.emit('join-queue', { courtId: 1, name: 'Alice' });
    await settle();

    assert.equal(bGotCourt1, 0, 'court 2 member received a court 1 broadcast');
  });

  it('full match lifecycle over sockets stays consistent', async () => {
    await seedCourt('Court A');
    const client = await connect();

    const aInit = once(client, 'court:1');
    client.emit('join-court', 1);
    await aInit;

    const join = (name) => {
      const p = once(client, 'court:1');
      client.emit('join-queue', { courtId: 1, name });
      return p;
    };

    let state = await join('Alice');
    state = await join('Bob');
    state = await join('Charlie');
    assert.deepEqual(state.queue.map((q) => q.name), ['Alice', 'Bob', 'Charlie']);

    // Some service methods broadcast twice; settle() drains the duplicates so
    // the next once() listener only sees the newest state.
    const startP = once(client, 'court:1');
    client.emit('start-match', 1);
    state = await startP;
    await settle();
    assert.equal(state.match.teamA, 'Alice');
    assert.equal(state.match.teamB, 'Bob');
    assert.deepEqual(state.queue.map((q) => q.name), ['Charlie']);

    const endP = once(client, 'court:1');
    client.emit('end-match', { courtId: 1, winner: 'A' });
    state = await endP;
    await settle();
    assert.equal(state.match.teamA, 'Alice'); // winner stays on first win
    assert.equal(state.match.matchesPlayedA, 1);
    assert.deepEqual(state.queue.map((q) => q.name), ['Bob']);
  });
});
