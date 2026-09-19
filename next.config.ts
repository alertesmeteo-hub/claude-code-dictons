import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  env: {
    // Figés au moment du build : version du module et date de mise en ligne.
    NEXT_PUBLIC_VERSION: pkg.version,
    NEXT_PUBLIC_DATE_BUILD: new Date().toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  },
};

export default nextConfig;
