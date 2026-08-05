import './loading-animation.js';
import './scene3d.js';
import './scene3d-part2.js';

// Seul le ciel (affiché au retour vers la partie 1) est préchargé ici. Les anciennes
// images la falaise / les roches / la coline étaient téléchargées au démarrage mais
// n'étaient utilisées par AUCUN code : les modèles GLB embarquent leurs propres
// textures. Elles bloquaient inutilement l'écran de chargement.
const ASSETS_TO_PRELOAD = [
  'asset/image/sky.webp',
];

const loadingScreen = document.getElementById('loading-screen');
const experience = document.getElementById('experience');
const revealCircle = document.getElementById('reveal-circle');
const scene3d = document.getElementById('scene3d');
const scene3dPart2 = document.getElementById('scene3d-part2');
const scrollSpace = document.getElementById('scroll-space');
const scrollHint = document.getElementById('scroll-hint');

const DELAY_BEFORE_SCENE3D = 2000;
const SCROLL_SPACE_MULTIPLIER = 40;

// Ambiance de vent en boucle pour la partie 1. Les navigateurs bloquent l'autoplay
// avec son tant qu'il n'y a pas eu d'interaction utilisateur, donc on retente au
// premier scroll/clic/touche si la tentative initiale échoue.
// Le vent n'est chargé qu'au premier geste utilisateur (précharger 700 Ko de MP3
// au démarrage ralentissait l'écran de chargement pour un son qui ne peut de toute
// façon pas jouer avant une interaction, à cause de l'autoplay bloqué).
const ambientAudio = new Audio('asset/audio/wind-ambience.mp3');
ambientAudio.loop = true;
ambientAudio.preload = 'none';
ambientAudio.volume = 0;

// Son joué à l'entrée dans la partie 2 (juste après le chargement).
const entranceAudio = new Audio("asset/audio/son d'entre.mp3");
entranceAudio.preload = 'auto';

const AMBIENT_BASE_VOLUME = 0.28;
const AMBIENT_FADE_IN_MS = 2500;
// Impression de vitesse : quand l'utilisateur scrolle vite, le vent souffle plus fort
// et un peu plus vite (playbackRate), puis retombe doucement au calme.
const WIND_GUST_VOLUME_BOOST = 0.2;
const WIND_GUST_PITCH_BOOST = 0.35;
const WIND_GUST_DECAY = 0.93; // par frame

let ambientFadeRatio = 1;
let ambientFadeInProgress = 0;
let ambientStarted = false;
let windGustIntensity = 0;
let audioMuted = false;

function applyMuteState() {
  ambientAudio.muted = audioMuted;
  entranceAudio.muted = audioMuted;
  if (typeof window.setChirpMuted === 'function') {
    window.setChirpMuted(audioMuted);
  }
  if (typeof window.setPart2Muted === 'function') {
    window.setPart2Muted(audioMuted);
  }
}

window.toggleAudioMute = function toggleAudioMute() {
  audioMuted = !audioMuted;
  applyMuteState();
  return audioMuted;
};

function applyAmbientVolume() {
  if (!ambientStarted) return;
  const base = AMBIENT_BASE_VOLUME * ambientFadeRatio * ambientFadeInProgress;
  const boosted = base + WIND_GUST_VOLUME_BOOST * windGustIntensity * ambientFadeRatio;
  ambientAudio.volume = Math.max(0, Math.min(boosted, 1));
  ambientAudio.playbackRate = 1 + WIND_GUST_PITCH_BOOST * windGustIntensity;
}

window.setAmbientVolume = function setAmbientVolume(ratio) {
  ambientFadeRatio = Math.max(0, Math.min(ratio, 1));
  applyAmbientVolume();
};

window.setWindIntensity = function setWindIntensity(intensity) {
  windGustIntensity = Math.max(windGustIntensity, Math.max(0, Math.min(intensity, 1)));
};

function decayWindGustLoop() {
  if (windGustIntensity > 0) {
    windGustIntensity *= WIND_GUST_DECAY;
    if (windGustIntensity < 0.005) windGustIntensity = 0;
    applyAmbientVolume();
  }
  requestAnimationFrame(decayWindGustLoop);
}
requestAnimationFrame(decayWindGustLoop);

