export interface ShareCardData {
  v: string;            // client version
  s: number;            // vibe_score
  tpu: number | null;   // tok_per_usd
  tpl: number | null;   // tok_per_loc
  loc: number;
  streak: number;
  hours?: number;       // attention hours, 1 decimal — optional
  agents?: string[];
}

export function encodeShareCard(d: ShareCardData): string {
  const copy: ShareCardData = { ...d };
  let json = JSON.stringify(copy);
  let encoded = Buffer.from(json, 'utf-8').toString('base64url');

  if (encoded.length > 1800 && copy.agents !== undefined) {
    delete copy.agents;
    json = JSON.stringify(copy);
    encoded = Buffer.from(json, 'utf-8').toString('base64url');
  }

  return encoded;
}

export function decodeShareCard(s: string): ShareCardData {
  if (!s || typeof s !== 'string') {
    throw new Error('Invalid input: expected non-empty string');
  }

  let json: string;
  try {
    json = Buffer.from(s, 'base64url').toString('utf-8');
  } catch {
    throw new Error('Invalid base64url encoding');
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON payload');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid payload: expected object');
  }

  const record = obj as Record<string, unknown>;

  if (typeof record.v !== 'string') {
    throw new Error('Missing or invalid required key: v');
  }
  if (typeof record.s !== 'number' || Number.isNaN(record.s)) {
    throw new Error('Missing or invalid required key: s');
  }
  if (record.tpu !== null && (typeof record.tpu !== 'number' || Number.isNaN(record.tpu))) {
    throw new Error('Missing or invalid required key: tpu');
  }
  if (record.tpl !== null && (typeof record.tpl !== 'number' || Number.isNaN(record.tpl))) {
    throw new Error('Missing or invalid required key: tpl');
  }
  if (typeof record.loc !== 'number' || Number.isNaN(record.loc)) {
    throw new Error('Missing or invalid required key: loc');
  }
  if (typeof record.streak !== 'number' || Number.isNaN(record.streak)) {
    throw new Error('Missing or invalid required key: streak');
  }

  if (record.hours !== undefined && (typeof record.hours !== 'number' || Number.isNaN(record.hours))) {
    throw new Error('Invalid optional key: hours');
  }
  if (record.agents !== undefined && (!Array.isArray(record.agents) || !record.agents.every((a) => typeof a === 'string'))) {
    throw new Error('Invalid optional key: agents');
  }

  return {
    v: record.v,
    s: record.s,
    tpu: record.tpu as number | null,
    tpl: record.tpl as number | null,
    loc: record.loc as number,
    streak: record.streak as number,
    ...(record.hours !== undefined ? { hours: record.hours as number } : {}),
    ...(record.agents !== undefined ? { agents: record.agents as string[] } : {}),
  };
}

export function shareCardUrl(base: string, d: ShareCardData): string {
  const cleanBase = base.replace(/\/+$/, '');
  const encoded = encodeShareCard(d);
  return `${cleanBase}/card?d=${encoded}`;
}
