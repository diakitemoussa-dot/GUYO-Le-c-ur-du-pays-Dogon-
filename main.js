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

const experience = document.getElementById('experience');
const skyImage = document.getElementById('sky-image');
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

// Indicateur du grenier (partie 2) : visible dès que l'écran de chargement s'efface
// si le modèle 3D n'est pas encore prêt, masqué dès que la scène est rendue.
const part2LoadingEl = document.getElementById('part2-loading');

function setPart2LoadingMessage(message) {
  if (!part2LoadingEl) return;
  const label = part2LoadingEl.querySelector('.part2-loading-label');
  if (label && message) label.textContent = message;
  part2LoadingEl.classList.remove('hidden');
}

if (typeof window.onScene3DPart2CanvasReady === 'function') {
  window.onScene3DPart2CanvasReady(() => {
    if (part2LoadingEl) part2LoadingEl.classList.add('hidden');
  });
}

window.onScene3DPart2Error = function onScene3DPart2Error(err) {
  console.error('Échec du chargement de SCENE_1.glb :', err);
  setPart2LoadingMessage('le grenier n\u2019a pas pu se charger. recharge la page.');
};

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = src;
  });
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function playRevealAnimation() {
  const maxRadius = Math.sqrt(
    window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight
  ) / 2 + 120;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const duration = 3500;
  let start = null;

  function step(timestamp) {
    if (start === null) start = timestamp;
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    const radius = easeOutCubic(progress) * maxRadius;
    if (skyImage) {
      skyImage.style.clipPath = `circle(${radius}px at ${cx}px ${cy}px)`;
    }
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      // Retirer le clip-path une fois la révélation terminée : le ciel est affiché
      // en entier, sans coût GPU résiduel (important sur mobile).
      if (skyImage) skyImage.style.clipPath = '';
      if (scrollHint) scrollHint.classList.add('visible');
      // Ne pas appeler transitionToScene3D ici si c'est appelé depuis goToPart1
    }
  }

  requestAnimationFrame(step);
}

// Exposer la fonction sur window pour qu'elle soit accessible depuis goToPart1
window.playRevealAnimation = playRevealAnimation;

let experienceRevealed = false;

function transitionToScene3D() {
  if (experienceRevealed) return;
  experienceRevealed = true;
  // Afficher la partie 2 d'abord (au lieu de la partie 1)
  scene3dPart2.hidden = false;
  scene3dPart2.classList.add('visible');
  scrollSpace.style.height = `${window.innerHeight * SCROLL_SPACE_MULTIPLIER}px`;
  tryPlayEntranceSound();
  // Le voyage commence au grenier (étape 2) : la navigation d'étape le confirme.
  stageNavBtn.classList.remove('hidden');
  setStageNav('grenier');
  if (typeof window.startScene3DPart2 === 'function') {
    window.startScene3DPart2();
  } else {
    // Le module scene3d-part2 (et le téléchargement du GLB) est encore en cours :
    // on démarre la partie 2 dès qu'il est prêt.
    const pollStart = setInterval(() => {
      if (typeof window.startScene3DPart2 === 'function') {
        clearInterval(pollStart);
        window.startScene3DPart2();
      }
    }, 100);
  }
  window.addEventListener('scroll', hideScrollHint, { once: true, passive: true });
}

// Appelé par boot.js (qui gère l'écran de chargement de façon indépendante des
// modules CDN) dès que la page est prête — ou au plus tard après son filet de
// sécurité — pour révéler l'expérience (partie 2 + démarrage du grenier).
window.revealExperience = function revealExperience() {
  transitionToScene3D();
};

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
    refreshProgressBar();
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

// Bouton de navigation d'étape (grenier ↔ histoire), remplace l'ancienne bulle 3D :
// - au grenier (étape 2) : « l'histoire → » lance le récit (étape 1) ;
// - dans l'histoire (étape 1) : « → le grenier » ramène au grenier (étape 2).
const stageNavBtn = document.getElementById('stage-nav-btn');
const stageNavLabel = document.getElementById('stage-nav-label');
let currentStage = 'grenier';

