import type { NextConfig } from 'next';

// Plain files inside the app bundle, served by Electron over app:// — no server.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
