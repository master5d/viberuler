import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, ScanContext } from '../types.js';
import { agentHomes } from '../roots.js';

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
  // Harness / agent-agnostic layer trend (gstack now rides on top of 9 envs).
  // Markers are best-effort conventional home dotdirs; a miss just never fires.
  { name: 'gstack', markers: ['.gstack', '.config/gstack'] },
  { name: 'Factory', markers: ['.factory'] },
  { name: 'opencode', markers: ['.opencode', '.config/opencode'] },
  { name: 'openclaw', markers: ['.openclaw'] },
  { name: 'Slate', markers: ['.slate'] },
  { name: 'Hermes', markers: ['.hermes'] },
  { name: 'gbrain', markers: ['.gbrain'] },
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
  const homes = agentHomes(ctx); // OS home + any --agent-home
  for (const agent of AGENT_ROSTER) {
    const marks = agent.markers.flatMap((m) => homes.map((h) => join(h, ...m.split('/'))));
    for (const mark of marks) {
      if (await exists(mark)) {
        found.push(agent.name);
        break; // one marker is enough — an agent is listed once, not per home
      }
    }
  }
  // Antigravity reuses the ~/.gemini home, so a leftover .gemini/settings.json
  // would otherwise report a "Gemini CLI" the user has replaced. When Antigravity
  // is present it supersedes Gemini CLI in the stable.
  if (found.includes('Antigravity')) return found.filter((n) => n !== 'Gemini CLI');
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