function setStageNav(stage) {
  currentStage = stage;
  stageNavLabel.textContent = stage === 'grenier' ? 'l\u2019histoire \u2192' : '\u2192 le grenier';
}
window.setStageNav = setStageNav;

stageNavBtn.addEventListener('click', () => {
  if (currentStage === 'grenier') {
    // Étape 2 → 1 : lancer l'histoire (même action que l'avion en papier).
    if (typeof window.goToPart1 === 'function') {
      window.goToPart1();
    }
  } else {
    // Étape 1 → 2 : revenir au grenier. On remonte d'abord en haut (le handler de
    // scroll de scene3d.js masque la partie 2 dès que progress < 1), puis on
    // réaffiche le grenier après que le scroll s'est stabilisé.
    endChapterScreen.classList.remove('visible');
    endChapterShown = false;
    window.scrollTo(0, 0);
    setTimeout(() => {
      if (typeof window.setScene3DPart2Visible === 'function') {
        window.setScene3DPart2Visible(true);
      }
    }, 120);
  }
});

window.addEventListener('scroll', () => {
  if (!endChapterShown && scrollSpace) {
    const scrollHeight = scrollSpace.offsetHeight;
    const scrolledAmount = window.scrollY + window.innerHeight;
    const scrollProgress = scrolledAmount / scrollHeight;

    // Afficher le bouton quand l'utilisateur a scrollé à 95% ou plus
    if (scrollProgress >= 0.95) {
      endChapterShown = true;
      endChapterScreen.classList.add('visible');
      // L'écran de fin a son propre bouton « RETOUR » : masquer la navigation d'étape.
      stageNavBtn.classList.add('hidden');
    }
  }
});

// Placeholder pour le lien du bouton (à remplir avec ton URL)
dogoBtn.addEventListener('click', () => {
  // window.location.href = 'URL_À_REMPLIR'; // À remplacer par le vrai lien
  console.log('Bouton Dôgo kun soro cliqué !');
});

// Bouton AR - Réalité augmentée native (iOS Quick Look / WebXR Android via <model-viewer>)
const arButton = document.getElementById('ar-button');
const arViewer = document.getElementById('ar-viewer');
const arIncompatibilityScreen = document.getElementById('ar-incompatibility-screen');
const arIncompatibilityBtn = document.getElementById('ar-incompatibility-btn');
const arIncompatibilityDetail = document.getElementById('ar-incompatibility-detail');
const arLoading = document.getElementById('ar-loading');

function showARIncompatibility(detail) {
  if (arIncompatibilityDetail) {
    arIncompatibilityDetail.textContent = detail || '';
  }
  arIncompatibilityScreen.classList.remove('hidden');
  arIncompatibilityScreen.classList.add('visible');
}

function showARLoading() {
  if (arLoading) arLoading.classList.remove('hidden');
}

