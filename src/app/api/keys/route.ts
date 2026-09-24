import { allow, clientKey, json } from '../../../lib/http';
import { VaultError } from '../../../lib/sig/keystore';
import { keystore } from '../../../lib/vault';

export async function GET() {
  return json({ keys: keystore().list() });
}

export async function POST(req: Request) {
  if (!allow(`keys:${clientKey(req)}`, 10)) return json({ error: 'too many requests' }, 429);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'JSON body required' }, 400);
  try {
    return json(keystore().create({ name: body.name, title: body.title, org: body.org, passphrase: body.passphrase }), 201);
  } catch (e) {
    if (e instanceof VaultError) return json({ error: e.message }, 400);
    throw e;
  }
}
