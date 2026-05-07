/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    const apiBase = process.env.INTERNAL_API_URL || 'http://api:8410';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
      {
        source: '/health/:path*',
        destination: `${apiBase}/health/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
