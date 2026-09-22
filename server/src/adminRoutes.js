import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { authenticate, authorize, asyncHandler, httpError } from './middleware.js';
import { Auction, AuctionEvent, Ball, Bid, Gallery, Match, Player, Setting, SyncCache, Team, Tournament, User } from './models.js';
import { getAuctionState, startPlayer } from './services/auction.js';
import { runCricHeroesSync } from './services/cricheroes.js';
import { config } from './config.js';

const router = Router();
router.use(authenticate, authorize('admin'));

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const pick = (body, fields) => Object.fromEntries(fields.filter((key) => hasOwn(body, key)).map((key) => [key, body[key]]));
const ensureObjectId = (value, label = 'id') => {
  if (!mongoose.isValidObjectId(value)) throw httpError(400, `Invalid ${label}`);
  return value;
};
const ensureExists = async (Model, value, label) => {
  if (value == null || value === '') return null;
  const id = ensureObjectId(value, label); if (!(await Model.exists({ _id: id }))) throw httpError(400, `${label} does not exist`); return id;
};
const cleanText = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : value;
const cleanMedia = (body) => {
  for (const key of ['logo', 'photo', 'imageUrl', 'cricheroesUrl']) if (hasOwn(body, key)) body[key] = cleanText(body[key], 2000);
  return body;
};
const omitEmpty = (body, fields) => { for (const field of fields) if (body[field] === '' || body[field] == null) delete body[field]; return body; };
const pagination = (req) => ({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(200, Math.max(1, Number(req.query.limit) || 50)) });
async function list(Model, req, filter = {}, query = Model.find(filter)) {
  const { page, limit } = pagination(req);
  const [items, total] = await Promise.all([query.skip((page - 1) * limit).limit(limit).lean(), Model.countDocuments(filter)]);
  return { items, total, page, pages: Math.ceil(total / limit) || 1 };
}
const returnUpdated = async (Model, id, update, res, populate = '') => {
  const query = Model.findByIdAndUpdate(ensureObjectId(id), update, { new: true, runValidators: true });
  if (populate) query.populate(populate);
  const row = await query;
  if (!row) throw httpError(404, 'Record not found');
  res.json(row);
};

router.get('/overview', asyncHandler(async (_req, res) => {
  const [teams, players, matches, gallery, users, auctions, liveMatches, pendingPlayers] = await Promise.all([
    Team.countDocuments(), Player.countDocuments(), Match.countDocuments(), Gallery.countDocuments(), User.countDocuments(), Auction.countDocuments(), Match.countDocuments({ status: 'live' }), Player.countDocuments({ auctionState: 'pending' }),
  ]);
  res.json({ teams, players, matches, gallery, users, auctions, liveMatches, pendingPlayers });
}));

