import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const sourceFields = {
  cricheroesId: String,
  cricheroesUrl: String,
  source: { type: String, enum: ['manual', 'scorer', 'cricheroes'], default: 'manual' },
  syncedData: { type: Schema.Types.Mixed, default: {} },
  manualOverrides: { type: Schema.Types.Mixed, default: {} },
  lastSyncedAt: Date,
};

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'auctioneer', 'manager', 'viewer'], default: 'viewer' },
  team: { type: Schema.Types.ObjectId, ref: 'Team' },
}, { timestamps: true });
UserSchema.methods.toJSON = function toJSON() {
  const value = this.toObject();
  delete value.passwordHash;
  return value;
};

const TeamSchema = new Schema({
  name: { type: String, required: true }, shortName: { type: String, required: true },
  logo: String, color: { type: String, default: '#f5b942' }, manager: String,
  purseStart: { type: Number, default: 100000 }, purseBalance: { type: Number, default: 100000 },
  spent: { type: Number, default: 0 }, squadLimit: { type: Number, default: 15 },
  stats: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, nrr: { type: Number, default: 0 }, points: { type: Number, default: 0 } },
  ...sourceFields,
}, { timestamps: true });

const PlayerSchema = new Schema({
  name: { type: String, required: true }, photo: String,
  role: { type: String, enum: ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper'], required: true },
  battingStyle: String, bowlingStyle: String, rating: { type: Number, min: 0, max: 10, default: 5 },
  category: { type: String, enum: ['Marquee', 'Premium', 'Regular', 'Emerging'], default: 'Regular' },
  basePrice: { type: Number, required: true }, soldPrice: Number,
  team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
  auctionState: { type: String, enum: ['pending', 'sold', 'unsold', 'skipped'], default: 'pending' },
  stats: { matches: { type: Number, default: 0 }, runs: { type: Number, default: 0 }, wickets: { type: Number, default: 0 }, strikeRate: { type: Number, default: 0 }, economy: { type: Number, default: 0 } },
  ...sourceFields,
}, { timestamps: true });

const inningsSchema = new Schema({ team: { type: Schema.Types.ObjectId, ref: 'Team' }, runs: Number, wickets: Number, overs: String }, { _id: false });
const MatchSchema = new Schema({
  tournament: { type: Schema.Types.ObjectId, ref: 'Tournament' },
  teamA: { type: Schema.Types.ObjectId, ref: 'Team' }, teamB: { type: Schema.Types.ObjectId, ref: 'Team' },
  startsAt: Date, venue: String, status: { type: String, enum: ['upcoming', 'live', 'completed'], default: 'upcoming' },
  innings: [inningsSchema], result: String, currentOver: String, liveMessage: String,
  ...sourceFields,
}, { timestamps: true });

const TournamentSchema = new Schema({ name: String, season: String, rules: String, format: String, ...sourceFields }, { timestamps: true });

const BidSchema = new Schema({
  auction: { type: Schema.Types.ObjectId, ref: 'Auction', index: true }, player: { type: Schema.Types.ObjectId, ref: 'Player' },
  team: { type: Schema.Types.ObjectId, ref: 'Team' }, amount: Number, placedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
BidSchema.index({ auction: 1, createdAt: -1 });

const AuctionSchema = new Schema({
  name: { type: String, default: 'ICL Live Auction' }, status: { type: String, enum: ['draft', 'live', 'paused', 'completed'], default: 'draft' },
  currentPlayer: { type: Schema.Types.ObjectId, ref: 'Player' }, currentBid: { type: Number, default: 0 },
  highestBidder: { type: Schema.Types.ObjectId, ref: 'Team', default: null }, increment: { type: Number, default: 500 },
  timerSeconds: { type: Number, default: 30 }, endsAt: Date, phase: { type: String, enum: ['open', 'once', 'twice', 'closed'], default: 'closed' },
  round: { type: Number, default: 1 }, lastAction: String,
  previousState: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, optimisticConcurrency: true });

const AuctionEventSchema = new Schema({
  auction: { type: Schema.Types.ObjectId, ref: 'Auction', index: true },
  type: { type: String, required: true }, actor: { type: Schema.Types.ObjectId, ref: 'User' },
  player: { type: Schema.Types.ObjectId, ref: 'Player' }, team: { type: Schema.Types.ObjectId, ref: 'Team' },
  amount: Number, details: Schema.Types.Mixed,
}, { timestamps: true });

const GallerySchema = new Schema({
  title: { type: String, required: true }, imageUrl: { type: String, required: true }, caption: String,
  match: { type: Schema.Types.ObjectId, ref: 'Match' }, takenAt: Date,
}, { timestamps: true });

const BallSchema = new Schema({
  match: { type: Schema.Types.ObjectId, ref: 'Match', index: true }, innings: { type: Number, min: 1, required: true },
  over: { type: Number, min: 0, required: true }, ball: { type: Number, min: 1, max: 10, required: true },
  batter: { type: Schema.Types.ObjectId, ref: 'Player' }, bowler: { type: Schema.Types.ObjectId, ref: 'Player' },
  runs: { type: Number, default: 0 }, extraType: { type: String, default: null }, extraRuns: { type: Number, default: 0 },
  wicket: { type: Boolean, default: false }, wicketType: String, dismissedPlayer: { type: Schema.Types.ObjectId, ref: 'Player' }, note: String,
  source: { type: String, enum: ['manual', 'scorer'], default: 'scorer' },
}, { timestamps: true });
BallSchema.index({ match: 1, innings: 1, over: 1, ball: 1 }, { unique: true });

const SyncCacheSchema = new Schema({ key: { type: String, unique: true }, source: String, status: String, payload: Schema.Types.Mixed, error: String, lastUpdatedAt: Date }, { timestamps: true });
const SettingSchema = new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }, { timestamps: true });

export const User = model('User', UserSchema);
export const Team = model('Team', TeamSchema);
export const Player = model('Player', PlayerSchema);
export const Match = model('Match', MatchSchema);
export const Tournament = model('Tournament', TournamentSchema);
export const Auction = model('Auction', AuctionSchema);
export const Bid = model('Bid', BidSchema);
export const AuctionEvent = model('AuctionEvent', AuctionEventSchema);
export const Gallery = model('Gallery', GallerySchema);
export const Ball = model('Ball', BallSchema);
export const SyncCache = model('SyncCache', SyncCacheSchema);
export const Setting = model('Setting', SettingSchema);
