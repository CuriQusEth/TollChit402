import express from "express";
import { createPremiumRouter } from "./_premium";

/**
 * Vercel entry point for the x402-protected endpoint.
 *
 * Vercel accepts an Express app as a serverless handler, so mounting the shared
 * router here keeps production behaviour identical to `npm run dev`.
 */
const app = express();
app.use(createPremiumRouter());

export default app;