// Teams
router.get('/teams', asyncHandler(async (req, res) => {
  const filter = req.query.q ? { name: { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  res.json(await list(Team, req, filter, Team.find(filter).sort({ name: 1 })));
}));
router.get('/teams/:id', asyncHandler(async (req, res) => {
  const team = await Team.findById(ensureObjectId(req.params.id)).lean(); if (!team) throw httpError(404, 'Team not found');
  res.json({ ...team, squad: await Player.find({ team: team._id }).select('-syncedData').sort({ name: 1 }).lean() });
}));
router.post('/teams', asyncHandler(async (req, res) => {
  const data = cleanMedia(pick(req.body, ['name', 'shortName', 'logo', 'color', 'manager', 'purseStart', 'purseBalance', 'spent', 'squadLimit', 'stats', 'cricheroesId', 'cricheroesUrl', 'source', 'manualOverrides']));
  omitEmpty(data, ['color', 'purseStart', 'purseBalance', 'spent', 'squadLimit', 'stats', 'source']);
  data.name = cleanText(data.name); data.shortName = cleanText(data.shortName, 10)?.toUpperCase();
  if (data.purseStart != null && data.purseBalance == null) data.purseBalance = data.purseStart;
  res.status(201).json(await Team.create(data));
}));
router.patch('/teams/:id', asyncHandler(async (req, res) => {
  const data = cleanMedia(pick(req.body, ['name', 'shortName', 'logo', 'color', 'manager', 'purseStart', 'purseBalance', 'spent', 'squadLimit', 'stats', 'cricheroesId', 'cricheroesUrl', 'source', 'manualOverrides']));
  omitEmpty(data, ['color', 'purseStart', 'purseBalance', 'spent', 'squadLimit', 'stats', 'source']);
  if (data.name != null) data.name = cleanText(data.name); if (data.shortName != null) data.shortName = cleanText(data.shortName, 10)?.toUpperCase();
  await returnUpdated(Team, req.params.id, data, res);
}));
router.delete('/teams/:id', asyncHandler(async (req, res) => {
  const id = ensureObjectId(req.params.id);
  const dependencies = await Promise.all([Player.countDocuments({ team: id }), Match.countDocuments({ $or: [{ teamA: id }, { teamB: id }] }), User.countDocuments({ team: id }), Auction.countDocuments({ highestBidder: id }), Bid.countDocuments({ team: id }), AuctionEvent.countDocuments({ team: id })]);
  if (dependencies.some(Boolean)) throw httpError(409, 'Team is referenced by players, matches, users, or auction history and cannot be deleted');
  if (!(await Team.findByIdAndDelete(id))) throw httpError(404, 'Team not found'); res.json({ deleted: true, id });
}));

// Players and dependency-safe CSV import
router.get('/players', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.q) filter.name = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (req.query.role) filter.role = req.query.role; if (req.query.category) filter.category = req.query.category; if (req.query.state) filter.auctionState = req.query.state;
  res.json(await list(Player, req, filter, Player.find(filter).populate('team', 'name shortName').sort({ name: 1 })));
}));
router.get('/players/:id', asyncHandler(async (req, res) => { const row = await Player.findById(ensureObjectId(req.params.id)).populate('team'); if (!row) throw httpError(404, 'Player not found'); res.json(row); }));
const playerFields = ['name', 'photo', 'role', 'battingStyle', 'bowlingStyle', 'rating', 'category', 'basePrice', 'soldPrice', 'team', 'auctionState', 'stats', 'cricheroesId', 'cricheroesUrl', 'source', 'manualOverrides'];
router.post('/players', asyncHandler(async (req, res) => { const data = cleanMedia(pick(req.body, playerFields)); omitEmpty(data, ['rating', 'category', 'soldPrice', 'team', 'auctionState', 'stats', 'source']); data.name = cleanText(data.name); if (data.team) await ensureExists(Team, data.team, 'team'); res.status(201).json(await Player.create(data)); }));
router.patch('/players/:id', asyncHandler(async (req, res) => { const data = cleanMedia(pick(req.body, playerFields)); omitEmpty(data, ['rating', 'category', 'soldPrice', 'auctionState', 'stats', 'source']); if (data.team === '') data.team = null; if (data.name != null) data.name = cleanText(data.name); if (data.team) await ensureExists(Team, data.team, 'team'); await returnUpdated(Player, req.params.id, data, res, 'team'); }));
router.delete('/players/:id', asyncHandler(async (req, res) => {
  const id = ensureObjectId(req.params.id); const references = await Promise.all([Bid.countDocuments({ player: id }), AuctionEvent.countDocuments({ player: id }), Auction.countDocuments({ currentPlayer: id }), Ball.countDocuments({ $or: [{ batter: id }, { bowler: id }, { dismissedPlayer: id }] })]);
  if (references.some(Boolean)) throw httpError(409, 'Player is referenced by an auction or bid history and cannot be deleted');
  await Auction.updateMany({}, { $pull: { playerQueue: id } }); if (!(await Player.findByIdAndDelete(id))) throw httpError(404, 'Player not found'); res.json({ deleted: true, id });
}));

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  if (quoted) throw httpError(400, 'CSV contains an unclosed quoted field');
  return rows;
}
const csvNumber = (value, label, line, fallback = 0) => {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value); if (!Number.isFinite(number)) throw httpError(400, `Invalid ${label} on CSV line ${line}`); return number;
};
router.post('/players/import-csv', asyncHandler(async (req, res) => {
  const text = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (typeof text !== 'string' || !text.trim()) throw httpError(400, 'Send CSV as text/csv or { "csv": "..." }');
  const rows = parseCsv(text); if (rows.length < 2) throw httpError(400, 'CSV must contain a header and at least one data row');
  if (rows.length > 501) throw httpError(400, 'CSV import is limited to 500 players');
  const normalize = (value) => String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[ _-]/g, '');
  const headers = rows[0].map(normalize); const column = (...names) => headers.findIndex((h) => names.includes(h));
  const indexes = { name: column('name', 'playername'), role: column('role'), category: column('category'), basePrice: column('baseprice', 'price'), rating: column('rating'), photo: column('photo', 'photourl'), battingStyle: column('battingstyle'), bowlingStyle: column('bowlingstyle'), matches: column('matches'), runs: column('runs'), wickets: column('wickets'), strikeRate: column('strikerate'), economy: column('economy'), cricheroesId: column('cricheroesid'), cricheroesUrl: column('cricheroesurl') };
  if (indexes.name < 0 || indexes.role < 0 || indexes.basePrice < 0) throw httpError(400, 'CSV requires name, role, and basePrice columns');
  const value = (row, index) => index < 0 ? undefined : cleanText(row[index], 2000);
  const roles = new Map([['batter', 'Batter'], ['bowler', 'Bowler'], ['allrounder', 'All-rounder'], ['wicketkeeper', 'Wicketkeeper'], ['wk', 'Wicketkeeper']]);
  const categories = new Map([['marquee', 'Marquee'], ['premium', 'Premium'], ['regular', 'Regular'], ['emerging', 'Emerging']]);
  const documents = []; const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; const line = i + 1; const name = value(row, indexes.name);
    if (!name || /^[=+\-@]/.test(name)) throw httpError(400, `Invalid or unsafe player name on CSV line ${line}`);
    const key = name.toLowerCase(); if (seen.has(key)) throw httpError(400, `Duplicate player "${name}" in CSV`); seen.add(key);
    const data = { name, role: roles.get(normalize(value(row, indexes.role))), category: categories.get(normalize(value(row, indexes.category))) || 'Regular', basePrice: csvNumber(value(row, indexes.basePrice), 'basePrice', line), rating: csvNumber(value(row, indexes.rating), 'rating', line, 5), photo: value(row, indexes.photo), battingStyle: value(row, indexes.battingStyle), bowlingStyle: value(row, indexes.bowlingStyle), cricheroesId: value(row, indexes.cricheroesId), cricheroesUrl: value(row, indexes.cricheroesUrl), stats: { matches: csvNumber(value(row, indexes.matches), 'matches', line), runs: csvNumber(value(row, indexes.runs), 'runs', line), wickets: csvNumber(value(row, indexes.wickets), 'wickets', line), strikeRate: csvNumber(value(row, indexes.strikeRate), 'strikeRate', line), economy: csvNumber(value(row, indexes.economy), 'economy', line) } };
    for (const field of ['photo', 'battingStyle', 'bowlingStyle', 'cricheroesId', 'cricheroesUrl']) if (!data[field]) delete data[field];
    await new Player(data).validate(); documents.push(data);
  }
  const existing = new Set((await Player.find().select('name').lean()).map((p) => p.name.toLowerCase()));
  const fresh = documents.filter((p) => !existing.has(p.name.toLowerCase())); const skipped = documents.length - fresh.length;
  const created = fresh.length ? await Player.insertMany(fresh, { ordered: true }) : [];
  res.status(201).json({ imported: created.length, skipped, players: created });
}));

