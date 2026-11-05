/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Values that are written in this repository for tests and examples, so anyone who has seen the code knows them.
// Production refuses them: copying a test configuration to the live server must never leave the owner panel behind
// a known secret.
export const PUBLIC_EXAMPLES = Object.freeze({
  // The TOTP secret every authenticator-app tutorial uses, and the one in the test configuration.
  totpPrefixes: ["JBSWY3DPEHPK3PXP"],
  ownerPaths: ["/control-ci-secret-path", "/change-this-secret-path"],
  ownerPasswords: ["Test-Owner-Pass-2026"],
});

export const isPublicTotp = (secret) => Boolean(secret) && PUBLIC_EXAMPLES.totpPrefixes.some((p) => secret.toUpperCase().startsWith(p));
export const isPublicOwnerPath = (path) => PUBLIC_EXAMPLES.ownerPaths.includes(path);
export const isPublicOwnerPassword = (password) => PUBLIC_EXAMPLES.ownerPasswords.includes(String(password));
