const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');

// Queue page for a court
router.get('/:cid', async (req, res) => {
  const cid = Number(req.params.cid);
  const { msg } = req.query;
  try {
    const { court, queue, match } = await courtService.getCourtDetails(cid);
    res.render('queue', {
      queue,
      match,
      court,
      msg
    });
  } catch (err) {
    if (err.message === 'Court not found') return res.redirect('/');
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
