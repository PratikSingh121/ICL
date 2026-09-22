import bcrypt from 'bcryptjs';
import { connectDb } from './db.js';
import { Auction, Match, Player, Team, Tournament, User } from './models.js';
import mongoose from 'mongoose';

await connectDb();
const teamsData = [
  ['IEM Warriors', 'IEW', '#e8b63e'], ['Kolkata Strikers', 'KST', '#ef4444'],
  ['Tech Titans', 'TTN', '#38bdf8'], ['Royal Coders', 'RCD', '#a78bfa'],
];
const teams = [];
for (const [name, shortName, color] of teamsData) teams.push(await Team.findOneAndUpdate({ shortName }, { name, shortName, color, purseStart: 100000, purseBalance: 100000, spent: 0, squadLimit: 15, stats: { played: 3, won: Math.floor(Math.random() * 3), lost: 1, nrr: Number((Math.random() * 2 - 0.5).toFixed(2)), points: Math.floor(Math.random() * 6) } }, { upsert: true, new: true, setDefaultsOnInsert: true }));

const playerData = [
  ['Aarav Sharma', 'Batter', 'Marquee', 10000, 8.9, 224, 1], ['Rohan Das', 'Bowler', 'Premium', 7500, 8.5, 42, 9],
  ['Kabir Singh', 'All-rounder', 'Marquee', 10000, 9.1, 178, 7], ['Vivaan Roy', 'Wicketkeeper', 'Premium', 7500, 8.2, 155, 0],
  ['Arjun Mehta', 'Batter', 'Regular', 5000, 7.8, 190, 0], ['Aditya Bose', 'Bowler', 'Regular', 5000, 7.6, 25, 11],
  ['Reyansh Gupta', 'All-rounder', 'Emerging', 2500, 7.3, 120, 5], ['Ishaan Paul', 'Wicketkeeper', 'Emerging', 2500, 7.1, 98, 0],
];
for (const [name, role, category, basePrice, rating, runs, wickets] of playerData) await Player.findOneAndUpdate({ name }, { name, role, category, basePrice, rating, stats: { matches: 8, runs, wickets, strikeRate: 132.4, economy: 7.2 }, auctionState: 'pending', team: null, soldPrice: null }, { upsert: true, new: true, setDefaultsOnInsert: true });

const tournament = await Tournament.findOneAndUpdate({ name: 'IEM Cricket League' }, { name: 'IEM Cricket League', season: '2026', format: 'Four teams play a round-robin league followed by the final.', rules: 'Two points for a win. Net run rate breaks ties. Each squad must include a wicketkeeper. Standard T20 playing conditions apply.' }, { upsert: true, new: true });
const now = Date.now();
await Match.deleteMany({ tournament: tournament._id });
await Match.create([
  { tournament: tournament._id, teamA: teams[0], teamB: teams[1], startsAt: new Date(now + 86_400_000), venue: 'IEM Main Ground', status: 'upcoming' },
  { tournament: tournament._id, teamA: teams[2], teamB: teams[3], startsAt: new Date(now + 172_800_000), venue: 'IEM Main Ground', status: 'upcoming' },
]);
const auction = await Auction.findOneAndUpdate({ name: 'ICL Live Auction 2026' }, { name: 'ICL Live Auction 2026', status: 'paused', increment: 500, timerSeconds: 30, phase: 'closed' }, { upsert: true, new: true, setDefaultsOnInsert: true });
const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
await User.findOneAndUpdate({ email: 'admin@icl.test' }, { name: 'ICL Admin', email: 'admin@icl.test', passwordHash, role: 'admin' }, { upsert: true, new: true });
await User.findOneAndUpdate({ email: 'auctioneer@icl.test' }, { name: 'Auctioneer', email: 'auctioneer@icl.test', passwordHash, role: 'auctioneer' }, { upsert: true, new: true });
await User.findOneAndUpdate({ email: 'manager@icl.test' }, { name: 'Warriors Manager', email: 'manager@icl.test', passwordHash, role: 'manager', team: teams[0]._id }, { upsert: true, new: true });
console.log(`Seeded ${teams.length} teams, ${playerData.length} players, auction ${auction._id}`);
await mongoose.disconnect();
