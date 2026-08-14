const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');
const { verifyCourtPassword, setCourtAuthCookie } = require('../helpers/courtAuth');

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
  const supplied = ((req.body && req.body.password) || '').trim();
  try {
    const court = await courtService.getCourtById(cid);
    if (!court) return res.status(404).send('Court not found');

    if (court.password && !(await verifyCourtPassword(court, supplied))) {
      return res.status(403).send('Incorrect password');
    }

    await courtService.deleteCourt(cid);
    res.redirect('/?msg=court_deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/// Open a court – if the court has a password, show a small form first
router.post('/court/:cid/open', async (req, res) => {
  const cid = Number(req.params.cid);
  const supplied = ((req.body && req.body.password) || '').trim();

  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    const court = await courtService.getCourtById(cid);
    if (!court) return res.status(404).send('Court not found');

    // If the court is password-protected, verify the password
    if (court.password) {
      if (!(await verifyCourtPassword(court, supplied))) {
        return res.status(403).send('Incorrect password');
      }
      setCourtAuthCookie(res, court);
    }
    // Password ok (or court is open) -> tell client to navigate
    return res.json({ ok: true, location: `/court/${cid}` });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/court/:cid/open', async (req, res) => {
  const cid = Number(req.params.cid);
  const supplied = (req.query.password || '').trim();

  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).send('Invalid court id');
  }
  try {
    const court = await courtService.getCourtById(cid);
    if (!court) return res.redirect('/');

    // If the court is password-protected …
    if (court.password) {
      // … and no password was supplied, show the entry form
      if (!supplied) {
        return res.render('court-open-form', { cid });
      }
      if (!(await verifyCourtPassword(court, supplied))) {
        return res.status(403).send('Incorrect password');
      }
      setCourtAuthCookie(res, court);
    }
    // Password ok (or court is open) → go to the court page
    return res.redirect(`/court/${cid}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
