import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const distPath = join(__dirname, 'dist');
const indexPath = join(distPath, 'index.html');

if (!existsSync(distPath)) {
  console.error('ERROR: dist folder not found at', distPath);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  console.error('ERROR: index.html not found at', indexPath);
  process.exit(1);
}

console.log('Serving static files from:', distPath);

app.use(express.static(distPath, {setHeaders: (res, path) => {
  if (path.endsWith('watch-push-sw.js')) res.setHeader('Cache-Control', 'no-cache');
}}));

// Routage SPA : toute URL inconnue renvoie index.html.
app.get('/{*splat}', (req, res) => {
  res.sendFile(indexPath);
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
