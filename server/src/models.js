import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const optionalWebUrl = {
  validator(value) {
    if (!value) return true;
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  },
  message: 'Must be a valid http(s) URL',
};
const sourceFields = {
  cricheroesId: String,
  cricheroesUrl: { type: String, validate: optionalWebUrl },
  source: { type: String, enum: ['manual', 'scorer', 'cricheroes'], default: 'manual' },
  syncedData: { type: Schema.Types.Mixed, default: {} },
  manualOverrides: { type: Schema.Types.Mixed, default: {} },
  lastSyncedAt: Date,
};

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
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
  logo: { type: String, validate: optionalWebUrl }, color: { type: String, default: '#f5b942', match: /^#[0-9a-f]{6}$/i }, manager: String,
  purseStart: { type: Number, min: 0, default: 100000 }, purseBalance: { type: Number, min: 0, default: 100000 },
  spent: { type: Number, min: 0, default: 0 }, squadLimit: { type: Number, min: 1, max: 50, default: 15 },
  stats: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, nrr: { type: Number, default: 0 }, points: { type: Number, default: 0 } },
  ...sourceFields,
}, { timestamps: true });

const PlayerSchema = new Schema({
  name: { type: String, required: true }, photo: { type: String, validate: optionalWebUrl },
  role: { type: String, enum: ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper'], required: true },
  battingStyle: String, bowlingStyle: String, rating: { type: Number, min: 0, max: 10, default: 5 },
  category: { type: String, enum: ['Marquee', 'Premium', 'Regular', 'Emerging'], default: 'Regular' },
  basePrice: { type: Number, required: true, min: 0 }, soldPrice: { type: Number, min: 0 },
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

const TournamentSchema = new Schema({ name: { type: String, required: true }, season: String, rules: String, format: String, ...sourceFields }, { timestamps: true });

const BidSchema = new Schema({
  auction: { type: Schema.Types.ObjectId, ref: 'Auction', index: true }, player: { type: Schema.Types.ObjectId, ref: 'Player' },
  team: { type: Schema.Types.ObjectId, ref: 'Team' }, amount: Number, placedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
BidSchema.index({ auction: 1, createdAt: -1 });

const AuctionSchema = new Schema({
  name: { type: String, default: 'ICL Live Auction' }, status: { type: String, enum: ['draft', 'live', 'paused', 'completed'], default: 'draft' },
  currentPlayer: { type: Schema.Types.ObjectId, ref: 'Player' }, currentBid: { type: Number, default: 0 },
  highestBidder: { type: Schema.Types.ObjectId, ref: 'Team', default: null }, increment: { type: Number, min: 1, default: 500 },
  timerSeconds: { type: Number, min: 5, max: 180, default: 30 }, endsAt: Date, phase: { type: String, enum: ['open', 'once', 'twice', 'closed'], default: 'closed' },
  round: { type: Number, min: 1, default: 1 }, lastAction: String,
  playerQueue: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
  previousState: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, optimisticConcurrency: true });

const AuctionEventSchema = new Schema({
  auction: { type: Schema.Types.ObjectId, ref: 'Auction', index: true },
  type: { type: String, required: true }, actor: { type: Schema.Types.ObjectId, ref: 'User' },
  player: { type: Schema.Types.ObjectId, ref: 'Player' }, team: { type: Schema.Types.ObjectId, ref: 'Team' },
  amount: Number, details: Schema.Types.Mixed,
}, { timestamps: true });

const GallerySchema = new Schema({
  title: { type: String, required: true }, imageUrl: { type: String, required: true, validate: optionalWebUrl }, caption: String,
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
