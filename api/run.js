import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyRun } from '../shared/verifyRun.js';

let cachedDex;
function getDex() {
  if (!cachedDex) cachedDex = JSON.parse(readFileSync(fileURLToPath(new URL('../shared/dex.json', import.meta.url)), 'utf8'));
  return cachedDex;
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ reason: 'Method not allowed' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = verifyRun({ starter: body.starter, runSeed: body.runSeed, history: body.history }, getDex());
  if (!result.verified) return res.status(400).json({ reason: result.reason });
  return res.status(200).json(result);
}
