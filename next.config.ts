import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow access from local network device (e.g. your phone)
  allowedDevOrigins: ['192.168.1.3', 'localhost', '127.0.0.1'],
} as NextConfig;

export default nextConfig;