function fadeInAmbient() {
  const start = performance.now();
  function step(ts) {
    ambientFadeInProgress = Math.min((ts - start) / AMBIENT_FADE_IN_MS, 1);
    applyAmbientVolume();
    if (ambientFadeInProgress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function tryStartAmbient() {
  if (ambientStarted) return;
  ambientAudio.play().then(() => {
    ambientStarted = true;
    fadeInAmbient();
    if (typeof window.startBirdChirps === 'function') {
      window.startBirdChirps();
    }
    AMBIENT_UNLOCK_EVENTS.forEach((evt) => {
      window.removeEventListener(evt, tryStartAmbient);
    });
  }).catch(() => {
    // Autoplay bloqué : on retentera au prochain événement d'interaction.
  });
}

// Seuls un clic/appui (pointerdown), une touche ou un tap comptent comme un vrai geste
// utilisateur pour les navigateurs — 'scroll'/'wheel' sont ignorés pour le déblocage audio,
// donc on ne s'appuie pas sur eux. Cliquer sur l'indication "Scroll" (rendue cliquable en
// CSS) déclenche ce déblocage de façon naturelle avant que l'utilisateur ne scrolle.
const AMBIENT_UNLOCK_EVENTS = ['pointerdown', 'click', 'keydown', 'touchstart'];
AMBIENT_UNLOCK_EVENTS.forEach((evt) => {
  window.addEventListener(evt, tryStartAmbient, { passive: true });
});

// Le son d'entrée doit démarrer exactement au moment de l'entrée dans la partie 2,
// pas au prochain geste (contrairement à l'ambiance de vent, qui peut attendre sans
// problème). Comme cette entrée n'est pas déclenchée par un clic, le navigateur bloque
// souvent la lecture avec son à cet instant précis. Pour rester synchronisé malgré ce
// blocage, on démarre le son MUET (l'autoplay muet n'est jamais bloqué) puis on le
// démasque dès le premier vrai geste utilisateur, sans le relancer plus tard.
//
// Un son muet qu'on ne fait que "démasquer" reste inaudible si sa lecture (muette)
// est déjà terminée au moment du geste (fichier court, utilisateur qui met du temps
// à interagir) : démasquer un son fini ne produit aucun son. Dans ce cas, on le
// relance depuis le début, cette fois audible — mieux vaut l'entendre en retard que
// jamais.
let entrancePlayed = false;

function unmuteEntranceSound() {
  AMBIENT_UNLOCK_EVENTS.forEach((evt) => {
    window.removeEventListener(evt, unmuteEntranceSound);
  });
  entranceAudio.muted = audioMuted;
  if (entranceAudio.ended) {
    entranceAudio.currentTime = 0;
    entranceAudio.play().catch(() => {});
  }
}

function tryPlayEntranceSound() {
  if (entrancePlayed) return;
  entrancePlayed = true;
  entranceAudio.currentTime = 0;
  entranceAudio.muted = audioMuted;
  entranceAudio.play().catch(() => {
    // Lecture avec son bloquée : démarrer muet pour rester synchronisé avec l'entrée,
    // puis démasquer dès le premier geste utilisateur réel.
    entranceAudio.muted = true;
    entranceAudio.play().catch(() => {});
    AMBIENT_UNLOCK_EVENTS.forEach((evt) => {
      window.addEventListener(evt, unmuteEntranceSound, { passive: true });
    });
  });
}

const audioToggleBtn = document.getElementById('audio-toggle');
audioToggleBtn.addEventListener('click', () => {
  const muted = window.toggleAudioMute();
  audioToggleBtn.classList.toggle('muted', muted);
  audioToggleBtn.setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son');
});

const TOTAL_UNITS = ASSETS_TO_PRELOAD.length + 1; // + le modèle 3D de la partie 2
let loadedCount = 0;
let glbProgress = 0;
let glbReady = false;

function refreshProgressBar() {
  const ratio = (loadedCount + glbProgress) / TOTAL_UNITS;
  if (typeof window.onLoadingProgress === 'function') {
    window.onLoadingProgress(ratio);
  }
  if (loadedCount === ASSETS_TO_PRELOAD.length && glbReady) {
    onLoadingComplete();
  }
}

function updateProgress() {
  loadedCount += 1;
  refreshProgressBar();
}

window.onScene3DPart2Progress = function onScene3DPart2Progress(ratio) {
  glbProgress = Math.min(ratio, 1);
  refreshProgressBar();
};

// Indicateur de chargement de la partie 1 : le modèle du village se charge en lazy
// loading au clic sur l'avion en papier, sans barre de progression. On affiche un
// petit spinner pour éviter que l'écran semble figé, et on le masque dès que le
// modèle est prêt.
const part1LoadingEl = document.getElementById('part1-loading');

window.onPart1LoadingStart = function onPart1LoadingStart() {
  if (part1LoadingEl) part1LoadingEl.classList.remove('hidden');
};

window.onScene3DReady(function onScene3DReadyHidePart1Indicator() {
  if (part1LoadingEl) part1LoadingEl.classList.add('hidden');
});

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = src;
  });
}

