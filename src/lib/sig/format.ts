// The signature block and the messages that are signed. All of the signing flow is written here; only ECDSA and SHA-256 come from Node.
import { FormatError, b64u, fromB64u, sha256hex } from './encoding';
import { PUB_LEN, SIG_LEN } from './keys';

export interface Meta { name: string; title: string; org: string; time: string }

/** One signature block. Field order is fixed: the JSON text must equal its own canonical form. */
export interface Block { v: 1; id: string; alg: 'ES256'; h: string; n: string; t: string; o: string; d: string; pk: string; sig: string; qs: string }

const MARK = '%KRIPTO-SIG-V1 ';
const MAX_LINE = 4096;
const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

export const metaJson = (m: Meta): string => JSON.stringify([m.name, m.title, m.org, m.time]);
export const qrMessage = (id: string, fp: string, m: Meta): string => `KRIPTO-QR1|${id}|${fp}|${metaJson(m)}`;
/** The document message also covers the QR signature (`qs`), so no field of the block can change while the signature stays valid. */
export const docMessage = (hashHex: string, id: string, fp: string, m: Meta, qs: string): string => `KRIPTO-DOC1|${hashHex}|${id}|${fp}|${metaJson(m)}|${qs}`;
export const metaOf = (b: Block): Meta => ({ name: b.n, title: b.t, org: b.o, time: b.d });

const canonical = (b: Block): string =>
  JSON.stringify({ v: b.v, id: b.id, alg: b.alg, h: b.h, n: b.n, t: b.t, o: b.o, d: b.d, pk: b.pk, sig: b.sig, qs: b.qs });

/** The bytes appended after the document for one signature. */
export function encodeBlock(b: Block): Buffer {
  return Buffer.from(`\n${MARK}${b64u(Buffer.from(canonical(b), 'utf8'))}\n`, 'latin1');
}

function decodeBlock(b64: string): Block {
  const text = fromB64u(b64).toString('utf8');
  let o: Block;
  try { o = JSON.parse(text) as Block; } catch { throw new FormatError('bad JSON'); }
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (o?.v !== 1 || o.alg !== 'ES256' || !str(o.id, 32) || !/^[0-9a-f]{64}$/.test(String(o.h)) || !str(o.n, 100) || !str(o.t, 100) || !str(o.o, 100)
    || !TIME_RE.test(String(o.d)) || !str(o.pk, 120) || !str(o.sig, 100) || !str(o.qs, 100)) throw new FormatError('bad block');
  if (canonical(o) !== text) throw new FormatError('non-canonical block');
  if (fromB64u(o.pk).length !== PUB_LEN || fromB64u(o.sig).length !== SIG_LEN || fromB64u(o.qs).length !== SIG_LEN || fromB64u(o.id).length < 6) throw new FormatError('bad block');
  return o;
}

export interface Located { block: Block; start: number } // start = offset of the block's leading newline; the signed bytes are file[0, start)

/**
 * Peels signature blocks off the end of the file, last first, and returns them in signing order.
 * Anything that is not a well formed block at the end stops the search, so a damaged block is never silently skipped.
 */
export function parseBlocks(file: Buffer): Located[] {
  const found: Located[] = [];
  let end = file.length;
  while (end > 1 && file[end - 1] === 0x0a) {
    const prev = file.lastIndexOf(0x0a, end - 2);
    if (prev < 0 || end - 1 - (prev + 1) > MAX_LINE) break;
    const line = file.toString('latin1', prev + 1, end - 1);
    if (!line.startsWith(MARK)) break;
    try {
      found.unshift({ block: decodeBlock(line.slice(MARK.length)), start: prev });
    } catch {
      break;
    }
    end = prev;
  }
  return found;
}

export { sha256hex };
