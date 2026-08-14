process.env.DB_PATH = ':memory:';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const courtService = require('../services/courtService');
const { resetDb, seedCourt } = require('./helpers');
const { allAsync } = require('../helpers/dbAsync');

// Stub io that records room-scoped emits so we can assert broadcasts.
const emitted = [];
courtService.init({
  to(room) {
    return {
      emit(event, data) {
        emitted.push({ room, event, data });
      }
    };
  }
});

const lastEmit = () => emitted[emitted.length - 1];

describe('courtService', () => {
  beforeEach(async () => {
    emitted.length = 0;
    await resetDb();
  });

  it('addCourt creates courts with hashed passwords and uuids', async () => {
    await seedCourt('Open Court');
    await seedCourt('Locked', 'secret123');

    const courts = await courtService.getAllCourts();
    assert.equal(courts.length, 2);
    assert.equal(courts[0].name, 'Open Court');
    assert.equal(courts[0].password, null);
    assert.equal(courts[0].pairs, 0);

    const locked = await courtService.getCourtById(2);
    assert.ok(locked.uuid, 'uuid should be set');
    assert.notEqual(locked.password, 'secret123', 'password should be hashed');
    assert.ok(bcrypt.compareSync('secret123', locked.password));
  });

  it('getCourtById returns null for unknown courts', async () => {
    assert.equal(await courtService.getCourtById(999), null);
  });

  it('joinQueue appends players in order and broadcasts to the court room', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');

    const { queue } = await courtService.getCourtDetails(1);
    assert.deepEqual(queue.map(q => q.name), ['Alice', 'Bob']);
    assert.deepEqual(queue.map(q => q.position), [1, 2]);

    const emit = lastEmit();
    assert.equal(emit.room, 'court:1');
    assert.equal(emit.event, 'court:1');
    assert.equal(emit.data.queue.length, 2);
  });

  it('startMatch requires at least two players', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await assert.rejects(() => courtService.startMatch(1), /not_enough_players/);

    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);
    const details = await courtService.getCourtDetails(1);
    assert.equal(details.match.length, 1);
    assert.equal(details.match[0].teamA, 'Alice');
    assert.equal(details.match[0].teamB, 'Bob');
    assert.deepEqual(details.queue, []);
  });

  it('startMatch rejects when a match is already in progress', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);
    await assert.rejects(() => courtService.startMatch(1), /match_exists/);
  });

  it('updateMatchScore updates scores and rejects negative scores', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);

    await courtService.updateMatchScore(1, 'A', 1);
    let details = await courtService.getCourtDetails(1);
    assert.equal(details.match[0].matchesPlayedA, 1);

    await courtService.updateMatchScore(1, 'A', -1);
    details = await courtService.getCourtDetails(1);
    assert.equal(details.match[0].matchesPlayedA, 0);

    await assert.rejects(() => courtService.updateMatchScore(1, 'A', -1), /invalid_score/);
  });

  it('updateMatchScore rejects when there is no match', async () => {
    await seedCourt('Court A');
    await assert.rejects(() => courtService.updateMatchScore(1, 'A', 1), /no_match/);
  });

  it('endMatch keeps a winner with under 2 wins and re-enqueues the loser', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.joinQueue(1, 'Charlie');
    await courtService.startMatch(1); // Alice vs Bob, queue [Charlie]

    await courtService.endMatch(1, 'A'); // winner has 1 win -> stays

    const details = await courtService.getCourtDetails(1);
    assert.equal(details.match.length, 1);
    assert.equal(details.match[0].teamA, 'Alice');
    assert.equal(details.match[0].matchesPlayedA, 1);
    assert.equal(details.match[0].teamB, 'Charlie');
    assert.deepEqual(details.queue.map(q => q.name), ['Bob']);
  });

  it('endMatch sends a winner with 2 wins back to the queue', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.joinQueue(1, 'Charlie');
    await courtService.startMatch(1); // Alice vs Bob
    await courtService.updateMatchScore(1, 'A', 1); // 1-0

    await courtService.endMatch(1, 'A'); // winner has 2 wins -> leaves

    const details = await courtService.getCourtDetails(1);
    assert.equal(details.match.length, 1);
    assert.equal(details.match[0].teamA, 'Charlie');
    assert.equal(details.match[0].teamB, 'Bob');
    assert.deepEqual(details.queue.map(q => q.name), ['Alice']);
  });

  it('endMatch records the result in match history', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);
    await courtService.endMatch(1, 'A');

    const history = await courtService.getCourtHistory(1);
    assert.equal(history.length, 1);
    assert.equal(history[0].teamA, 'Alice');
    assert.equal(history[0].teamB, 'Bob');
    assert.equal(history[0].winner, 'Alice');
    assert.ok(history[0].duration >= 0);

    const global = await courtService.getGlobalHistory();
    assert.equal(global.length, 1);
  });

  it('endMatch rejects when there is no match', async () => {
    await seedCourt('Court A');
    await assert.rejects(() => courtService.endMatch(1, 'A'), /no_match/);
  });

  it('resetMatch returns both teams to the queue', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);
    await courtService.resetMatch(1);

    const details = await courtService.getCourtDetails(1);
    assert.deepEqual(details.match, []);
    assert.deepEqual(details.queue.map(q => q.name), ['Alice', 'Bob']);
    assert.deepEqual(details.queue.map(q => q.position), [1, 2]);
  });

  it('resetMatch rejects when there is no match', async () => {
    await seedCourt('Court A');
    await assert.rejects(() => courtService.resetMatch(1), /no_match/);
  });

  it('walkOut replaces the departing side with the next player in queue', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.joinQueue(1, 'Charlie');
    await courtService.startMatch(1); // Alice vs Bob, queue [Charlie]

    await courtService.walkOut(1, 'A');

    const details = await courtService.getCourtDetails(1);
    assert.equal(details.match[0].teamA, 'Charlie');
    assert.equal(details.match[0].teamB, 'Bob');
    assert.deepEqual(details.queue, []);
  });

  it('walkOut ends the match when the queue is empty', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);

    await courtService.walkOut(1, 'A');

    const details = await courtService.getCourtDetails(1);
    assert.deepEqual(details.match, []);
  });

  it('walkOut rejects when there is no match', async () => {
    await seedCourt('Court A');
    await assert.rejects(() => courtService.walkOut(1, 'A'), /no_match/);
  });

  it('removePlayerFromQueue removes a player and normalizes positions', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.joinQueue(1, 'Charlie');

    await courtService.removePlayerFromQueue(1, 2); // remove Bob

    const { queue } = await courtService.getCourtDetails(1);
    assert.deepEqual(queue.map(q => q.name), ['Alice', 'Charlie']);
    assert.deepEqual(queue.map(q => q.position), [1, 2]);
  });

  it('renamePlayer updates a player name', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.renamePlayer(1, 1, 'AliceRenamed');

    const { queue } = await courtService.getCourtDetails(1);
    assert.deepEqual(queue.map(q => q.name), ['AliceRenamed']);
  });

  it('clearQueue empties the queue', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.clearQueue(1);

    const { queue } = await courtService.getCourtDetails(1);
    assert.deepEqual(queue, []);
  });

  it('reorderQueue applies the given positions', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.joinQueue(1, 'Charlie');

    await courtService.reorderQueue(1, [
      { id: 3, position: 1 },
      { id: 2, position: 2 },
      { id: 1, position: 3 }
    ]);

    const { queue } = await courtService.getCourtDetails(1);
    assert.deepEqual(queue.map(q => q.name), ['Charlie', 'Bob', 'Alice']);
    assert.deepEqual(queue.map(q => q.position), [1, 2, 3]);
  });

  it('undoAction restores the previous state and throws when nothing to undo', async () => {
    await seedCourt('Court A');
    await assert.rejects(() => courtService.undoAction(1), /nothing_to_undo/);

    await courtService.joinQueue(1, 'Alice'); // snapshot of empty queue
    await courtService.joinQueue(1, 'Bob');   // snapshot of [Alice]

    await courtService.undoAction(1);
    let { queue } = await courtService.getCourtDetails(1);
    assert.deepEqual(queue.map(q => q.name), ['Alice']);

    await courtService.undoAction(1);
    ({ queue } = await courtService.getCourtDetails(1));
    assert.deepEqual(queue, []);

    await assert.rejects(() => courtService.undoAction(1), /nothing_to_undo/);
  });

  it('undoAction restores queue and match after startMatch', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1); // snapshot before match: queue [Alice, Bob]

    await courtService.undoAction(1);

    const details = await courtService.getCourtDetails(1);
    assert.deepEqual(details.match, []);
    assert.deepEqual(details.queue.map(q => q.name), ['Alice', 'Bob']);
  });

  it('deleteCourt removes the court and all related data', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);
    await courtService.endMatch(1, 'A');

    await courtService.deleteCourt(1);

    assert.deepEqual(await courtService.getAllCourts(), []);
    assert.equal(await courtService.getCourtById(1), null);
    assert.deepEqual(await courtService.getCourtHistory(1), []);
    const counts = await allAsync(`SELECT
      (SELECT COUNT(*) FROM queue) AS q,
      (SELECT COUNT(*) FROM current_match) AS m,
      (SELECT COUNT(*) FROM match_history) AS h,
      (SELECT COUNT(*) FROM undo_snapshot) AS u`);
    assert.deepEqual(counts[0], { q: 0, m: 0, h: 0, u: 0 });
  });

  it('getCourtDetails includes estimated start times for queue members', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');

    const { queue } = await courtService.getCourtDetails(1);
    for (const q of queue) {
      assert.equal(typeof q.timeUntilStart, 'number');
      assert.equal(typeof q.estimatedStartMinutes, 'number');
      assert.ok(q.estimatedStartMinutes >= 0);
    }
  });

  it('history helpers clear court and global history', async () => {
    await seedCourt('Court A');
    await courtService.joinQueue(1, 'Alice');
    await courtService.joinQueue(1, 'Bob');
    await courtService.startMatch(1);
    await courtService.endMatch(1, 'A');

    await courtService.clearCourtHistory(1);
    assert.deepEqual(await courtService.getCourtHistory(1), []);

    // endMatch keeps the match alive (winner stays), so reset it first
    await courtService.resetMatch(1);
    await courtService.startMatch(1);
    await courtService.endMatch(1, 'B');
    assert.equal((await courtService.getGlobalHistory()).length, 1);

    await courtService.clearGlobalHistory();
    assert.deepEqual(await courtService.getGlobalHistory(), []);
  });
});
