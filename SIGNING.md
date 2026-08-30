# Release Signing

Polaris is prepared for free signing through [SignPath Foundation](https://signpath.org/). SignPath verifies that release artifacts were built from this public repository and keeps its signing keys in managed hardware.

## Foundation Onboarding

1. Enable multi-factor authentication for every maintainer with release or signing access.
2. Apply to SignPath Foundation with the project URL `https://github.com/Rhigo/Polaris-Audio` and identify the project as MIT licensed.
3. Accept SignPath's open-source terms and configure GitHub as the trusted build system.
4. Create a signing policy that requires manual approval for release artifacts.
5. Add the values supplied by SignPath to the repository:
   - Secret: `SIGNPATH_API_TOKEN`
   - Variable: `SIGNPATH_ORGANIZATION_ID`
   - Variable: `SIGNPATH_PROJECT_SLUG`
   - Variable: `SIGNPATH_SIGNING_POLICY_SLUG`
6. Run the **Build portable release** workflow from the GitHub Actions tab and approve its signing request in SignPath.
7. Enable **Publish the signed executable as a GitHub Release** only when the version is ready for public release. That path refuses to publish unless every SignPath setting is present and the signed executable was returned.

When the SignPath variables are absent, the workflow still produces a traceable unsigned artifact. Once they are configured, it also submits that exact artifact for signing and publishes the returned signed artifact separately.

Never commit certificates, private keys, API tokens, or passwords. A local Authenticode certificate can still be used by setting `CSC_LINK` and `CSC_KEY_PASSWORD` before running `npm run dist`.
