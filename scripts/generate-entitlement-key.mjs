#!/usr/bin/env node
/**
 * Prints a signed Pro/Enterprise entitlement key for local builds.
 * Uses TASKFORGE_ENTITLEMENT_SECRET (or legacy AUTODESK_ENTITLEMENT_SECRET) when set — must match the Electron main process.
 */
import { createHmac } from 'node:crypto';

const secret =
  process.env.TASKFORGE_ENTITLEMENT_SECRET ??
  process.env.AUTODESK_ENTITLEMENT_SECRET ??
  'autodesk-desktop-dev-entitlement-v1';
const payload = Buffer.from(JSON.stringify({ v: 1, tier: 'pro_enterprise' })).toString('base64url');
const sig = createHmac('sha256', secret).update(payload).digest('base64url');
console.log(`adent1.${payload}.${sig}`);
