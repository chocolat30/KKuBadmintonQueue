const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');

/// Home page – list of courts
router.get('/', async (req, res) => {
  try {
    const courts = await courtService.getAllCourts();
    res.render('courts', { courts });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/// Add a new court (now accepts an optional password)
router.post('/courts/add', async (req, res) => {
  const name = (req.body.name || '').trim() || 'Court';
  const password = (req.body.password || '').trim();
  // Enforce max 10 characters if a password is supplied
  if (password && password.length > 10) {
    return res.redirect('/');
  }
  try {
    await courtService.addCourt(name, password);
    res.redirect('/');
  } catch (err) {
    res.redirect('/');
  }
});

/// Delete a court
router.post('/court/:cid/delete', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.deleteCourt(cid);
    res.redirect('/?msg=court_deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/// Open a court – if the court has a password, show a small form first
router.get('/court/:cid/open', async (req, res) => {
  const cid = Number(req.params.cid);
  const supplied = (req.query.password || '').trim();

  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    const court = await courtService.getCourtById(cid);
    if (!court) return res.redirect('/');

    // If the court is password‑protected …
    if (court.password) {
      // … and no password was supplied, show the entry form
      if (!supplied) {
        return res.render('court-open-form', { cid });
      }
      // Password mismatch
      if (supplied !== court.password) {
        return res.status(403).send('Incorrect password');
      }
    }
    // Password ok (or court is open) → go to the court page
    return res.redirect(`/court/${cid}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/// Queue page for a court
router.get('/:cid', async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    const { court, queue, match } = await courtService.getCourtDetails(cid);
    res.render('queue', { court, queue, match });
  } catch (err) {
    if (err.message === 'Court not found') return res.redirect('/');
    res.status(500).send(err.message);
  }
});

/// Join queue – validate cid and sanitize player name
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

/// Reorder queue – validate cid and payload shape
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

/// Rename queue name – validate cid, id and sanitize new name
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

/// Undo last action – validate cid
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

/// Clear queue for a court – validate cid
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