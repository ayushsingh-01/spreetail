/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Next.js / webpack NOT to bundle better-sqlite3.
  // On Vercel (Postgres mode) this native binary is never needed.
  // On local dev it is required by the host Node, not by the bundle.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