// Matches
const matchFields = ['tournament', 'teamA', 'teamB', 'startsAt', 'venue', 'status', 'innings', 'result', 'currentOver', 'liveMessage', 'cricheroesId', 'cricheroesUrl', 'source', 'manualOverrides'];
async function validateMatch(data, existing = {}) {
  const teamA = hasOwn(data, 'teamA') ? data.teamA : existing.teamA;
  const teamB = hasOwn(data, 'teamB') ? data.teamB : existing.teamB;
  if (!teamA || !teamB) throw httpError(400, 'Both teamA and teamB are required');
  if (String(teamA) === String(teamB)) throw httpError(400, 'A team cannot play itself');
  await Promise.all([ensureExists(Team, teamA, 'teamA'), ensureExists(Team, teamB, 'teamB')]);
  const tournament = hasOwn(data, 'tournament') ? data.tournament : existing.tournament;
  if (tournament) await ensureExists(Tournament, tournament, 'tournament');
}
router.get('/matches', asyncHandler(async (req, res) => { const filter = req.query.status ? { status: req.query.status } : {}; res.json(await list(Match, req, filter, Match.find(filter).populate('teamA teamB tournament').sort({ startsAt: -1 }))); }));
router.get('/matches/:id', asyncHandler(async (req, res) => { const row = await Match.findById(ensureObjectId(req.params.id)).populate('teamA teamB tournament'); if (!row) throw httpError(404, 'Match not found'); res.json(row); }));
router.post('/matches', asyncHandler(async (req, res) => { const data = cleanMedia(pick(req.body, matchFields)); omitEmpty(data, ['tournament', 'startsAt', 'status', 'innings', 'source']); await validateMatch(data); res.status(201).json(await (await Match.create(data)).populate('teamA teamB tournament')); }));
router.patch('/matches/:id', asyncHandler(async (req, res) => {
  const data = cleanMedia(pick(req.body, matchFields)); omitEmpty(data, ['status', 'innings', 'source']); if (data.tournament === '') data.tournament = null; if (data.startsAt === '') data.startsAt = null; const match = await Match.findById(ensureObjectId(req.params.id)); if (!match) throw httpError(404, 'Match not found');
  await validateMatch(data, match); Object.assign(match, data); await match.save(); await match.populate('teamA teamB tournament'); res.json(match);
}));
router.delete('/matches/:id', asyncHandler(async (req, res) => { const id = ensureObjectId(req.params.id); if (!(await Match.findByIdAndDelete(id))) throw httpError(404, 'Match not found'); await Promise.all([Ball.deleteMany({ match: id }), Gallery.updateMany({ match: id }, { $unset: { match: 1 } })]); res.json({ deleted: true, id }); }));

