import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { BlobKeystore } from './blob-keystore';
import { Keystore } from './sig/keystore';

/** Key vault directory: KEYSTORE_DIR, or ./data/keystore (git-ignored). Holds public data and password-sealed private keys only. */
export const keystore = (): Keystore | BlobKeystore => process.env.PRIVATE_BLOB_READ_WRITE_TOKEN
    ? new BlobKeystore()
    : new Keystore(process.env.KEYSTORE_DIR ?? join(process.cwd(), 'data', 'keystore'));

/** Public address used in QR links. Set PUBLIC_URL when a specific LAN address is required. */
export const originOf = (req: Request): string => {
	if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
	const requestUrl = new URL(req.url);
	if (!['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname)) return requestUrl.origin;
	const addresses = Object.values(networkInterfaces()).flatMap((items) => items ?? [])
		.filter((item) => item.family === 'IPv4' && !item.internal)
		.map((item) => item.address);
	return addresses.length ? `${requestUrl.protocol}//${addresses[0]}:${requestUrl.port}` : requestUrl.origin;
};
