const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');

// Queue page for a court
// Helper to sanitize simple text inputs (basic HTML‑entity escape)
function sanitize(str) {
  return (str || '').replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

// Queue page for a court
router.get('/:cid', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    const { court, queue, match } = await courtService.getCourtDetails(cid);
    res.json({
      queue,
      match,
      court
    });
  } catch (err) {
    if (err.message === 'Court not found') return res.redirect('/');
    res.status(500).send(err.message);
  }
});

// Join queue – validate cid and sanitize player name
router.post('/:cid/join', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  const name = sanitize(req.body.name);
  if (!name) return res.redirect(`/court/${cid}`);
  try {
    await courtService.joinQueue(cid, name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder queue – validate cid and payload shape
router.post('/:cid/reorder-queue', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  const { order } = req.body;
  if (!order || !Array.isArray(order) || !order.every(o => Number.isInteger(o.id) && Number.isInteger(o.position))) {
    return res.status(400).json({ error: 'Invalid order' });
  }
  try {
    await courtService.reorderQueue(cid, order);
    res.json({ success: true });
  } catch (err) {
    console.error('Reorder error:', err);
    res.status(500).json({ error: 'Reorder failed' });
  }
});

// Rename queue name – validate cid, id and sanitize new name
router.post('/:cid/rename/:id', async (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(id) || id <= 0) {
    return res.status(400).send('Invalid identifiers');
  }
  const newName = sanitize(req.body.name);
  if (!newName) return res.redirect(`/court/${cid}`);
  try {
    await courtService.renamePlayer(cid, id, newName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Undo last action – validate cid
router.get('/:cid/undo', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    await courtService.undoAction(cid);
    res.redirect(`/court/${cid}?msg=undone`);
  } catch (err) {
    if (err.message === 'nothing_to_undo') return res.json({ success: false, msg: 'nothing_to_undo' });
    res.status(500).send(err.message);
  }
});

// Clear queue for a court – validate cid
router.get('/:cid/clear-queue', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    await courtService.clearQueue(cid);
    res.redirect(`/court/${cid}?msg=queuecleared`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Join queue
router.post('/:cid/join', async (req, res) => {
  const cid = Number(req.params.cid);
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect(`/court/${cid}`);
  try {
    await courtService.joinQueue(cid, name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder queue via drag and drop
router.post('/:cid/reorder-queue', async (req, res) => {
  const cid = Number(req.params.cid);
  const { order } = req.body;
  if (!order || !Array.isArray(order)) {
    return res.status(400).json({ error: 'Invalid order' });
  }
  try {
    await courtService.reorderQueue(cid, order);
    res.json({ success: true });
  } catch (err) {
    console.error('Reorder error:', err);
    res.status(500).json({ error: 'Reorder failed' });
  }
});

// Rename queue name
router.post('/:cid/rename/:id', async (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);
  const newName = (req.body.name || '').trim();
  if (!newName) return res.redirect(`/court/${cid}`);
  try {
    await courtService.renamePlayer(cid, id, newName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Undo last action
router.get('/:cid/undo', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.undoAction(cid);
    res.redirect(`/court/${cid}?msg=undone`);
  } catch (err) {
    if (err.message === 'nothing_to_undo') return res.json({ success: false, msg: 'nothing_to_undo' });
    res.status(500).send(err.message);
  }
});

// Clear queue for a court
router.get('/:cid/clear-queue', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.clearQueue(cid);
    res.redirect(`/court/${cid}?msg=queuecleared`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
