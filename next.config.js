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
    serverComponentsExternalPackages: ['@prisma/client', 'firebase-admin', 'xlsx'],
  },
  webpack: (config) => {
    // jsPDF optionally requires these for SVG/HTML rendering — we don't use them,
    // so stub them out to prevent "module not found" build errors.
    config.resolve.alias = {
      ...config.resolve.alias,
      canvg:       false,
      html2canvas: false,
      dompurify:   false,
    }
    return config
  },
}

module.exports = withPWA(nextConfig)
