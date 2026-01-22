export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || "https://driving-cub-26.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
};
