const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');

// Global history
router.get('/history', async (req, res) => {
  try {
    const history = await courtService.getGlobalHistory();
    res.json({ history, court: null, msg: req.query.msg });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Court specific history
router.get('/court/:cid/history', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    const history = await courtService.getCourtHistory(cid);
    const court = { id: cid, name: `Court ${cid}` }; // Basic fallback if court name not fetched
    res.render('history', { history, court, msg: req.query.msg });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Clear court history
router.get('/court/:cid/history/clear', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.clearCourtHistory(cid);
    res.redirect(`/court/${cid}/history?msg=cleared`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Clear global history
router.get('/history/clear', async (req, res) => {
  try {
    await courtService.clearGlobalHistory();
    res.redirect('/history?msg=cleared');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
