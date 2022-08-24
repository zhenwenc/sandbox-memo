/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  /**
   * Built-in ESLint support.
   *
   * https://nextjs.org/docs/basic-features/eslint
   */
  eslint: {
    ignoreDuringBuilds: true, // disable for this demo repo
  },
  /**
   * Enable/disable integration of SWC (Rust-based compiler)
   *
   * https://swc.rs
   * https://nextjs.org/docs/messages/failed-loading-swc
   */
  swcMinify: false,
};

export default nextConfig;
