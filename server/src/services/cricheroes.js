import cron from 'node-cron';
import { config } from '../config.js';
import { Match, Player, Setting, SyncCache, Team, Tournament } from '../models.js';

const models = { tournament: Tournament, team: Team, player: Player, match: Match };
export function mergeSource(record) { return { ...record.syncedData, ...record.toObject?.(), ...record.manualOverrides }; }

export async function runCricHeroesSync() {
  const setting = await Setting.findOne({ key: 'cricheroesSyncEnabled' }).lean();
  if (setting ? !setting.value : !config.syncEnabled) return { skipped: true, reason: 'disabled' };
  const result = { updated: 0, failed: 0 };
  for (const [kind, Model] of Object.entries(models)) {
    const records = await Model.find({ cricheroesUrl: { $regex: '^https://(www\\.)?cricheroes\\.', $options: 'i' } });
    for (const record of records) {
      const key = `cricheroes:${kind}:${record._id}`;
      try {
        // Public pages only. We cache lightweight page metadata; no request path ever invokes this worker.
        const response = await fetch(record.cricheroesUrl, { headers: { 'User-Agent': 'ICL-public-sync/1.0' }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
        const payload = { pageTitle: title, fetchedAt: new Date(), url: record.cricheroesUrl };
        record.syncedData = { ...(record.syncedData || {}), ...payload }; record.lastSyncedAt = new Date();
        await record.save();
        await SyncCache.findOneAndUpdate({ key }, { source: 'cricheroes', status: 'ok', payload, error: null, lastUpdatedAt: new Date() }, { upsert: true }); result.updated++;
      } catch (error) {
        await SyncCache.findOneAndUpdate({ key }, { source: 'cricheroes', status: 'stale', error: error.message }, { upsert: true }); result.failed++;
      }
    }
  }
  return result;
}

export function startSyncCron() {
  if (!cron.validate(config.syncCron)) return console.error('Invalid CRICHEROES_SYNC_CRON');
  cron.schedule(config.syncCron, () => runCricHeroesSync().catch((e) => console.error('CricHeroes sync:', e.message)));
}
