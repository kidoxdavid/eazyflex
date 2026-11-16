import type { NextConfig } from "next";
// Optional: let a phone on the same Wi-Fi use `next dev`. Set DEV_ALLOWED_ORIGINS=192.168.1.20 (comma-separated hosts). Ignored in production.
const devOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const config: NextConfig = {
  ...(devOrigins.length ? { allowedDevOrigins: devOrigins } : {}),
  serverExternalPackages: ["argon2", "pg"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "35mb" } }, // up to 3 files x 10 MB per action
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
      ],
    }];
  },
};
export default config;
