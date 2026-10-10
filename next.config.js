const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build-time deploy stamp + commit, surfaced on Settings as "Last Commit".
  // Evaluated once when Vercel builds the deploy (i.e. on each push).
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '',
    NEXT_PUBLIC_COMMIT_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE || '',
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // @anthropic-ai/sdk: Next 14.1's server bundling mangles a regex in the SDK
    // ("Range out of order in character class") — load it from node_modules instead.
    serverComponentsExternalPackages: ['@prisma/client', 'firebase-admin', 'xlsx', '@anthropic-ai/sdk'],
  },
  webpack: (config) => {
    const path = require('path')
    config.resolve.alias = {
      ...config.resolve.alias,
      // Use vendored qz-tray with semver crash fix
      'qz-tray':   path.resolve(__dirname, 'src/lib/qz-tray-patched.js'),
      // jsPDF optional deps — not used
      canvg:       false,
      html2canvas: false,
      dompurify:   false,
    }
    // Force @firebase/auth to browser bundle (avoids undici private-field parse error)
    config.resolve.alias['@firebase/auth'] = path.resolve(
      __dirname, 'node_modules/firebase/node_modules/@firebase/auth/dist/esm2017/index.js'
    )
    return config
  },
}

module.exports = withPWA(nextConfig)
