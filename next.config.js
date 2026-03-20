const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'firebase-admin', 'xlsx', 'sharp'],
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
