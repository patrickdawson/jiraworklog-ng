import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
};

export default nextConfig;
