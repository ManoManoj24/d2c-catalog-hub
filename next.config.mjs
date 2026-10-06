/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "bcryptjs", "exceljs", "@aws-sdk/client-s3"],
  poweredByHeader: false,
};

export default nextConfig;