function onLoadingComplete() {
  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
    // Aller directement à la partie 2 (sans experience ni animation de révélation)
    transitionToScene3D();
    loadingScreen.addEventListener('transitionend', () => {
      loadingScreen.remove();
    }, { once: true });
  }, 300);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function playRevealAnimation() {
  const maxRadius = Math.sqrt(
    window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight
  ) / 2 + 120;
  const duration = 3500;
  let start = null;

  function step(timestamp) {
    if (start === null) start = timestamp;
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    const radius = easeOutCubic(progress) * maxRadius;
    revealCircle.setAttribute('r', String(radius));
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      if (scrollHint) scrollHint.classList.add('visible');
      // Ne pas appeler transitionToScene3D ici si c'est appelé depuis goToPart1
    }
  }

  requestAnimationFrame(step);
}

// Exposer la fonction sur window pour qu'elle soit accessible depuis goToPart1
window.playRevealAnimation = playRevealAnimation;

function transitionToScene3D() {
  // Afficher la partie 2 d'abord (au lieu de la partie 1)
  scene3dPart2.hidden = false;
  scene3dPart2.classList.add('visible');
  scrollSpace.style.height = `${window.innerHeight * SCROLL_SPACE_MULTIPLIER}px`;
  tryPlayEntranceSound();
  if (typeof window.startScene3DPart2 === 'function') {
    window.startScene3DPart2();
  }
  window.addEventListener('scroll', hideScrollHint, { once: true, passive: true });
}

function hideScrollHint() {
  scrollHint.classList.remove('visible');
  scrollHint.classList.add('exit');
  scrollHint.addEventListener('animationend', () => {
    scrollHint.remove();
  }, { once: true });
}

ASSETS_TO_PRELOAD.forEach((src) => {
  preloadImage(src).then(updateProgress);
});

function waitForScene3DPart2Ready() {
  if (typeof window.onScene3DPart2Ready === 'function') {
    window.onScene3DPart2Ready(() => {
      glbReady = true;
      glbProgress = 1;
      refreshProgressBar();
    });
  } else {
    setTimeout(waitForScene3DPart2Ready, 50);
  }
}
waitForScene3DPart2Ready();

// Gestion de l'écran de fin de chapitre avec bouton "Dôgo kun soro"
const endChapterScreen = document.getElementById('end-chapter-screen');
const dogoBtn = document.getElementById('dogo-kun-soro-btn');
let endChapterShown = false;

window.addEventListener('scroll', () => {
  if (!endChapterShown && scrollSpace) {
    const scrollHeight = scrollSpace.offsetHeight;
    const scrolledAmount = window.scrollY + window.innerHeight;
    const scrollProgress = scrolledAmount / scrollHeight;

    // Afficher le bouton quand l'utilisateur a scrollé à 95% ou plus
    if (scrollProgress >= 0.95) {
      endChapterShown = true;
      endChapterScreen.classList.add('visible');
    }
  }
});

// Placeholder pour le lien du bouton (à remplir avec ton URL)
dogoBtn.addEventListener('click', () => {
  // window.location.href = 'URL_À_REMPLIR'; // À remplacer par le vrai lien
  console.log('Bouton Dôgo kun soro cliqué !');
});

// Bouton AR - Réalité augmentée native (iOS Quick Look / Android Scene Viewer via <model-viewer>)
const arButton = document.getElementById('ar-button');
const arViewer = document.getElementById('ar-viewer');
const arIncompatibilityScreen = document.getElementById('ar-incompatibility-screen');
const arIncompatibilityBtn = document.getElementById('ar-incompatibility-btn');

function tryActivateAR() {
  if (arViewer.canActivateAR) {
    arViewer.activateAR();
  } else {
    arIncompatibilityScreen.classList.remove('hidden');
    arIncompatibilityScreen.classList.add('visible');
  }
}

let arModelRequested = false;

