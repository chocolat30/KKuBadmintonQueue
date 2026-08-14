// helpers/courtAuth.js — shared password protection for courts
const bcrypt = require("bcryptjs");
const courtService = require("../services/courtService");

const COOKIE_MAX_AGE = 60 * 60 * 1000; // 1 hour

/**
 * Check a supplied password against a court's hash or the admin master key.
 * Open courts (no password) always pass.
 */
async function verifyCourtPassword(court, supplied) {
  if (!court.password) return true;
  const isCourtMatch = supplied ? await bcrypt.compare(supplied, court.password) : false;
  const isMasterMatch = supplied === process.env.ADMIN_MASTER_KEY;
  return isCourtMatch || isMasterMatch;
}

/** Set the access cookie for a password-protected court. */
function setCourtAuthCookie(res, court) {
  res.cookie(`court_auth_${court.uuid}`, 'true', {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });
}

/** Load the court from req.params.cid, throwing for invalid/missing courts. */
async function loadCourt(req) {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('invalid_court_id');
  const court = await courtService.getCourtById(cid);
  if (!court) throw new Error('court_not_found');
  return court;
}

/** True when the request holds the access cookie for a (possibly protected) court. */
function hasCourtAccess(court, req) {
  return !court.password || !!req.cookies[`court_auth_${court.uuid}`];
}

/**
 * Express middleware for page routes: validates :cid and redirects to the open
 * form when the court is password-protected and the visitor has no cookie.
 * On success attaches the court to req.court.
 */
async function requireCourtAccess(req, res, next) {
  try {
    const court = await loadCourt(req);
    if (!hasCourtAccess(court, req)) {
      return res.redirect(`/court/${court.id}/open`);
    }
    req.court = court;
    next();
  } catch (err) {
    if (err.message === 'invalid_court_id') return res.status(400).send('Invalid court id');
    if (err.message === 'court_not_found') return res.redirect('/');
    res.status(500).send(err.message);
  }
}

/**
 * Express middleware for API routes: validates :cid and rejects requests for
 * password-protected courts that have no access cookie. On success attaches
 * the court to req.court.
 */
async function requireCourtApiAccess(req, res, next) {
  try {
    const court = await loadCourt(req);
    if (!hasCourtAccess(court, req)) {
      return res.status(403).json({ error: 'Court is password protected' });
    }
    req.court = court;
    next();
  } catch (err) {
    if (err.message === 'invalid_court_id') return res.status(400).json({ error: 'Invalid court id' });
    if (err.message === 'court_not_found') return res.status(404).json({ error: 'Court not found' });
    res.status(500).json({ error: err.message });
  }
}

module.exports = { verifyCourtPassword, setCourtAuthCookie, requireCourtAccess, requireCourtApiAccess };
