import mongoose from 'mongoose';
import { Auction, AuctionEvent, Bid, Player, Team } from '../models.js';
import { emitAuction } from '../socket.js';
import { httpError } from '../middleware.js';

const populateAuction = (query) => query
  .populate('currentPlayer')
  .populate('highestBidder', 'name shortName logo purseBalance spent');

export async function getAuctionState(id) {
  const auction = id
    ? await populateAuction(Auction.findById(id)).lean()
    : await populateAuction(Auction.findOne().sort({ createdAt: -1 })).lean();
  if (!auction) throw httpError(404, 'Auction not found');
  const bids = await Bid.find({ auction: auction._id }).sort({ createdAt: -1 }).limit(30)
    .populate('team', 'name shortName logo').populate('player', 'name').lean();
  const teams = await Team.find().select('name shortName logo purseStart purseBalance spent squadLimit').lean();
  return { ...auction, bids, teams, serverTime: new Date() };
}

async function broadcastState(id) {
  const state = await getAuctionState(id);
  emitAuction(String(id), 'auction:state', state);
  return state;
}

export async function startPlayer(auctionId, playerId, actor, timerSeconds) {
  const player = await Player.findById(playerId);
  if (!player) throw httpError(404, 'Player not found');
  if (player.auctionState === 'sold') throw httpError(409, 'Sold player cannot be auctioned again');
  const seconds = Math.min(180, Math.max(5, Number(timerSeconds) || 30));
  const auction = await Auction.findByIdAndUpdate(auctionId, {
    $set: { currentPlayer: player._id, currentBid: player.basePrice, highestBidder: null, status: 'live', phase: 'open', timerSeconds: seconds, endsAt: new Date(Date.now() + seconds * 1000), lastAction: 'player_started', previousState: null },
  }, { new: true, runValidators: true });
  if (!auction) throw httpError(404, 'Auction not found');
  await Player.findByIdAndUpdate(player._id, { auctionState: 'pending' });
  await AuctionEvent.create({ auction: auction._id, type: 'player_started', actor: actor._id, player: player._id });
  return broadcastState(auction._id);
}

export async function placeBid(auctionId, { teamId, amount }, actor) {
  if (!mongoose.isValidObjectId(teamId)) throw httpError(400, 'A valid team is required');
  const snapshot = await Auction.findById(auctionId).lean();
  if (!snapshot) throw httpError(404, 'Auction not found');
  if (snapshot.status !== 'live' || snapshot.phase === 'closed') throw httpError(409, 'Bidding is not open');
  if (!snapshot.currentPlayer) throw httpError(409, 'No player is currently being auctioned');
  if (snapshot.endsAt && new Date(snapshot.endsAt) <= new Date()) throw httpError(409, 'The bidding timer has ended');
  if (String(snapshot.highestBidder || '') === String(teamId)) throw httpError(409, 'Your team already has the highest bid');
  if (actor.role === 'manager' && String(actor.team || '') !== String(teamId)) throw httpError(403, 'Managers may only bid for their own team');

  const expectedAmount = snapshot.highestBidder ? snapshot.currentBid + snapshot.increment : snapshot.currentBid;
  const bidAmount = Number(amount ?? expectedAmount);
  if (!Number.isFinite(bidAmount) || bidAmount !== expectedAmount) throw httpError(409, `Next valid bid is ${expectedAmount}`);
  const [team, player] = await Promise.all([Team.findById(teamId).lean(), Player.findById(snapshot.currentPlayer).lean()]);
  if (!team) throw httpError(404, 'Team not found');
  if (team.purseBalance < bidAmount) throw httpError(409, 'This bid exceeds the available purse');
  const squadCount = await Player.countDocuments({ team: teamId, auctionState: 'sold' });
  if (squadCount >= team.squadLimit) throw httpError(409, 'Squad limit reached');

  // Compare-and-swap is the atomic concurrency gate: only one request can match this exact state.
  const updated = await Auction.findOneAndUpdate({
    _id: snapshot._id, status: 'live', phase: { $ne: 'closed' }, currentPlayer: snapshot.currentPlayer,
    currentBid: snapshot.currentBid, highestBidder: snapshot.highestBidder || null, endsAt: { $gt: new Date() },
  }, {
    $set: { previousState: { currentBid: snapshot.currentBid, highestBidder: snapshot.highestBidder || null, endsAt: snapshot.endsAt }, currentBid: bidAmount, highestBidder: team._id, phase: 'open', lastAction: 'bid' },
  }, { new: true });
  if (!updated) throw httpError(409, 'Another bid was accepted first. Refresh and bid again.');

  const bid = await Bid.create({ auction: updated._id, player: player._id, team: team._id, amount: bidAmount, placedBy: actor._id });
  await AuctionEvent.create({ auction: updated._id, type: 'bid', actor: actor._id, player: player._id, team: team._id, amount: bidAmount });
  const populatedBid = await bid.populate('team', 'name shortName logo');
  emitAuction(String(updated._id), 'bid:new', populatedBid);
  if (snapshot.highestBidder) emitAuction(String(updated._id), 'notification', { type: 'outbid', teamId: snapshot.highestBidder, message: `Your team was outbid for ${player.name}` });
  emitAuction(String(updated._id), 'notification', { type: 'new_bid', message: `${team.shortName} bid ${bidAmount} for ${player.name}` });
  await broadcastState(updated._id);
  return populatedBid;
}

