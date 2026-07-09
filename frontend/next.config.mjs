/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  outputFileTracingIncludes: {
    '/api/training-chat': ['./data/rag-index.json', './data/scenario_library.json'],
    '/api/training-report': ['./data/rag-index.json', './data/scenario_library.json'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
