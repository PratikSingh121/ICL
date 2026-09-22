import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import { config } from './config.js';
import { asyncHandler, authenticate, authorize, httpError } from './middleware.js';
import { Auction, AuctionEvent, Ball, Bid, Gallery, Match, Player, SyncCache, Team, Tournament, User } from './models.js';
import { askChatbot } from './services/chatbot.js';
import { closeWithoutSale, getAuctionState, pauseAuction, placeBid, reauctionPlayer, resumeAuction, sellPlayer, startPlayer, undoLastBid } from './services/auction.js';
import adminRoutes from './adminRoutes.js';

const router = Router();
const sign = (user) => jwt.sign({ sub: user._id, role: user.role, team: user.team }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

router.get('/health', (_req, res) => res.json({ ok: true, service: 'icl-api', time: new Date() }));
router.post('/auth/login', asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) throw httpError(401, 'Invalid email or password');
  res.json({ token: sign(user), user });
}));
router.get('/auth/me', authenticate, (req, res) => res.json(req.user));
router.post('/auth/users', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  if (!req.body.password || String(req.body.password).length < 8) throw httpError(400, 'Password must be at least 8 characters');
  if (req.body.team && !(await Team.exists({ _id: req.body.team }))) throw httpError(400, 'Team does not exist');
  if (req.body.role === 'manager' && !req.body.team) throw httpError(400, 'A manager must be assigned to a team');
  const user = await User.create({ name: req.body.name, email: req.body.email, passwordHash: await bcrypt.hash(req.body.password, 12), role: req.body.role, team: req.body.team || null });
  res.status(201).json(user);
}));

router.get('/public/home', asyncHandler(async (_req, res) => {
  const [liveMatches, upcomingFixtures, pointsTable, orangeCap, purpleCap, sync] = await Promise.all([
    Match.find({ status: 'live' }).populate('teamA teamB', 'name shortName logo').lean(),
    Match.find({ status: 'upcoming' }).sort({ startsAt: 1 }).limit(8).populate('teamA teamB', 'name shortName logo').lean(),
    Team.find().sort({ 'stats.points': -1, 'stats.nrr': -1 }).select('name shortName logo color stats').lean(),
    Player.find().select('-syncedData -manualOverrides').sort({ 'stats.runs': -1 }).limit(5).populate('team', 'name shortName').lean(),
    Player.find().select('-syncedData -manualOverrides').sort({ 'stats.wickets': -1 }).limit(5).populate('team', 'name shortName').lean(),
    SyncCache.findOne({ source: 'cricheroes' }).sort({ lastUpdatedAt: -1 }).lean(),
  ]);
  res.json({ liveMatches, upcomingFixtures, pointsTable, orangeCap, purpleCap, lastUpdated: sync?.lastUpdatedAt || new Date(), syncStatus: sync?.status || 'manual' });
}));
router.get('/teams', asyncHandler(async (_req, res) => res.json(await Team.find().select('-syncedData -manualOverrides').sort({ name: 1 }).lean())));
router.get('/teams/:id', asyncHandler(async (req, res) => { const team = await Team.findById(req.params.id).select('-syncedData -manualOverrides').lean(); if (!team) throw httpError(404, 'Team not found'); res.json({ ...team, squad: await Player.find({ team: team._id }).select('-syncedData -manualOverrides').lean() }); }));
router.get('/players', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.state) filter.auctionState = req.query.state;
  if (req.query.team) filter.team = req.query.team;
  if (req.query.q) filter.name = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  res.json(await Player.find(filter).select('-syncedData -manualOverrides').populate('team', 'name shortName logo').sort({ rating: -1, name: 1 }).lean());
}));
router.get('/players/:id', asyncHandler(async (req, res) => { const row = await Player.findById(req.params.id).select('-syncedData -manualOverrides').populate('team', '-syncedData -manualOverrides').lean(); if (!row) throw httpError(404, 'Player not found'); res.json(row); }));
router.get('/matches', asyncHandler(async (req, res) => { const f = req.query.status ? { status: req.query.status } : {}; res.json(await Match.find(f).select('-syncedData -manualOverrides').sort({ startsAt: 1 }).populate('teamA teamB tournament', '-syncedData -manualOverrides').lean()); }));
router.get('/matches/:id', asyncHandler(async (req, res) => { const row = await Match.findById(req.params.id).select('-syncedData -manualOverrides').populate('teamA teamB tournament', '-syncedData -manualOverrides').lean(); if (!row) throw httpError(404, 'Match not found'); res.json({ ...row, balls: await Ball.find({ match: row._id }).sort({ innings: 1, over: 1, ball: 1 }).populate('batter bowler dismissedPlayer', 'name').lean() }); }));
router.get('/gallery', asyncHandler(async (_req, res) => res.json(await Gallery.find().sort({ takenAt: -1, createdAt: -1 }).lean())));
router.get('/tournament', asyncHandler(async (_req, res) => res.json(await Tournament.findOne().select('-syncedData -manualOverrides').sort({ createdAt: -1 }).lean())));

