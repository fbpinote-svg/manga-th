import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Konva references node-canvas at bundle time; alias it away for the browser/webpack build
  webpack: (c) => {
    c.resolve.alias = { ...c.resolve.alias, canvas: false };
    return c;
  },
};

export default nextConfig;
