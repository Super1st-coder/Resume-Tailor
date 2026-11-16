/** @type {import('next').NextConfig} */
const nextConfig = {
  // unpdf ships its own pdf.js build; load it at runtime instead of bundling.
  experimental: { serverComponentsExternalPackages: ["unpdf"] },
};

export default nextConfig;
