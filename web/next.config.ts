import type { NextConfig } from 'next';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
};
export default nextConfig;