export async function sellPlayer(auctionId, actor, automatic = false) {
  const snapshot = await Auction.findById(auctionId).lean();
  if (!snapshot?.currentPlayer) throw httpError(409, 'No active player');
  if (!snapshot.highestBidder) throw httpError(409, 'Cannot sell a player without a bid');
  // Claim the sale before touching the purse. Concurrent manual/timeout calls cannot both match.
  const auction = await Auction.findOneAndUpdate({ _id: auctionId, phase: { $ne: 'closed' }, status: { $in: ['live', 'paused'] }, currentPlayer: snapshot.currentPlayer, highestBidder: snapshot.highestBidder, currentBid: snapshot.currentBid }, { $set: { phase: 'closed', status: 'paused', lastAction: 'selling' } }, { new: true });
  if (!auction?.currentPlayer) throw httpError(409, 'No active player');
  const team = await Team.findOneAndUpdate({ _id: auction.highestBidder, purseBalance: { $gte: auction.currentBid } }, { $inc: { purseBalance: -auction.currentBid, spent: auction.currentBid } }, { new: true });
  if (!team) {
    await Auction.updateOne({ _id: auction._id, lastAction: 'selling' }, { phase: snapshot.phase, status: snapshot.status, lastAction: snapshot.lastAction });
    throw httpError(409, 'Winning team no longer has sufficient purse');
  }
  try {
    await Player.findByIdAndUpdate(auction.currentPlayer, { team: team._id, soldPrice: auction.currentBid, auctionState: 'sold' });
    auction.lastAction = 'sold';
    await auction.save();
  } catch (error) {
    await Team.findByIdAndUpdate(team._id, { $inc: { purseBalance: auction.currentBid, spent: -auction.currentBid } });
    await Auction.updateOne({ _id: auction._id, lastAction: 'selling' }, { phase: snapshot.phase, status: snapshot.status, lastAction: snapshot.lastAction });
    throw error;
  }
  const event = await AuctionEvent.create({ auction: auction._id, type: 'sold', actor: actor?._id, player: auction.currentPlayer, team: team._id, amount: auction.currentBid, details: { automatic } });
  emitAuction(String(auction._id), 'player:sold', { playerId: auction.currentPlayer, team, amount: auction.currentBid, eventId: event._id });
  emitAuction(String(auction._id), 'notification', { type: 'sold', message: `SOLD to ${team.shortName} for ${auction.currentBid}` });
  return broadcastState(auction._id);
}

export async function closeWithoutSale(auctionId, actor, state = 'unsold') {
  if (!['unsold', 'skipped'].includes(state)) throw httpError(400, 'Invalid close action');
  const auction = await Auction.findOneAndUpdate({ _id: auctionId, phase: { $ne: 'closed' }, currentPlayer: { $ne: null } }, { $set: { phase: 'closed', status: 'paused', lastAction: state } }, { new: true });
  if (!auction) throw httpError(409, 'No open player');
  await Player.findByIdAndUpdate(auction.currentPlayer, { auctionState: state });
  await AuctionEvent.create({ auction: auction._id, type: state, actor: actor?._id, player: auction.currentPlayer });
  emitAuction(String(auction._id), `player:${state}`, { playerId: auction.currentPlayer });
  return broadcastState(auction._id);
}

