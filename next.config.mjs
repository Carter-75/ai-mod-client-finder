const allowedFrameAncestors = [
  "'self'",
  'https://carter-portfolio.fyi',
  'https://carter-portfolio.vercel.app',
  'https://carters-projects-7dd7e086.vercel.app',
  'https://*.carters-projects-7dd7e086.vercel.app',
  'http://localhost:3000',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    const frameAncestors = allowedFrameAncestors.join(' ');
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors};`,
          },
          {
            key: 'X-Frame-Options',
            value: 'ALLOW-FROM https://carter-portfolio.fyi',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