router.get('/auction/current', asyncHandler(async (_req, res) => res.json(await getAuctionState())));
router.get('/auction/:id', asyncHandler(async (req, res) => res.json(await getAuctionState(req.params.id))));
router.post('/auction/:id/bid', authenticate, authorize('admin', 'auctioneer', 'manager'), asyncHandler(async (req, res) => res.status(201).json(await placeBid(req.params.id, req.body, req.user))));
router.post('/auction/:id/actions/start', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await startPlayer(req.params.id, req.body.playerId, req.user, req.body.timerSeconds))));
router.post('/auction/:id/actions/sold', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await sellPlayer(req.params.id, req.user))));
router.post('/auction/:id/actions/unsold', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await closeWithoutSale(req.params.id, req.user, 'unsold'))));
router.post('/auction/:id/actions/skip', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await closeWithoutSale(req.params.id, req.user, 'skipped'))));
router.post('/auction/:id/actions/pause', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await pauseAuction(req.params.id, req.user))));
router.post('/auction/:id/actions/resume', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await resumeAuction(req.params.id, req.user))));
router.post('/auction/:id/actions/undo', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await undoLastBid(req.params.id, req.user))));
router.post('/auction/:id/actions/reauction', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => res.json(await reauctionPlayer(req.params.id, req.body.playerId, req.user, req.body.timerSeconds))));
router.get('/auction/:id/history', asyncHandler(async (req, res) => res.json(await AuctionEvent.find({ auction: req.params.id }).sort({ createdAt: -1 }).populate('player team actor', 'name shortName role').lean())));
router.get('/auction/:id/analytics', asyncHandler(async (req, res) => {
  const [events, byTeam, byCategory] = await Promise.all([
    AuctionEvent.countDocuments({ auction: req.params.id }),
    Player.aggregate([{ $match: { auctionState: 'sold', team: { $ne: null } } }, { $group: { _id: '$team', spend: { $sum: '$soldPrice' }, players: { $sum: 1 }, average: { $avg: '$soldPrice' } } }, { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } }, { $unwind: '$team' }]),
    Player.aggregate([{ $match: { auctionState: 'sold' } }, { $group: { _id: '$category', spend: { $sum: '$soldPrice' }, players: { $sum: 1 }, average: { $avg: '$soldPrice' } } }]),
  ]); res.json({ events, byTeam, byCategory });
}));

const chatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
router.post('/chatbot', chatLimiter, asyncHandler(async (req, res) => {
  const question = String(req.body.message || req.body.question || '').trim(); if (!question || question.length > 500) throw httpError(400, 'Message must be between 1 and 500 characters');
  res.json(await askChatbot(question, req.ip));
}));

router.use('/admin', adminRoutes);
router.post('/scorer/matches/:id/balls', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => {
  const ball = await Ball.create({ ...req.body, match: req.params.id, source: 'scorer' });
  const total = Number(ball.runs) + Number(ball.extraRuns); const update = { $inc: { [`innings.${ball.innings - 1}.runs`]: total } };
  if (ball.wicket) update.$inc[`innings.${ball.innings - 1}.wickets`] = 1;
  await Match.findByIdAndUpdate(req.params.id, update); res.status(201).json(ball);
}));

router.get('/auction/:id/export.csv', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => {
  const rows = await Player.find({ auctionState: { $in: ['sold', 'unsold'] } }).populate('team', 'name').lean();
  const esc = (v) => { let value = String(v ?? ''); if (/^[\t\r\n ]*[=+\-@]/.test(value)) value = `'${value}`; return `"${value.replaceAll('"', '""')}"`; };
  res.type('text/csv').attachment('icl-auction-report.csv').send(['Player,Category,Role,Status,Team,Price', ...rows.map((p) => [p.name, p.category, p.role, p.auctionState, p.team?.name, p.soldPrice].map(esc).join(','))].join('\n'));
}));
router.get('/auction/:id/receipt/:teamId.pdf', authenticate, authorize('admin', 'auctioneer', 'manager'), asyncHandler(async (req, res) => {
  if (req.user.role === 'manager' && String(req.user.team) !== req.params.teamId) throw httpError(403, 'Managers may only download their own receipt');
  const [team, players] = await Promise.all([Team.findById(req.params.teamId).lean(), Player.find({ team: req.params.teamId, auctionState: 'sold' }).lean()]);
  if (!team) throw httpError(404, 'Team not found');
  res.type('application/pdf').attachment(`${team.shortName}-receipt.pdf`); const doc = new PDFDocument({ margin: 50 }); doc.pipe(res);
  doc.fontSize(22).fillColor('#c99b2e').text('ICL Auction Receipt').moveDown().fillColor('#111').fontSize(15).text(team.name).moveDown();
  players.forEach((p) => doc.fontSize(11).text(`${p.name} — ${p.role} — ${p.soldPrice}`)); doc.moveDown().fontSize(13).text(`Total spent: ${team.spent}`).text(`Balance: ${team.purseBalance}`); doc.end();
}));
router.get('/auction/:id/export.pdf', authenticate, authorize('admin', 'auctioneer'), asyncHandler(async (req, res) => {
  const [auction, teams] = await Promise.all([Auction.findById(req.params.id).lean(), Team.find().sort({ spent: -1 }).lean()]);
  if (!auction) throw httpError(404, 'Auction not found');
  res.type('application/pdf').attachment('icl-auction-report.pdf'); const doc = new PDFDocument({ margin: 48 }); doc.pipe(res);
  doc.fontSize(22).fillColor('#c99b2e').text('ICL Post-Auction Report').fillColor('#111').fontSize(10).text(`Generated ${new Date().toLocaleString('en-IN')}`).moveDown();
  for (const team of teams) {
    const players = await Player.find({ team: team._id, auctionState: 'sold' }).sort({ soldPrice: -1 }).lean();
    doc.fontSize(15).text(`${team.name} — spent ${team.spent}, balance ${team.purseBalance}`);
    players.forEach((p) => doc.fontSize(10).text(`  ${p.name} (${p.role}) — ${p.soldPrice}`)); doc.moveDown(0.6);
  }
  doc.end();
}));

export default router;