function hideARLoading() {
  if (arLoading) arLoading.classList.add('hidden');
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Choix du mode AR, AVANT de laisser model-viewer décider. FONCTION SYNCHRONE :
// on doit choisir et lancer l'AR dans le même geste utilisateur, sans aucun
// await — sinon Chrome peut refuser de lancer l'app externe (pas de user
// gesture / transient activation) et renvoie vers le browser_fallback_url,
// d'où « appareil incompatible » à tort sur un téléphone pourtant compatible.
// - 'quick-look' sur iOS Safari (l'export USDZ à la volée fonctionne déjà).
// - 'scene-viewer' sur TOUT Android : l'app native Scene Viewer (ARCore) est la
//   seule voie fiable. WebXR (« immersive-ar ») est instable sur beaucoup
//   d'appareils (Samsung/Exynos : plante — issues model-viewer #3495/#4661/#4665 —
//   ou répond « non supporté » alors qu'ARCore est présent).
// - On ne consulte donc JAMAIS navigator.xr.isSessionSupported pour décider :
//   son verdict est trompeur sur Android (faux négatifs ET faux positifs).
// Si l'intent Scene Viewer échoue (Android sans ARCore), notre hashchange gère
// l'écran d'incompatibilité à la place du history.back() de model-viewer (qui
// renvoyait l'utilisateur au début de l'expérience).
function detectARMode() {
  if (!self.isSecureContext) return null; // AR et intents exigent HTTPS
  if (isIOS()) return 'quick-look';
  if (/android/i.test(navigator.userAgent)) return 'scene-viewer';
  return null;
}

function getARIncompatibilityReason() {
  if (!self.isSecureContext) {
    return 'la réalité augmentée nécessite une connexion HTTPS sécurisée.';
  }
  if (/android/i.test(navigator.userAgent)) {
    return 'pour la réalité augmentée sur Android : installe « Google Play Services for AR » (ARCore) sur ton appareil, puis réessaie.';
  }
  return 'essaye depuis un téléphone récent (iPhone/iPad avec Safari, ou Android avec Google Chrome).';
}

function tryActivateAR() {
  try {
    if (arViewer.canActivateAR) {
      arViewer.activateAR();
    } else {
      showARIncompatibility(getARIncompatibilityReason());
    }
  } catch (e) {
    console.error('Échec du lancement AR :', e);
    showARIncompatibility(getARIncompatibilityReason());
  }
}

let arModelRequested = false;

// Hash utilisé par browser_fallback_url pour détecter l'échec de l'intent
// Scene Viewer (Android sans ARCore) et afficher l'écran d'incompatibilité
// au lieu du history.back() de model-viewer.
const AR_SCENE_VIEWER_FALLBACK_HASH = '#ar-not-supported';
let arSceneViewerFallbackListener = null;

// Android : ouvre l'app native Scene Viewer (ARCore) via une intent. Le modèle
// est chargé par l'app elle-même (URL publique), donc AUCUN chargement ni WebGL
// dans la page → lancement instantané, sans lag ni plantage WebXR.
function launchSceneViewer() {
  const modelUrl = new URL('asset/model/le_guyo_AR.glb', location.href).toString();
  const fallbackUrl = location.origin + location.pathname + location.search + AR_SCENE_VIEWER_FALLBACK_HASH;
  const params = new URLSearchParams();
  params.set('mode', 'ar_preferred');
  params.set('disable_occlusion', 'true');
  params.set('file', modelUrl);
  const intent =
    `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}` +
    `#Intent;scheme=https;package=com.google.ar.core;` +
    `action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end;`;

  if (arSceneViewerFallbackListener) {
    window.removeEventListener('hashchange', arSceneViewerFallbackListener);
    arSceneViewerFallbackListener = null;
  }
  arSceneViewerFallbackListener = () => {
    if (location.hash === AR_SCENE_VIEWER_FALLBACK_HASH) {
      window.removeEventListener('hashchange', arSceneViewerFallbackListener);
      arSceneViewerFallbackListener = null;
      // Nettoie le hash pour ne pas ré-déclencher au prochain clic.
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      arButton.disabled = false;
      hideARLoading();
      showARIncompatibility(getARIncompatibilityReason());
    }
  };
  window.addEventListener('hashchange', arSceneViewerFallbackListener);

  const link = document.createElement('a');
  link.href = intent;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// model-viewer (~400 Ko depuis le CDN Google) n'est PAS chargé au démarrage : il
// n'est utile qu'au clic sur le bouton AR (iOS Quick Look). L'injecter à ce
// moment évite un gros téléchargement + une requête CDN sur le chemin critique
// de l'écran de chargement. Sur Android on ne le charge plus du tout (Scene
// Viewer est lancé directement par launchSceneViewer).
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

arButton.addEventListener('click', () => {
  if (!arViewer) return;
  arButton.disabled = true;

  const mode = detectARMode();
  if (!mode) {
    arButton.disabled = false;
    showARIncompatibility(getARIncompatibilityReason());
    return;
  }

  // Android : lancement SYNCHRONE de Scene Viewer, directement dans le geste du
  // tap. AUCUN await avant le click() de l'intent : Chrome refuse de lancer une
  // app externe sans user gesture (transient activation) et renverrait vers le
  // browser_fallback_url → « appareil incompatible » à tort. Aucun model-viewer
  // ni chargement de modèle dans la page : instantané et sans lag.
  if (mode === 'scene-viewer') {
    try {
      launchSceneViewer();
    } catch (e) {
      console.error('Échec du lancement Scene Viewer :', e);
      arButton.disabled = false;
      showARIncompatibility(getARIncompatibilityReason());
      return;
    }
    // Si Scene Viewer s'ouvre, le bouton restera désactivé le temps de l'AR ;
    // on le réactive quand l'app nous renvoie dans la page (ou si rien ne s'est
    // lancé du tout).
    arButton.disabled = false;
    return;
  }

  // iOS (Quick Look) : on passe par model-viewer qui génère le USDZ à la volée.
  arViewer.setAttribute('ar-modes', mode);
  runQuickLook();
});

// Flow iOS : charger model-viewer puis le modèle, puis activer le Quick Look.
// (Asynchrone : Quick Look iOS se lance via une navigation, pas via une intent
// Android, la transient activation n'est pas un prérequis bloquant.)
async function runQuickLook() {
  try {
    await ensureModelViewerLoaded();
  } catch (e) {
    arButton.disabled = false;
    showARIncompatibility('le module de réalité augmentée n\u2019a pas pu être chargé (vérifie ta connexion internet).');
    return;
  }

  // Le modèle n'est chargé dans <model-viewer> qu'à ce moment précis, pas au
  // chargement de la page : Three.js charge déjà ce même fichier pour afficher la
  // scène, le charger une 2e fois en arrière-plan dès le départ doublait la bande
  // passante nécessaire et bloquait l'écran de chargement.
  // (le setter .src de <model-viewer> ne reflète pas l'attribut HTML, d'où ce flag)
  const activateWhenReady = () => {
    // Une fois le modèle chargé, déclencher toutes les animations puis l'AR.
    playAllARAnimations();
    tryActivateAR();
    arButton.disabled = false;
    hideARLoading();
  };

  const onLoadError = () => {
    arButton.disabled = false;
    hideARLoading();
    arModelRequested = false; // autoriser une nouvelle tentative au prochain clic
    showARIncompatibility('le modèle 3D n\u2019a pas pu être chargé pour la réalité augmentée.');
  };

  if (!arModelRequested) {
    arModelRequested = true;
    showARLoading();
    // canActivateAR (notamment la génération du USDZ pour Quick Look sur iOS)
    // n'est fiable qu'une fois le modèle chargé, donc on attend 'load' avant
    // de tenter l'activation la première fois.
    arViewer.addEventListener('load', activateWhenReady, { once: true });
    arViewer.addEventListener('error', onLoadError, { once: true });
    arViewer.src = 'asset/model/le_guyo_AR.glb';
  } else if (arViewer.loaded) {
    activateWhenReady();
  } else {
    // Modèle déjà en cours de chargement : patienter sans relancer un 2e load.
    showARLoading();
    arViewer.addEventListener('load', activateWhenReady, { once: true });
  }
}

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

// Si on atterrit sur #ar-not-supported, c'est que le browser_fallback_url de
// l'intent Scene Viewer a rechargé complètement la page (URL avec query string
// par exemple) : on affiche l'écran d'incompatibilité et on nettoie le hash.
if (location.hash === AR_SCENE_VIEWER_FALLBACK_HASH) {
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  showARIncompatibility(getARIncompatibilityReason());
}

// Bouton Retour - retour au grenier (partie 2) depuis l'écran DOGOKUN SORO
const returnBtn = document.getElementById('return-btn');
returnBtn.addEventListener('click', () => {
  // Cacher l'écran de fin et revenir au début du voyage (scroll en haut).
  endChapterScreen.classList.remove('visible');
  window.scrollTo(0, 0);
  endChapterShown = false;
  // Le scroll en haut ramène la partie 1 à pleine opacité : le handler de scroll
  // de scene3d.js masque alors la partie 2 (setScene3DPart2Visible(false) dès que
  // progress < 1). On réaffiche donc le grenier (partie 2) APRÈS que le scroll se
  // soit stabilisé, pour que l'utilisateur retombe dessus, prêt à recliquer sur
  // l'avion en papier et à rejouer le voyage.
  setTimeout(() => {
    if (typeof window.setScene3DPart2Visible === 'function') {
      window.setScene3DPart2Visible(true);
    }
  }, 120);
  // De retour au grenier (étape 2) : réafficher la navigation d'étape.
  stageNavBtn.classList.remove('hidden');
  setStageNav('grenier');
});
