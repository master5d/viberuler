import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext } from '../types.js';

// Ordered roster: first marker hit wins. Markers are paths relative to home.
// More specific markers must come before generic ones that share a parent
// (Antigravity nests under .gemini, so it is listed before Gemini CLI).
export const AGENT_ROSTER: Array<{ name: string; markers: string[] }> = [
  { name: 'Claude Code', markers: ['.claude/projects', '.claude/settings.json'] },
  { name: 'Codex', markers: ['.codex/sessions', '.codex/config.toml'] },
  { name: 'Antigravity', markers: ['.gemini/antigravity-cli', '.antigravity'] },
  { name: 'Gemini CLI', markers: ['.gemini/settings.json', '.gemini/oauth_creds.json'] },
  { name: 'Cursor', markers: ['.cursor'] },
  { name: 'Windsurf', markers: ['.codeium/windsurf', '.windsurf'] },
  { name: 'Aider', markers: ['.aider.conf.yml', '.aider'] },
  { name: 'Cline', markers: ['.cline'] },
  { name: 'Copilot CLI', markers: ['.copilot'] },
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectAgents(ctx: ScanContext): Promise<string[]> {
  const found: string[] = [];
  for (const agent of AGENT_ROSTER) {
    for (const marker of agent.markers) {
      if (await exists(join(ctx.home, ...marker.split('/')))) {
        found.push(agent.name);
        break;
      }
    }
  }
  return found;
}

export const agentsCollector: Collector = {
  id: 'agents',
  async detect() {
    return true; // pure local fs probes — always cheap, always safe
  },
  async collect(ctx) {
    return { agents: await detectAgents(ctx) };
  },
};