// Tournament/rules
const tournamentFields = ['name', 'season', 'rules', 'format', 'cricheroesId', 'cricheroesUrl', 'source', 'manualOverrides'];
router.get('/tournaments', asyncHandler(async (req, res) => res.json(await list(Tournament, req, {}, Tournament.find().sort({ createdAt: -1 })))));
router.get('/tournaments/:id', asyncHandler(async (req, res) => { const row = await Tournament.findById(ensureObjectId(req.params.id)); if (!row) throw httpError(404, 'Tournament not found'); res.json(row); }));
router.get('/tournament', asyncHandler(async (_req, res) => res.json(await Tournament.findOne().sort({ createdAt: -1 }))));
router.post('/tournaments', asyncHandler(async (req, res) => res.status(201).json(await Tournament.create(cleanMedia(pick(req.body, tournamentFields))))));
router.patch('/tournaments/:id', asyncHandler(async (req, res) => returnUpdated(Tournament, req.params.id, cleanMedia(pick(req.body, tournamentFields)), res)));
router.put('/tournament', asyncHandler(async (req, res) => {
  const data = cleanMedia(pick(req.body, tournamentFields)); let row = await Tournament.findOne().sort({ createdAt: -1 });
  if (row) { Object.assign(row, data); await row.save(); } else row = await Tournament.create(data); res.json(row);
}));
router.delete('/tournaments/:id', asyncHandler(async (req, res) => { const id = ensureObjectId(req.params.id); if (await Match.exists({ tournament: id })) throw httpError(409, 'Tournament is referenced by matches'); if (!(await Tournament.findByIdAndDelete(id))) throw httpError(404, 'Tournament not found'); res.json({ deleted: true, id }); }));

// Gallery
const galleryFields = ['title', 'imageUrl', 'caption', 'match', 'takenAt'];
router.get('/gallery', asyncHandler(async (req, res) => res.json(await list(Gallery, req, {}, Gallery.find().populate('match', 'teamA teamB startsAt').sort({ takenAt: -1, createdAt: -1 })))));
router.get('/gallery/:id', asyncHandler(async (req, res) => { const row = await Gallery.findById(ensureObjectId(req.params.id)).populate('match'); if (!row) throw httpError(404, 'Gallery item not found'); res.json(row); }));
router.post('/gallery', asyncHandler(async (req, res) => { const data = cleanMedia(pick(req.body, galleryFields)); omitEmpty(data, ['match', 'takenAt']); if (data.match) await ensureExists(Match, data.match, 'match'); res.status(201).json(await Gallery.create(data)); }));
router.patch('/gallery/:id', asyncHandler(async (req, res) => { const data = cleanMedia(pick(req.body, galleryFields)); if (data.match === '') data.match = null; if (data.takenAt === '') data.takenAt = null; if (data.match) await ensureExists(Match, data.match, 'match'); await returnUpdated(Gallery, req.params.id, data, res, 'match'); }));
router.delete('/gallery/:id', asyncHandler(async (req, res) => { const id = ensureObjectId(req.params.id); if (!(await Gallery.findByIdAndDelete(id))) throw httpError(404, 'Gallery item not found'); res.json({ deleted: true, id }); }));

