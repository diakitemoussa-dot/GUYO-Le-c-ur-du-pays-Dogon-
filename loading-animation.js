import { animate, createDrawable, splitText } from 'animejs';

// Image du logo pixellisée qui se "netteise" progressivement pendant le
// chargement réel : on la dessine dans un canvas basse résolution (blocs
// visibles) puis on augmente cette résolution au même rythme que les assets
// se chargent, jusqu'à une image nette en pleine définition.
const pixelCanvas = document.getElementById('logo-pixelate-canvas');
const pixelCtx = pixelCanvas.getContext('2d');
const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d');

// Image plein écran qui se "netteise" pendant le chargement : une version
// paysage pour ordinateur, une version portrait pour mobile (format_pc /
// format_smartphone), converties en WebP (les PNG d'origine font ~3 Mo chacun,
// conservés dans asset-original/). Remplacent les anciennes 'entre pc.png' /
// 'entre téléphone.png' qui n'existaient plus dans le dépôt.
const isMobileLogo = window.matchMedia('(max-width: 700px)').matches;
const logoImage = new Image();
logoImage.src = isMobileLogo
  ? 'asset/image/format_smartphone.webp'
  : 'asset/image/format_pc.webp';

const pixelState = { ratio: 0 };
const MIN_BLOCK_DIM = 6; // largeur (en "pixels") de l'image la plus grossière

function drawImageCover(ctx, img, dw, dh) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = dw / dh;
  let sx, sy, sw, sh;
  if (imgRatio > boxRatio) {
    sh = img.naturalHeight;
    sw = sh * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
}

function drawPixelated(ratio) {
  if (!logoImage.complete || !logoImage.naturalWidth) return;
  const w = pixelCanvas.width;
  const h = pixelCanvas.height;
  if (!w || !h) return;

  const smallW = Math.max(MIN_BLOCK_DIM, Math.round(MIN_BLOCK_DIM + (w - MIN_BLOCK_DIM) * ratio));
  const smallH = Math.max(1, Math.round(smallW * (h / w)));

  bufferCanvas.width = smallW;
  bufferCanvas.height = smallH;
  drawImageCover(bufferCtx, logoImage, smallW, smallH);

  pixelCtx.imageSmoothingEnabled = false;
  pixelCtx.clearRect(0, 0, w, h);
  pixelCtx.drawImage(bufferCanvas, 0, 0, smallW, smallH, 0, 0, w, h);
}

function resizePixelCanvas() {
  pixelCanvas.width = window.innerWidth;
  pixelCanvas.height = window.innerHeight;
  drawPixelated(pixelState.ratio);
}

window.addEventListener('resize', resizePixelCanvas);
logoImage.onload = resizePixelCanvas;
resizePixelCanvas();

// Effet d'écriture : les lettres de "LOADING" apparaissent une à une au démarrage
// (indépendant du pourcentage de chargement réel, purement décoratif à l'entrée).
const { chars } = splitText('#loading-word', { chars: true });
animate(chars, {
  opacity: [0, 1],
  translateY: [6, 0],
  delay: (_el, i) => i * 60,
  duration: 400,
  ease: 'outQuad',
});

// Ligne décorative "dessinée" en fonction du chargement réel, remplace l'ancienne
// barre de progression rectangulaire : son tracé (stroke) avance de 0 à 100% au
// même rythme que les assets/le modèle 3D se chargent.
const [drawLine] = createDrawable('#loading-draw-line');

let currentRatio = 0;

window.onLoadingProgress = function onLoadingProgress(ratio) {
  currentRatio = Math.max(0, Math.min(ratio, 1));
  animate(drawLine, {
    draw: `0 ${currentRatio}`,
    duration: 250,
    ease: 'outSine',
  });
  animate(pixelState, {
    ratio: currentRatio,
    duration: 400,
    ease: 'outSine',
    onUpdate: () => drawPixelated(pixelState.ratio),
  });
};
