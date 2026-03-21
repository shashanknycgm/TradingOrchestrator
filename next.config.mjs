/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep yahoo-finance2 server-side only so webpack doesn't try to bundle its test deps
    serverComponentsExternalPackages: ['yahoo-finance2'],
  },
};

export default nextConfig;
