import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
    output: 'export',
    distDir: 'dist',
    trailingSlash: true,
    skipTrailingSlashRedirect: true,
    basePath: "/control"
};

export default nextConfig;
