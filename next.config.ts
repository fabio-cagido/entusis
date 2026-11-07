import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
