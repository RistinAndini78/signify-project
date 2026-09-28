import { allow, clientKey, json } from '../../../../lib/http';
import { createPortableKey, VaultError } from '../../../../lib/sig/keystore';

export async function POST(req: Request) {
  if (!allow(`portable-key:${clientKey(req)}`, 10)) return json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, 429);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Data passphrase tidak valid.' }, 400);
  try {
    const generated = createPortableKey(body.passphrase);
    return json({ keyFile: JSON.stringify(generated.key, null, 2), publicPem: generated.publicPem, fp: generated.key.fp }, 201);
  } catch (error) {
    if (error instanceof VaultError) return json({ error: 'Passphrase harus terdiri dari minimal 8 karakter.' }, 400);
    throw error;
  }
}