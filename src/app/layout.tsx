import type { ReactNode } from 'react';
import { Poppins } from 'next/font/google';
import './globals.css';

export const metadata = { title: 'Kripto Tanda Tangan', description: 'ECDSA P-256 digital signatures with QR-Code verification' };

const poppins = Poppins({ subsets: ['latin'], display: 'swap', weight: ['400', '500', '600', '700'] });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className={poppins.className}>{children}</body>
    </html>
  );
}
