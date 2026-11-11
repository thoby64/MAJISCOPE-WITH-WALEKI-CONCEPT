/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["pineal-zelma-synchronistical.ngrok-free.dev"],
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  // In production builds the client-side backend URL is intentionally blanked
  // (lib/config.ts) so API calls become relative "/api/...". Proxy those to the
  // real backend server-side so login and data calls work without exposing a
  // localhost URL in the browser bundle. On Render, set BACKEND_ORIGIN to the
  // deployed backend origin (only used when NEXT_PUBLIC_BACKEND_URL is unset).
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:8000";
    return {
      // fallback = checked after dynamic routes (so app/api/upload-payload/[imageId]
      // still wins) and before rendering 404 — exactly what a catch-all
      // backend proxy needs.
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backendOrigin}/api/:path*`,
        },
      ],
    };
  },
}

export default nextConfig
