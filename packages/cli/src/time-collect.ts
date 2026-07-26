import { readFile } from 'node:fs/promises';
import type { ScanContext } from './types.js';
import { resolveRoots } from './roots.js';
import { PROJECTS, walkJsonl } from './collectors/claude-code.js';
import { analyzeTimestamps, timeEventsFromClaudeJsonl } from './time.js';

export interface TimeReport {
  totalWallMs: number;
  totalActiveMs: number;
  days: { day: string; wallMs: number; activeMs: number }[]; // day = local YYYY-MM-DD, sorted asc
  projects: { name: string; activeMs: number }[]; // sorted desc by activeMs
}

function extractProjectName(cwd: string | null): string {
  if (!cwd) return 'other';
  const cleaned = cwd.replace(/[/\\]+$/, '');
  if (!cleaned) return 'other';
  const parts = cleaned.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last || 'other';
}

function toLocalDateString(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Known v1 limitation: token accounting in audit.ts walks only `ctx.home`'s projects dir,
 * while collectTime resolves ALL roots (agent-homes, CLAUDE_CONFIG_DIR). On multi-home rigs,
 * the time section covers more homes than the token numbers. Follow-up tracked in repo issue
 * about fusing the walks.
 */
export async function collectTime(ctx: ScanContext, gapMs: number): Promise<TimeReport> {
  const roots = await resolveRoots(ctx, PROJECTS);

  const daysMap = new Map<string, { wallMs: number; activeMs: number }>();
  const projectsMap = new Map<string, number>();

  for (const root of roots) {
    for await (const file of walkJsonl(root)) {
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch {
        continue;
      }

      const allEvents = timeEventsFromClaudeJsonl(content);
      const events = allEvents.filter((ev) => {
        if (ctx.since && ev.ts < ctx.since.getTime()) return false;
        if (ctx.until && ev.ts >= ctx.until.getTime()) return false;
        return true;
      });

      if (events.length === 0) continue;

      const firstCwdEvent = events.find((ev) => ev.cwd !== null);
      const projectName = extractProjectName(firstCwdEvent ? firstCwdEvent.cwd : null);

      const dayGroups = new Map<string, number[]>();
      for (const ev of events) {
        const dayKey = toLocalDateString(ev.ts);
        let group = dayGroups.get(dayKey);
        if (!group) {
          group = [];
          dayGroups.set(dayKey, group);
        }
        group.push(ev.ts);
      }

      let fileActiveMs = 0;

      for (const [dayKey, tsList] of dayGroups.entries()) {
        const { wallMs, activeMs } = analyzeTimestamps(tsList, gapMs);

        const existingDay = daysMap.get(dayKey) || { wallMs: 0, activeMs: 0 };
        existingDay.wallMs += wallMs;
        existingDay.activeMs += activeMs;
        daysMap.set(dayKey, existingDay);

        fileActiveMs += activeMs;
      }

      const existingProj = projectsMap.get(projectName) || 0;
      projectsMap.set(projectName, existingProj + fileActiveMs);
    }
  }

  const days = Array.from(daysMap.entries())
    .map(([day, stats]) => ({ day, wallMs: stats.wallMs, activeMs: stats.activeMs }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const projects = Array.from(projectsMap.entries())
    .map(([name, activeMs]) => ({ name, activeMs }))
    .sort((a, b) => b.activeMs - a.activeMs || a.name.localeCompare(b.name));

  let totalWallMs = 0;
  let totalActiveMs = 0;
  for (const d of days) {
    totalWallMs += d.wallMs;
    totalActiveMs += d.activeMs;
  }

  return {
    totalWallMs,
    totalActiveMs,
    days,
    projects,
  };
}
