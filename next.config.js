/** @type {import('next').NextConfig} */
const path = require('node:path')

const nextConfig = {
  reactStrictMode: true,
  // Pinned because a sibling lockfile one directory up makes Next infer the
  // wrong workspace root and warn on every build.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'a.espncdn.com' }],
  },
}

module.exports = nextConfig
