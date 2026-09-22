import { Match, Player, Team, Tournament, Auction } from '../models.js';
import { config } from '../config.js';

const cache = new Map();
const TTL = 30_000;
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

async function leagueContext() {
  const [teams, fixtures, batters, bowlers, auction] = await Promise.all([
    Team.find().sort({ 'stats.points': -1, 'stats.nrr': -1 }).select('name shortName stats purseBalance spent').lean(),
    Match.find({ status: { $in: ['live', 'upcoming'] } }).sort({ startsAt: 1 }).limit(5).populate('teamA teamB', 'name shortName').lean(),
    Player.find().sort({ 'stats.runs': -1 }).limit(5).select('name stats team soldPrice').populate('team', 'shortName').lean(),
    Player.find().sort({ 'stats.wickets': -1 }).limit(5).select('name stats team').populate('team', 'shortName').lean(),
    Auction.findOne().sort({ createdAt: -1 }).populate('currentPlayer', 'name basePrice').populate('highestBidder', 'shortName').lean(),
  ]);
  return { teams, fixtures, orangeCap: batters, purpleCap: bowlers, auction };
}

const includes = (q, patterns) => patterns.some((p) => p.test(q));
export async function regexAnswer(question) {
  const q = question.toLowerCase().trim();
  if (includes(q, [/^(hi|hello|hey|namaste|hii+)/, /kaise ho/])) return 'Namaste! Main ICL assistant hoon. Points table, fixtures, live score, players, purse aur auction ke baare mein poochhiye.';
  if (includes(q, [/help/, /kya.*pooch/, /what can/])) return 'I can answer: points table, next match, live score, Orange/Purple Cap, player price, team purse/squad, auction status, and rules.';
  if (includes(q, [/point/, /table/, /standings/, /kaun.*top/])) {
    const rows = await Team.find().sort({ 'stats.points': -1, 'stats.nrr': -1 }).lean();
    return rows.length ? rows.map((t, i) => `${i + 1}. ${t.shortName}: P ${t.stats.played}, W ${t.stats.won}, L ${t.stats.lost}, NRR ${t.stats.nrr}, Pts ${t.stats.points}`).join('\n') : 'Points table abhi available nahi hai.';
  }
  if (includes(q, [/next match/, /agla match/, /fixture/])) {
    const m = await Match.findOne({ status: 'upcoming', startsAt: { $gte: new Date() } }).sort({ startsAt: 1 }).populate('teamA teamB', 'name').lean();
    return m ? `Next match: ${m.teamA?.name} vs ${m.teamB?.name}, ${new Date(m.startsAt).toLocaleString('en-IN')}, ${m.venue || 'venue TBA'}.` : 'Koi upcoming match scheduled nahi hai.';
  }
  if (includes(q, [/live score/, /score kya/, /score/])) {
    const m = await Match.findOne({ status: 'live' }).populate('teamA teamB', 'shortName').lean();
    return m ? `${m.teamA?.shortName} vs ${m.teamB?.shortName}: ${m.innings.map((i) => `${i.runs}/${i.wickets} (${i.overs})`).join(' | ')}. ${m.liveMessage || ''}` : 'Abhi koi match live nahi hai.';
  }
  if (includes(q, [/orange cap/, /top scorer/, /most runs/])) {
    const p = await Player.findOne().sort({ 'stats.runs': -1 }).lean();
    return p ? `Orange Cap: ${p.name}, ${p.stats.runs} runs.` : 'Batting data available nahi hai.';
  }
  if (includes(q, [/purple cap/, /top wicket/, /most wicket/])) {
    const p = await Player.findOne().sort({ 'stats.wickets': -1 }).lean();
    return p ? `Purple Cap: ${p.name}, ${p.stats.wickets} wickets.` : 'Bowling data available nahi hai.';
  }
  if (includes(q, [/price/, /base price/, /sold.*kitn/, /player.*purse/])) {
    const players = await Player.find().select('name basePrice soldPrice').lean();
    const p = players.find((x) => q.includes(x.name.toLowerCase()));
    return p ? `${p.name}: base ${money(p.basePrice)}${p.soldPrice ? `, sold ${money(p.soldPrice)}` : ', not sold yet'}.` : 'Player ka poora naam likhiye, jaise “Aarav price”.';
  }
  if (includes(q, [/purse/, /balance/, /budget/])) {
    const teams = await Team.find().select('name shortName purseBalance spent').lean();
    const t = teams.find((x) => q.includes(x.name.toLowerCase()) || q.includes(x.shortName.toLowerCase()));
    return t ? `${t.name}: ${money(t.purseBalance)} remaining, ${money(t.spent)} spent.` : teams.map((x) => `${x.shortName}: ${money(x.purseBalance)}`).join(' | ');
  }
  if (includes(q, [/squad/, /players.*team/, /team.*players/])) {
    const teams = await Team.find().lean(); const t = teams.find((x) => q.includes(x.name.toLowerCase()) || q.includes(x.shortName.toLowerCase()));
    if (!t) return 'Team name ke saath squad poochhiye.';
    const squad = await Player.find({ team: t._id, auctionState: 'sold' }).select('name role').lean();
    return squad.length ? `${t.shortName} squad: ${squad.map((p) => `${p.name} (${p.role})`).join(', ')}` : `${t.shortName} squad abhi empty hai.`;
  }
  if (includes(q, [/auction/, /bid/, /sold/])) {
    const a = await Auction.findOne().sort({ createdAt: -1 }).populate('currentPlayer highestBidder').lean();
    return a ? `Auction ${a.status}. ${a.currentPlayer ? `${a.currentPlayer.name}, current bid ${money(a.currentBid)}${a.highestBidder ? ` by ${a.highestBidder.shortName}` : ''}.` : 'No current player.'}` : 'Auction create nahi hua hai.';
  }
  if (includes(q, [/rule/, /format/, /niyam/])) {
    const t = await Tournament.findOne().sort({ createdAt: -1 }).lean();
    return t ? `${t.format || ''}\n${t.rules || ''}`.trim() : 'Rules abhi publish nahi hue hain.';
  }
  return 'Main points table, next match, live score, Orange/Purple Cap, player price, team purse/squad, auction status aur rules bata sakta hoon.';
}

export async function askChatbot(question, userKey = 'anonymous') {
  const key = `${userKey}:${question.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value;
  if (config.groqKey) {
    try {
      const context = await leagueContext();
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${config.groqKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.groqModel, temperature: 0.2, max_tokens: 350, messages: [{ role: 'system', content: `You are ICL cricket assistant. Answer concisely in the user's English, Hindi, or Hinglish. Only use this live database context; say when unknown: ${JSON.stringify(context)}` }, { role: 'user', content: question }] }) });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Groq ${response.status}`);
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      value = content ? { answer: content, mode: 'ai' } : { answer: await regexAnswer(question), mode: 'basic' };
    } catch { value = { answer: await regexAnswer(question), mode: 'basic' }; }
  } else value = { answer: await regexAnswer(question), mode: 'basic' };
  cache.set(key, { value, expires: Date.now() + TTL });
  if (cache.size > 500) for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
  return value;
}