// model-viewer (~400 Ko depuis le CDN Google) n'est PAS chargé au démarrage : il
// n'est utile qu'au clic sur le bouton AR. L'injecter à ce moment évite un gros
// téléchargement + une requête CDN sur le chemin critique de l'écran de chargement.
let arViewerScriptPromise = null;
function ensureModelViewerLoaded() {
  if (!arViewerScriptPromise) {
    arViewerScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js';
      script.onload = () => {
        // Attendre que le <model-viewer> soit transformé en composant actif (upgrade
        // du custom element), sinon canActivateAR n'existe pas encore.
        customElements.whenDefined('model-viewer').then(resolve).catch(reject);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return arViewerScriptPromise;
}

arButton.addEventListener('click', async () => {
  if (!arViewer) return;
  try {
    await ensureModelViewerLoaded();
  } catch (e) {
    arIncompatibilityScreen.classList.remove('hidden');
    arIncompatibilityScreen.classList.add('visible');
    return;
  }
  // Le modèle n'est chargé dans <model-viewer> qu'à ce moment précis, pas au
  // chargement de la page : Three.js charge déjà ce même fichier pour afficher la
  // scène, le charger une 2e fois en arrière-plan dès le départ doublait la bande
  // passante nécessaire et bloquait l'écran de chargement.
  // (le setter .src de <model-viewer> ne reflète pas l'attribut HTML, d'où ce flag)
  if (!arModelRequested) {
    arModelRequested = true;
    // canActivateAR (notamment la génération du USDZ pour Quick Look sur iOS)
    // n'est fiable qu'une fois le modèle chargé, donc on attend 'load' avant
    // de tenter l'activation la première fois.
    arViewer.addEventListener('load', () => {
      // Une fois le modèle chargé, déclencher toutes les animations
      playAllARAnimations();
      tryActivateAR();
    }, { once: true });
    arViewer.src = 'asset/model/scene-partie2.glb';
  } else {
    tryActivateAR();
  }
});

// Jouer toutes les animations du modèle en boucle continue en AR
function playAllARAnimations() {
  const animations = arViewer.availableAnimations;
  if (!animations || animations.length === 0) {
    console.log('Aucune animation trouvée dans le modèle AR');
    return;
  }

  console.log(`✅ Animations trouvées: ${animations.join(', ')}`);

  // Stratégie : jouer les animations séquentiellement en boucle infinie
  // (model-viewer ne supporte que playback d'une animation à la fois)
  let currentIndex = 0;
  let animationTimeout = null;

  function getAnimationDuration(animName) {
    // Durée estimée en ms (model-viewer n'expose pas la vraie durée)
    // À adapter selon tes animations réelles
    return 3000; // 3 secondes par défaut
  }

  function playNext() {
    if (currentIndex < animations.length) {
      const animName = animations[currentIndex];
      console.log(`▶️  Animation ${currentIndex + 1}/${animations.length}: ${animName}`);
      arViewer.animationName = animName;
      currentIndex++;

      // Calculer la durée et passer à la suivante
      const duration = getAnimationDuration(animName);
      animationTimeout = setTimeout(() => {
        playNext();
      }, duration);
    } else {
      // Redémarrer la boucle depuis le début
      console.log('🔄 Redémarrage des animations...');
      currentIndex = 0;
      playNext();
    }
  }

  playNext();

  // Nettoyer le timeout si on quitte l'AR
  window.stopARAnimations = function stopARAnimations() {
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      console.log('Animations AR arrêtées');
    }
  };
}

// Bouton OK pour fermer l'écran d'incompatibilité AR
arIncompatibilityBtn.addEventListener('click', () => {
  arIncompatibilityScreen.classList.remove('visible');
  arIncompatibilityScreen.classList.add('hidden');
});

// Bouton Retour - Retourner à Partie 1 depuis l'écran DOGOKUN SORO
const returnBtn = document.getElementById('return-btn');
returnBtn.addEventListener('click', () => {
  // Cacher l'écran de fin et revenir à Partie 1
  endChapterScreen.classList.remove('visible');
  window.scrollTo(0, 0);
  endChapterShown = false;
  // scrollTo(0,0) seul ne révèle pas #scene3d : sans clic préalable sur l'avion
  // en papier, cette div est toujours hidden=true et #scene3d-part2 reste affiché.
  // On réutilise la même transition que le clic sur l'avion pour vraiment basculer.
  if (typeof window.goToPart1 === 'function') {
    window.goToPart1();
  }
});