export async function pauseAuction(auctionId, actor) {
  const auction = await Auction.findOneAndUpdate({ _id: auctionId, status: 'live' }, [{ $set: { status: 'paused', timerSeconds: { $max: [0, { $ceil: { $divide: [{ $subtract: ['$endsAt', '$$NOW'] }, 1000] } }] }, lastAction: 'paused' } }], { new: true });
  if (!auction) throw httpError(409, 'Auction is not live');
  await AuctionEvent.create({ auction: auction._id, type: 'paused', actor: actor._id });
  return broadcastState(auction._id);
}

export async function resumeAuction(auctionId, actor) {
  const auction = await Auction.findOneAndUpdate({ _id: auctionId, status: 'paused', phase: { $ne: 'closed' } }, [{ $set: { status: 'live', endsAt: { $add: ['$$NOW', { $multiply: ['$timerSeconds', 1000] }] }, lastAction: 'resumed' } }], { new: true });
  if (!auction) throw httpError(409, 'Auction cannot be resumed');
  await AuctionEvent.create({ auction: auction._id, type: 'resumed', actor: actor._id });
  return broadcastState(auction._id);
}

export async function undoLastBid(auctionId, actor) {
  const auction = await Auction.findById(auctionId).lean();
  const lastBid = await Bid.findOne({ auction: auctionId }).sort({ createdAt: -1 });
  if (!auction || !lastBid || auction.lastAction !== 'bid') throw httpError(409, 'There is no bid to undo');
  const previousBid = await Bid.findOne({ auction: auctionId, player: lastBid.player, _id: { $ne: lastBid._id } }).sort({ createdAt: -1 });
  const restored = await Auction.findOneAndUpdate({ _id: auctionId, currentBid: lastBid.amount, highestBidder: lastBid.team, lastAction: 'bid' }, { $set: { currentBid: previousBid?.amount ?? (auction.previousState?.currentBid || 0), highestBidder: previousBid?.team ?? null, lastAction: 'bid_undone', previousState: null } }, { new: true });
  if (!restored) throw httpError(409, 'Auction changed before the undo could complete');
  await lastBid.deleteOne();
  await AuctionEvent.create({ auction: auctionId, type: 'bid_undone', actor: actor._id, player: lastBid.player, team: lastBid.team, amount: lastBid.amount });
  return broadcastState(auctionId);
}

export async function reauctionPlayer(auctionId, playerId, actor, seconds) {
  await Player.findOneAndUpdate({ _id: playerId, auctionState: { $in: ['unsold', 'skipped'] } }, { auctionState: 'pending' });
  return startPlayer(auctionId, playerId, actor, seconds);
}

let timerHandle;
export function startAuctionTimer() {
  if (timerHandle) return;
  timerHandle = setInterval(async () => {
    try {
      const active = await Auction.find({ status: 'live', phase: { $ne: 'closed' }, currentPlayer: { $ne: null } }).lean();
      for (const auction of active) {
        const remaining = Math.max(0, Math.ceil((new Date(auction.endsAt).getTime() - Date.now()) / 1000));
        let phase = 'open';
        if (remaining <= Math.max(2, Math.floor(auction.timerSeconds * 0.2))) phase = 'twice';
        else if (remaining <= Math.max(5, Math.floor(auction.timerSeconds * 0.4))) phase = 'once';
        if (phase !== auction.phase) await Auction.updateOne({ _id: auction._id, phase: auction.phase }, { phase });
        emitAuction(String(auction._id), 'timer:tick', { remaining, phase, serverTime: new Date() });
        if (remaining === 0) {
          if (auction.highestBidder) await sellPlayer(auction._id, null, true);
          else await closeWithoutSale(auction._id, null, 'unsold');
        }
      }
    } catch (error) { console.error('Auction timer:', error.message); }
  }, 1000);
  timerHandle.unref?.();
}
