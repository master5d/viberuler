import { describe, it, expect } from 'vitest';
import {
  encodeShareCard,
  decodeShareCard,
  shareCardUrl,
  type ShareCardData,
} from '../src/share-card.js';

describe('share-card module', () => {
  const sampleData: ShareCardData = {
    v: '0.7.0',
    s: 88,
    tpu: 1250,
    tpl: 45,
    loc: 5400,
    streak: 7,
    hours: 12.4,
    agents: ['Claude Code', 'Cursor'],
    ach: ['first_scan', 'token_burn_1m'],
  };

  it('round-trip: decodeShareCard(encodeShareCard(d)) deep-equals d', () => {
    const encoded = encodeShareCard(sampleData);
    const decoded = decodeShareCard(encoded);
    expect(decoded).toEqual(sampleData);
  });

  it('base64url alphabet: encoded string contains no +, /, =', () => {
    const encoded = encodeShareCard(sampleData);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('size guard: a data object exceeding 1800 chars loses ach first, agents second', () => {
    const longAch = Array.from({ length: 60 }, (_, i) => `achievement_${i}_${'x'.repeat(40)}`);
    const shortAgents = Array.from({ length: 20 }, (_, i) => `agent_${i}`);

    const largeDataAchOnlyDrop: ShareCardData = {
      ...sampleData,
      ach: longAch,
      agents: shortAgents,
    };

    const encoded1 = encodeShareCard(largeDataAchOnlyDrop);
    expect(encoded1.length).toBeLessThanOrEqual(1800);
    const decoded1 = decodeShareCard(encoded1);
    expect(decoded1.ach).toBeUndefined();
    expect(decoded1.agents).toEqual(shortAgents);
    expect(decoded1.v).toBe(sampleData.v);
    expect(decoded1.s).toBe(sampleData.s);

    const longAgents = Array.from({ length: 100 }, (_, i) => `agent_${i}_${'y'.repeat(40)}`);
    const largeDataBothDrop: ShareCardData = {
      ...sampleData,
      ach: longAch,
      agents: longAgents,
    };

    const encoded2 = encodeShareCard(largeDataBothDrop);
    expect(encoded2.length).toBeLessThanOrEqual(1800);
    const decoded2 = decodeShareCard(encoded2);
    expect(decoded2.ach).toBeUndefined();
    expect(decoded2.agents).toBeUndefined();
    expect(decoded2.v).toBe(sampleData.v);
    expect(decoded2.s).toBe(sampleData.s);
  });

  it('malformed input throws an Error', () => {
    expect(() => decodeShareCard('')).toThrow();
    expect(() => decodeShareCard('!!!')).toThrow();

    const arrayBase64Url = Buffer.from(JSON.stringify([1, 2]), 'utf-8').toString('base64url');
    expect(() => decodeShareCard(arrayBase64Url)).toThrow();

    const missingKeyBase64Url = Buffer.from(JSON.stringify({ v: '0.7.0' }), 'utf-8').toString('base64url');
    expect(() => decodeShareCard(missingKeyBase64Url)).toThrow();
  });

  it('shareCardUrl builds <base>/card?d=<encoded>', () => {
    const url1 = shareCardUrl('https://viberuler.dev', sampleData);
    const expectedEncoded = encodeShareCard(sampleData);
    expect(url1).toBe(`https://viberuler.dev/card?d=${expectedEncoded}`);

    const url2 = shareCardUrl('https://viberuler.dev/', sampleData);
    expect(url2).toBe(`https://viberuler.dev/card?d=${expectedEncoded}`);
  });
});
