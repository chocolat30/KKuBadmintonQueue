const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');
const { requireCourtAccess } = require('../helpers/courtAuth');

// Queue page for a court (password-protected courts are redirected to the open form)
router.get('/:cid', requireCourtAccess, async (req, res) => {
  try {
    const { court, queue, match } = await courtService.getCourtDetails(req.params.cid);
    res.render('queue', { court, queue, match });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Join queue – validate cid
router.post('/:cid/join', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  const name = (req.body.name || '').trim();
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

// Rename queue name – validate cid and id
router.post('/:cid/rename/:id', async (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(id) || id <= 0) {
    return res.status(400).send('Invalid identifiers');
  }
  const newName = (req.body.name || '').trim();
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
    if (err.message === 'nothing_to_undo') return res.redirect(`/court/${cid}?msg=undoerror`);
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

module.exports = router;
