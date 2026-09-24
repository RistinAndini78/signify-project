import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Kripto Tanda Tangan', description: 'ECDSA P-256 digital signatures with QR-Code verification' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
