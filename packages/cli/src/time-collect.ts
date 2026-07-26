import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

export interface TimeAccumulator {
  addFile(content: string, sinceMs?: number, untilMs?: number): void;
  report(): TimeReport;
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

export function createTimeAccumulator(gapMs: number): TimeAccumulator {
  const daysMap = new Map<string, { wallMs: number; activeMs: number }>();
  const projectsMap = new Map<string, number>();

  return {
    addFile(content: string, sinceMs?: number, untilMs?: number): void {
      const allEvents = timeEventsFromClaudeJsonl(content);
      const events = allEvents.filter((ev) => {
        if (sinceMs !== undefined && ev.ts < sinceMs) return false;
        if (untilMs !== undefined && ev.ts >= untilMs) return false;
        return true;
      });

      if (events.length === 0) return;

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
    },

    report(): TimeReport {
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
    },
  };
}

export async function collectTime(ctx: ScanContext, gapMs: number): Promise<TimeReport> {
  const roots = await resolveRoots(ctx, PROJECTS);
  const timeAcc = createTimeAccumulator(gapMs);
  const sinceMs = ctx.since?.getTime();
  const untilMs = ctx.until?.getTime();
  const seenFiles = new Set<string>();

  for (const root of roots) {
    for await (const file of walkJsonl(root)) {
      const normFile = resolve(file);
      if (seenFiles.has(normFile)) continue;
      seenFiles.add(normFile);

      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      timeAcc.addFile(content, sinceMs, untilMs);
    }
  }

  return timeAcc.report();
}