// Users: passwordHash is never accepted or selected.
router.get('/users', asyncHandler(async (req, res) => { const filter = req.query.role ? { role: req.query.role } : {}; res.json(await list(User, req, filter, User.find(filter).select('-passwordHash').populate('team', 'name shortName').sort({ name: 1 }))); }));
router.get('/users/:id', asyncHandler(async (req, res) => { const row = await User.findById(ensureObjectId(req.params.id)).select('-passwordHash').populate('team', 'name shortName'); if (!row) throw httpError(404, 'User not found'); res.json(row); }));
router.post('/users', asyncHandler(async (req, res) => {
  const data = pick(req.body, ['name', 'email', 'password', 'role', 'team']); if (!data.password || String(data.password).length < 8) throw httpError(400, 'Password must be at least 8 characters');
  if (data.team) await ensureExists(Team, data.team, 'team'); if (data.role === 'manager' && !data.team) throw httpError(400, 'A manager must be assigned to a team');
  const user = await User.create({ name: cleanText(data.name), email: cleanText(data.email, 320)?.toLowerCase(), passwordHash: await bcrypt.hash(String(data.password), 12), role: data.role, team: data.team || null }); res.status(201).json(user);
}));
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const id = ensureObjectId(req.params.id); const data = pick(req.body, ['name', 'email', 'password', 'role', 'team']); const update = pick(data, ['name', 'email', 'role', 'team']);
  if (update.name != null) update.name = cleanText(update.name); if (update.email != null) update.email = cleanText(update.email, 320)?.toLowerCase(); if (hasOwn(update, 'team')) update.team ||= null;
  if (data.password != null) { if (String(data.password).length < 8) throw httpError(400, 'Password must be at least 8 characters'); update.passwordHash = await bcrypt.hash(String(data.password), 12); }
  const existing = await User.findById(id); if (!existing) throw httpError(404, 'User not found');
  const finalRole = update.role || existing.role; const finalTeam = hasOwn(update, 'team') ? update.team : existing.team;
  if (finalTeam) await ensureExists(Team, finalTeam, 'team'); if (finalRole === 'manager' && !finalTeam) throw httpError(400, 'A manager must be assigned to a team');
  if (existing.role === 'admin' && update.role && update.role !== 'admin' && await User.countDocuments({ role: 'admin' }) <= 1) throw httpError(409, 'Cannot demote the last admin');
  await returnUpdated(User, id, update, res, 'team');
}));
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = ensureObjectId(req.params.id); if (String(req.user._id) === String(id)) throw httpError(409, 'You cannot delete your own account');
  const user = await User.findById(id); if (!user) throw httpError(404, 'User not found'); if (user.role === 'admin' && await User.countDocuments({ role: 'admin' }) <= 1) throw httpError(409, 'Cannot delete the last admin');
  if (await Bid.exists({ placedBy: id }) || await AuctionEvent.exists({ actor: id })) throw httpError(409, 'User is referenced by auction history and cannot be deleted');
  await user.deleteOne(); res.json({ deleted: true, id });
}));

