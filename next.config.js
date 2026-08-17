/** @type {import('next').NextConfig} */
const path = require('node:path')

const nextConfig = {
  reactStrictMode: true,
  // A single page exceeding this aborts the WHOLE build, and this site
  // prerenders 500 of them — 23 of which render ~1,300 games each out of a
  // 700KB JSON file. The default 60s is comfortable on an idle machine and
  // is not comfortable on a loaded one: under CPU contention the build failed
  // repeatedly, and the page it finally died on was Next's own built-in /500,
  // which contains none of this project's code. Three minutes is still a
  // hard ceiling on a genuine hang, and it is no longer a ceiling on a busy
  // runner having an ordinary bad day.
  staticPageGenerationTimeout: 180,
  // Pinned because a sibling lockfile one directory up makes Next infer the
  // wrong workspace root and warn on every build.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'a.espncdn.com' }],
  },
}

module.exports = nextConfig
