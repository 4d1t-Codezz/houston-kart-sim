// macOS: give the unsigned app an ad-hoc signature so Apple Silicon will run it.
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const appPath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' }); // stray Finder/provenance attributes block codesign
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
