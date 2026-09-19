export interface LineMeta {
  name: string;
  color: string;
}

// Mirrors the line metadata used by the LTA-backed /api/train-status endpoint in
// server.ts, so the frontend can match a disruption's line name (e.g. "East-West
// Line") against a route step's line code (e.g. "EWL") consistently.
export const LINE_META: Record<string, LineMeta> = {
  CCL: { name: 'Circle Line', color: '#FA9E0D' },
  EWL: { name: 'East-West Line', color: '#009645' },
  NSL: { name: 'North-South Line', color: '#D42E12' },
  DTL: { name: 'Downtown Line', color: '#005EC4' },
  NEL: { name: 'North-East Line', color: '#9016B2' },
  TEL: { name: 'Thomson-East Coast Line', color: '#9D5B25' },
};

// Accepts either a code ("EWL") or a full name ("East-West Line") and returns
// the canonical code, or null if it isn't a recognised heavy-rail line.
export function normalizeLineToCode(input: string): string | null {
  const v = input.trim().toUpperCase();
  if (LINE_META[v]) return v;
  // OneMap public-transport legs use two-letter service identifiers while LTA
  // and the rest of Transit Companion use the canonical line codes.
  const oneMapAliases: Record<string, string> = {
    CC: 'CCL',
    EW: 'EWL',
    NS: 'NSL',
    DT: 'DTL',
    NE: 'NEL',
    TE: 'TEL',
  };
  if (oneMapAliases[v]) return oneMapAliases[v];
  const found = Object.entries(LINE_META).find(([, meta]) => meta.name.toUpperCase() === v);
  return found ? found[0] : null;
}
