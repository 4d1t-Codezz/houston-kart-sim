// Builds game/index.html for the desktop app: inlines the sim core and track data, and swaps CDN scripts
// and web fonts for local copies so the game runs fully offline. Online features read online.json if present.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), src = (p) => path.join(R, 'src', p), nm = (p) => path.join(R, 'node_modules', p);
const out = path.join(R, 'game'), V = path.join(out, 'vendor');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(V, 'fonts'), { recursive: true });
const copy = (from, to) => fs.copyFileSync(nm(from), path.join(V, to));
const THREE_FILES = [
  ['three/build/three.min.js', 'three.min.js'],
  ['three/examples/js/shaders/CopyShader.js', 'CopyShader.js'],
  ['three/examples/js/shaders/LuminosityHighPassShader.js', 'LuminosityHighPassShader.js'],
  ['three/examples/js/postprocessing/EffectComposer.js', 'EffectComposer.js'],
  ['three/examples/js/postprocessing/RenderPass.js', 'RenderPass.js'],
  ['three/examples/js/postprocessing/ShaderPass.js', 'ShaderPass.js'],
  ['three/examples/js/postprocessing/UnrealBloomPass.js', 'UnrealBloomPass.js'],
  ['three/examples/js/loaders/GLTFLoader.js', 'GLTFLoader.js'],
];
for (const [f, t] of THREE_FILES) copy(f, t);
copy('@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js');
let css = '';
for (const [pkg, fam, weights] of [['saira-condensed', 'Saira Condensed', [500, 700, 800]], ['ibm-plex-mono', 'IBM Plex Mono', [500, 600]]]) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`; copy(`@fontsource/${pkg}/files/${file}`, 'fonts/' + file);
    css += `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format('woff2')}\n`;
  }
}
fs.writeFileSync(path.join(V, 'fonts.css'), css);
let h = fs.readFileSync(src('game.html'), 'utf8');
h = h.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/, '<script src="vendor/three.min.js"></script>')
     .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/examples\/js\/[a-z]+\/([A-Za-z]+\.js)"><\/script>/g, '<script src="vendor/$1"></script>')
     .replace(/<link rel="preconnect"[^>]*>\n?/, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="vendor/fonts.css">')
     .replace(/<meta name="claude:[^>]*>\n?/, '');
if (/https:\/\/(cdn|fonts)/.test(h)) throw new Error('a CDN reference was left in the app build');
let online = null; try { online = JSON.parse(fs.readFileSync(path.join(R, 'online.json'), 'utf8')); } catch (e) {}
const onlineTag = '<script src="vendor/supabase.js"></script>\n<script>window.HKS_ONLINE=' + JSON.stringify(online && online.url ? { url: online.url, key: online.key } : null) + ';</script>';
// licensed kart model: kept out of the public repo; embedded only when assets-private/kart.glb exists (CI decrypts it)
const modelFile = path.join(R, 'assets-private', 'kart.glb'); let modelTag = '';
if (fs.existsSync(modelFile)) { fs.writeFileSync(path.join(V, 'kart-model.js'), 'window.KART_GLB_B64="' + fs.readFileSync(modelFile).toString('base64') + '";'); modelTag = '<script src="vendor/GLTFLoader.js"></script>\n<script src="vendor/kart-model.js"></script>\n'; }
h = h.replace('<script>/*CORE*/</script>', onlineTag + '\n' + modelTag + '<script>/*CORE*/</script>');
h = h.replace('/*CORE*/', () => fs.readFileSync(src('core.js'), 'utf8')).replace('/*TRACK*/', () => fs.readFileSync(src('track.json'), 'utf8')).replace('/*FLOOR*/', () => fs.readFileSync(src('floor.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + h + '</body></html>');
console.log('game/index.html', (h.length / 1024).toFixed(0) + ' KB', online && online.url ? '(online on)' : '(online off: add online.json)', modelTag ? '(licensed kart model on)' : '(built-in karts)');