// Auction setup, queue, and configuration. Live bid fields remain controlled by auction actions only.
router.get('/auctions', asyncHandler(async (req, res) => res.json(await list(Auction, req, {}, Auction.find().populate('currentPlayer highestBidder playerQueue').sort({ createdAt: -1 })))));
router.get('/auctions/:id', asyncHandler(async (req, res) => res.json(await getAuctionState(ensureObjectId(req.params.id)))));
router.post('/auctions', asyncHandler(async (req, res) => {
  const data = pick(req.body, ['name', 'increment', 'timerSeconds', 'round', 'playerQueue']); data.status = 'draft'; data.phase = 'closed';
  if (data.playerQueue) data.playerQueue.forEach((id) => ensureObjectId(id, 'queue player id')); res.status(201).json(await Auction.create(data));
}));
router.patch('/auctions/:id/config', asyncHandler(async (req, res) => {
  const data = pick(req.body, ['name', 'increment', 'timerSeconds', 'round']);
  const auction = await Auction.findById(ensureObjectId(req.params.id)); if (!auction) throw httpError(404, 'Auction not found'); if (auction.status === 'live') throw httpError(409, 'Pause the auction before changing configuration');
  Object.assign(auction, data); await auction.save(); res.json(auction);
}));
router.patch('/auctions/:id', asyncHandler(async (req, res) => {
  const data = pick(req.body, ['name', 'increment', 'timerSeconds', 'round']); const auction = await Auction.findById(ensureObjectId(req.params.id));
  if (!auction) throw httpError(404, 'Auction not found'); if (auction.status === 'live') throw httpError(409, 'Pause the auction before changing configuration'); Object.assign(auction, data); await auction.save(); res.json(auction);
}));
router.put('/auctions/:id/queue', asyncHandler(async (req, res) => {
  if (!Array.isArray(req.body.playerIds) || req.body.playerIds.length > 1000) throw httpError(400, 'playerIds must be an array of at most 1000 ids');
  const ids = [...new Set(req.body.playerIds.map((id) => String(ensureObjectId(id, 'player id'))))]; const found = await Player.countDocuments({ _id: { $in: ids }, auctionState: { $ne: 'sold' } });
  if (found !== ids.length) throw httpError(400, 'Queue contains a missing or sold player'); await returnUpdated(Auction, req.params.id, { playerQueue: ids }, res, 'playerQueue');
}));
router.post('/auctions/:id/queue/:playerId', asyncHandler(async (req, res) => {
  const player = await Player.findOne({ _id: ensureObjectId(req.params.playerId), auctionState: { $ne: 'sold' } }); if (!player) throw httpError(404, 'Available player not found');
  await returnUpdated(Auction, req.params.id, { $addToSet: { playerQueue: player._id } }, res, 'playerQueue');
}));
router.delete('/auctions/:id/queue/:playerId', asyncHandler(async (req, res) => returnUpdated(Auction, req.params.id, { $pull: { playerQueue: ensureObjectId(req.params.playerId) } }, res, 'playerQueue')));
router.post('/auctions/:id/actions/next', asyncHandler(async (req, res) => {
  const id = ensureObjectId(req.params.id); const claimed = await Auction.findOneAndUpdate({ _id: id, 'playerQueue.0': { $exists: true } }, { $pop: { playerQueue: -1 } }, { new: false });
  if (!claimed) { if (!(await Auction.exists({ _id: id }))) throw httpError(404, 'Auction not found'); throw httpError(409, 'Auction queue is empty'); }
  const playerId = claimed.playerQueue[0];
  try { res.json(await startPlayer(claimed._id, playerId, req.user, req.body.timerSeconds)); }
  catch (error) { await Auction.updateOne({ _id: claimed._id }, { $push: { playerQueue: { $each: [playerId], $position: 0 } } }); throw error; }
}));
router.delete('/auctions/:id', asyncHandler(async (req, res) => {
  const id = ensureObjectId(req.params.id); const auction = await Auction.findById(id); if (!auction) throw httpError(404, 'Auction not found');
  if (auction.status !== 'draft' || await Bid.exists({ auction: id }) || await AuctionEvent.exists({ auction: id })) throw httpError(409, 'Only an unused draft auction can be deleted'); await auction.deleteOne(); res.json({ deleted: true, id });
}));

// CricHeroes control and cached status.
router.get('/cricheroes', asyncHandler(async (_req, res) => {
  const [setting, caches] = await Promise.all([Setting.findOne({ key: 'cricheroesSyncEnabled' }).lean(), SyncCache.find({ source: 'cricheroes' }).sort({ updatedAt: -1 }).limit(100).lean()]);
  const latest = caches.reduce((date, cache) => !date || cache.lastUpdatedAt > date ? cache.lastUpdatedAt : date, null);
  res.json({ enabled: setting ? Boolean(setting.value) : config.syncEnabled, latestSyncAt: latest, counts: { ok: caches.filter((c) => c.status === 'ok').length, stale: caches.filter((c) => c.status === 'stale').length }, entries: caches });
}));
router.patch('/cricheroes', asyncHandler(async (req, res) => { if (typeof req.body.enabled !== 'boolean') throw httpError(400, 'enabled must be boolean'); res.json(await Setting.findOneAndUpdate({ key: 'cricheroesSyncEnabled' }, { value: req.body.enabled }, { upsert: true, new: true, runValidators: true })); }));
router.post('/cricheroes/sync', asyncHandler(async (_req, res) => res.json(await runCricHeroesSync({ force: true }))));
router.get('/settings/cricheroes', asyncHandler(async (_req, res) => { const row = await Setting.findOne({ key: 'cricheroesSyncEnabled' }).lean(); res.json({ enabled: row ? Boolean(row.value) : config.syncEnabled }); }));
router.patch('/settings/cricheroes', asyncHandler(async (req, res) => { if (typeof req.body.enabled !== 'boolean') throw httpError(400, 'enabled must be boolean'); res.json(await Setting.findOneAndUpdate({ key: 'cricheroesSyncEnabled' }, { value: req.body.enabled }, { upsert: true, new: true })); }));
router.post('/sync/cricheroes', asyncHandler(async (_req, res) => res.json(await runCricHeroesSync({ force: true }))));

export default router;
