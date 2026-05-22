const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');

// Home page - list of courts
router.get('/', async (req, res) => {
  try {
    const courts = await courtService.getAllCourts();
    res.render('courts', { courts });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Add courts
router.post('/courts/add', async (req, res) => {
  const name = (req.body.name || '').trim() || 'Court';
  try {
    await courtService.addCourt(name);
    res.redirect('/');
  } catch (err) {
    res.redirect('/?msg=error');
  }
});

// Delete court
router.get('/court/:cid/delete', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.deleteCourt(cid);
    res.redirect('/?msg=court_deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
