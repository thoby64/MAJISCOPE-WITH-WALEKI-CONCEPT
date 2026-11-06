/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["pineal-zelma-synchronistical.ngrok-free.dev"],
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  }
}

export default nextConfig
