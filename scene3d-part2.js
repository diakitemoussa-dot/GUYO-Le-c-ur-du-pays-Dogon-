import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const container = document.getElementById('scene3d-part2');

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let started = false;
let revealed = false;
let loadedGltf = null;
let mixer = null;
const clock = new THREE.Clock();

// Bloom sélectif (jaunâtre, clignotant) sur le Plane uniquement : on rend deux fois
// la scène — une fois avec tout sauf le Plane passé en noir (bloomComposer, capte
// uniquement la lueur du Plane), une fois normalement (finalComposer), puis on
// additionne les deux. Cf. exemple officiel three.js "selective bloom".
const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const bloomDarkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const bloomMaterialCache = {};
let bloomComposer = null;
let finalComposer = null;
let bloomPass = null;

// Raycaster pour la détection de clics sur les objets (ex: bouton Plane)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Son joué au clic sur l'avion en papier, au moment de la transition partie 2 → partie 1.
const TRANSITION_AUDIO = new Audio('asset/audio/transition plane 2.mp3');
TRANSITION_AUDIO.preload = 'auto';
let part2Muted = false;
window.setPart2Muted = function setPart2Muted(muted) {
  part2Muted = muted;
  TRANSITION_AUDIO.muted = muted;
};

function playTransitionSound() {
  TRANSITION_AUDIO.muted = part2Muted;
  TRANSITION_AUDIO.currentTime = 0;
  TRANSITION_AUDIO.play().catch(() => {});
}

// Suivi continu de la souris pour l'effet de dispersion des particules de poussière
// (setupPlaneButton met à jour `mouse` uniquement au clic, on ajoute le suivi au mousemove ici).
window.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}, { passive: true });

const dustMousePlane = new THREE.Plane();
const dustMouseIntersect = new THREE.Vector3();
const dustMouseTarget = new THREE.Vector3();
const dustPlaneNormal = new THREE.Vector3();

// Bulle de texte, toujours visible
let textBubble = null;
let textBubbleBaseY = 0; // Position Y de départ pour l'oscillation

// Contrôle de vitesse du Plane
let planeObject = null;
// Empêche la caméra de traverser les murs/toit du grenier (ATTIC) pendant l'orbite :
// on borne la distance minimale au rayon englobant de la structure (pas de raycasting,
// car ATTIC est positionné à l'intérieur des murs — un rayon sortant les toucherait
// immédiatement et coincerait la caméra collée à l'intérieur).
const COLLISION_MARGIN = 0.15;

function findCamera(gltf) {
  if (gltf.cameras && gltf.cameras.length) return gltf.cameras[0];
  let found = null;
  gltf.scene.traverse((obj) => {
    if (!found && obj.isCamera) found = obj;
  });
  return found;
}

// Contrairement à la partie 1 (style plat/illustratif), la partie 2 utilise un matériau
// qui réagit à la lumière pour que les ombres soient visibles pendant l'exploration 3D.
function makeShadable(gltf) {
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const source = obj.material;
    const standard = new THREE.MeshStandardMaterial({
      map: source.map || null,
      color: source.map ? 0xffffff : source.color,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    });
    obj.material = standard;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function addLighting(scene, target) {
  const ambient = new THREE.HemisphereLight(0xfff3e0, 0x3a2f28, 0.9);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d6, 3);
  sun.position.set(target.x + 6, target.y + 10, target.z + 6);
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);
}

// ATTIC est l'objet central de l'expérience : la caméra orbite toujours autour de lui.
const ORBIT_TARGET_NAME = 'ATTIC';

function getModelCenter(gltf) {
  const attic = gltf.scene.getObjectByName(ORBIT_TARGET_NAME);
  if (attic) {
    const center = new THREE.Vector3();
    attic.getWorldPosition(center);
    return center;
  }
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const center = new THREE.Vector3();
  box.getCenter(center);
  return center;
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (bloomComposer) bloomComposer.setSize(window.innerWidth, window.innerHeight);
  if (finalComposer) finalComposer.setSize(window.innerWidth, window.innerHeight);
}

// Passe additive : combine le rendu normal (baseTexture) avec la lueur isolée du
// Plane (bloomTexture, floutée par UnrealBloomPass) pour obtenir le halo final.
const bloomMixShader = {
  uniforms: {
    baseTexture: { value: null },
    bloomTexture: { value: null },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv);
    }
  `,
};

function setupBloom() {
  // Deux RenderPass distincts : celui du bloomComposer force un fond NOIR (sinon
  // le violet du fog/ciel, assez clair, dépasserait le seuil et ferait bloomer tout
  // l'écran au lieu du seul Plane) ; celui du finalComposer garde le fond normal.
  const bloomRenderScene = new RenderPass(scene, camera, undefined, new THREE.Color(0x000000), 1);
  const finalRenderScene = new RenderPass(scene, camera);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.35, // strength (animée pour le clignotement)
    0.25, // radius
    0.35 // threshold
  );

  bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(bloomRenderScene);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(new THREE.ShaderMaterial(bloomMixShader), 'baseTexture');
  mixPass.uniforms.bloomTexture.value = bloomComposer.renderTarget2.texture;
  mixPass.needsSwap = true;

  finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(finalRenderScene);
  finalComposer.addPass(mixPass);
  // Sans cette passe finale, le rendu composité reste en espace linéaire au lieu de
  // la conversion sRGB/tone mapping que renderer.render() applique normalement sur
  // le canvas : toute la scène paraît plus sombre et plate, pas seulement le Plane.
  finalComposer.addPass(new OutputPass());
}

function darkenNonBloomed(obj) {
  // Les sprites/points (bulle de texte, étoiles) ne sont pas des Mesh : leur matériau
  // ne peut pas être remplacé par le matériau noir de la même façon, on les masque
  // simplement pendant la passe de bloom pour qu'ils ne contribuent pas à la lueur
  // (la poussière, elle, est sur le layer de bloom donc jamais masquée ici).
  if ((obj.isSprite || obj.isPoints) && bloomLayer.test(obj.layers) === false) {
    obj.userData.wasVisibleBeforeBloom = obj.visible;
    obj.visible = false;
    return;
  }
  if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
    bloomMaterialCache[obj.uuid] = obj.material;
    obj.material = bloomDarkMaterial;
  }
}

function restoreMaterial(obj) {
  if ((obj.isSprite || obj.isPoints) && obj.userData.wasVisibleBeforeBloom !== undefined) {
    obj.visible = obj.userData.wasVisibleBeforeBloom;
    delete obj.userData.wasVisibleBeforeBloom;
    return;
  }
  if (bloomMaterialCache[obj.uuid]) {
    obj.material = bloomMaterialCache[obj.uuid];
    delete bloomMaterialCache[obj.uuid];
  }
}

function renderWithBloom() {
  scene.traverse(darkenNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreMaterial);
  finalComposer.render();
}

// Position/rotation d'entrée de la caméra en partie 2, converties depuis les coordonnées
// Blender (Z-up) vers Three.js (Y-up) : X=BX, Y=BZ, Z=-BY (convention du projet).
const CAMERA_ENTRY_POSITION = new THREE.Vector3(-26.97, 3.8183, 24.31);
const CAMERA_ENTRY_ROTATION = new THREE.Euler(
  THREE.MathUtils.degToRad(94.607),
  THREE.MathUtils.degToRad(27.221),
  0,
  'XYZ'
);

// Variante caméra pour petit écran (mobile), depuis le viewport Blender :
// Location (-19.154, -14.879, 6.2046) / Rotation (79.474°, 4.4385°, -609.97°) XYZ Euler.
// Conversion rigoureuse Z-up (Blender) -> Y-up (Three.js) par quaternions (rotation de
// -90° autour de X), plutôt qu'une simple réassignation d'axes, car cette caméra n'a
// jamais été calée à l'œil dans le rendu three.js.
const MOBILE_BREAKPOINT_PX = 700;
const CAMERA_ENTRY_POSITION_MOBILE = new THREE.Vector3(-19.154, 6.2046, 14.879);
const CAMERA_ENTRY_ROTATION_MOBILE = new THREE.Euler(
  THREE.MathUtils.degToRad(-112.5108),
  THREE.MathUtils.degToRad(69.5039),
  THREE.MathUtils.degToRad(-167.2310),
  'XYZ'
);

// Ciel de jour procédural (dégradé + nuages générés par bruit en shader, aucune image/
// texture) : la partie 2 n'a plus de ciel visuel depuis la suppression de l'ancien dôme
// GLB "WEB_Sky", elle affichait juste la couleur de fond plate du fog.
let skyMaterial = null;

// L'avion n'est qu'un petit quad (~0,34 unité de monde, ~60x30 px sur PC et à peine
// ~25x13 px sur mobile) qui tourne sur lui-même : le viser au pixel près échoue
// facilement, surtout au doigt. On détecte donc le clic via une SPHÈRE généreuse
// centrée sur l'avion : tout appui à proximité compte comme un clic sur l'avion.
const PLANE_HIT_RADIUS = 1.5; // unités de monde (l'avion fait ~0,34)
const planeHitSphere = new THREE.Sphere();
const planeHitPoint = new THREE.Vector3();

function setupPlaneButton(plane, onClickCallback) {
  plane.userData.isButton = true;
  let isHoveringPlane = false;

  const isPlaneHit = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    planeHitSphere.set(
      new THREE.Vector3().setFromMatrixPosition(plane.matrixWorld),
      PLANE_HIT_RADIUS,
    );
    return raycaster.ray.intersectSphere(planeHitSphere, planeHitPoint) !== null;
  };

  const onMouseMove = (event) => {
    const hovering = isPlaneHit(event);
    if (hovering !== isHoveringPlane) {
      isHoveringPlane = hovering;
      document.body.style.cursor = hovering ? 'pointer' : 'default';
    }
  };

  // Sur mobile, la moindre glissade pendant l'appui (rotation de l'orbite, scroll)
  // fait annuler le 'click' synthétisé par le navigateur : on détecte donc le tap via
  // 'pointerup' sans mouvement, fiable à la souris comme au doigt, sans conflit.
  let tapStartX = 0;
  let tapStartY = 0;
  const onPointerDown = (event) => {
    tapStartX = event.clientX;
    tapStartY = event.clientY;
  };
  const onPointerUp = (event) => {
    const moved = Math.hypot(event.clientX - tapStartX, event.clientY - tapStartY);
    if (moved < 10 && isPlaneHit(event)) {
      onClickCallback();
    }
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  plane.userData.clickListener = onPointerUp;
}

function createTextBubble(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Ombre sous la bulle pour le relief
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height - 8, canvas.width * 0.4, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fond blanc arrondi avec dégradé léger pour le relief
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height - 24);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#f5f5f5');
  ctx.fillStyle = gradient;
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 3;
  const radius = 20;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(canvas.width - radius, 0);
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
  ctx.lineTo(canvas.width, canvas.height - radius - 24);
  ctx.quadraticCurveTo(canvas.width, canvas.height - 24, canvas.width - radius, canvas.height - 24);
  ctx.lineTo(canvas.width * 0.6, canvas.height - 24);
  ctx.lineTo(canvas.width * 0.55, canvas.height);
  ctx.lineTo(canvas.width * 0.5, canvas.height - 24);
  ctx.lineTo(radius, canvas.height - 24);
  ctx.quadraticCurveTo(0, canvas.height - 24, 0, canvas.height - radius - 24);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.fill();
  ctx.stroke();

  // Texte noir, avec retour à la ligne automatique pour les phrases longues
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = canvas.width - 48;
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  const lineHeight = 44;
  const textAreaCenterY = (canvas.height - 24) / 2;
  const startY = textAreaCenterY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(4, 2, 1);
  return sprite;
}


function createProceduralSky() {
  const geometry = new THREE.SphereGeometry(400, 32, 16);
  skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      // Palette assombrie "galaxie" : indigo profond au zénith, prune sombre à
      // l'horizon, nuages gris-violet discrets plutôt que blancs et lumineux.
      horizonColor: { value: new THREE.Color(0x2a1f3d) },
      zenithColor: { value: new THREE.Color(0x0c0a18) },
      lowSkyColor: { value: new THREE.Color(0x3a2a34) },
      cloudColor: { value: new THREE.Color(0x6a5d78) },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform float time;
      uniform vec3 horizonColor;
      uniform vec3 zenithColor;
      uniform vec3 lowSkyColor;
      uniform vec3 cloudColor;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p *= 2.02;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        float h = clamp(vWorldDir.y, -1.0, 1.0);
        float skyT = smoothstep(-0.05, 0.6, h);
        vec3 sky = mix(horizonColor, zenithColor, skyT);
        // Vers l'horizon bas, fondu dans une teinte violacée claire (transition douce, sans
        // assombrir tout le bas du ciel visible).
        sky = mix(lowSkyColor, sky, smoothstep(-0.3, -0.02, h));

        vec2 cloudUv = vWorldDir.xz / (vWorldDir.y + 0.35) * 0.5 + vec2(time * 0.008, 0.0);
        float clouds = fbm(cloudUv * 1.6);
        clouds = smoothstep(0.55, 0.85, clouds);
        float cloudBand = smoothstep(0.05, 0.25, h) * smoothstep(0.85, 0.45, h);
        clouds *= cloudBand;

        vec3 color = mix(sky, cloudColor, clouds);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, skyMaterial);
  mesh.renderOrder = -1000;
  return mesh;
}

let starMaterial = null;

// Étoiles fixes réparties sur la moitié haute du dôme (ciel assombri "galaxie") :
// scintillement doux et indépendant par étoile (déphasage aléatoire par sommet).
function createStarField() {
  const STAR_COUNT = 900;
  const positions = new Float32Array(STAR_COUNT * 3);
  const seeds = new Float32Array(STAR_COUNT);

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    // cos(phi) borné à [0, 1] : uniquement l'hémisphère supérieur du dôme.
    const phi = Math.acos(Math.random());
    const r = 390;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    seeds[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

  starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
    },
    vertexShader: `
      attribute float seed;
      uniform float time;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(time * 1.6 + seed * 6.2831);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (1.2 + 1.3 * vTwinkle) * (300.0 / -mvPosition.z);
      }
    `,
    fragmentShader: `
      varying float vTwinkle;
      void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;
        float alpha = (1.0 - dist * 2.0) * vTwinkle;
        gl_FragColor = vec4(vec3(1.0, 0.98, 0.9), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(geometry, starMaterial);
  stars.renderOrder = -999;
  return stars;
}

function init(gltf) {
  scene = gltf.scene;
  camera = findCamera(gltf) || new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  const isMobileScreen = window.innerWidth <= MOBILE_BREAKPOINT_PX;
  camera.position.copy(isMobileScreen ? CAMERA_ENTRY_POSITION_MOBILE : CAMERA_ENTRY_POSITION);
  camera.rotation.copy(isMobileScreen ? CAMERA_ENTRY_ROTATION_MOBILE : CAMERA_ENTRY_ROTATION);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  makeShadable(gltf);

  // Violet foncé de la charte graphique (depuis la suppression du dôme de ciel WEB_Sky).
  const FOG_COLOR = 0x55415d;
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.035);
  scene.add(createProceduralSky());
  scene.add(createStarField());
  camera.far = Math.max(camera.far, 500);
  camera.updateProjectionMatrix();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(getModelCenter(gltf));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 20;
  controls.minDistance = getStructureCollisionRadius(gltf, controls.target) + COLLISION_MARGIN;
  controls.update();

  addLighting(scene, controls.target);

  terrainMesh = gltf.scene.getObjectByName('Meshy_output') || null;

  // Bulle aux coordonnées précises (depuis Blender, converties en Three.js)
  // Conversion Blender (X, Y, Z) → Three.js (X, Z, -Y)
  textBubble = createTextBubble('clic sur l\'avion en papier pour connaitre l\'histoire du coeur de l\'univers dogon');
  scene.add(textBubble);
  textBubble.position.set(-28.978, 5.0, 16.621);
  textBubbleBaseY = 5.0; // Stocker la position Y de départ pour l'oscillation
  textBubble.scale.multiplyScalar(0.2);
  textBubble.visible = true;

  // Configuration du Plane comme bouton interactif pour naviguer vers la partie 1
  planeObject = gltf.scene.getObjectByName('plane');
  if (planeObject) {
    // La transition est déclenchée une seule fois : un double tap (ou un tap + clic
    // doublé) ne relance pas goToPart1 plusieurs fois.
    let navigationStarted = false;
    setupPlaneButton(planeObject, () => {
      if (navigationStarted) return;
      navigationStarted = true;
      // Son de transition joué au clic, puis navigation vers la partie 1
      playTransitionSound();
      if (typeof window.goToPart1 === 'function') {
        window.goToPart1();
      }
    });
  }

  setupBloom();

  // Toutes les animations du modèle jouent en boucle continue, indépendamment du scroll.
  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach((clip) => {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat);
      action.play();
    });
  }

  window.addEventListener('resize', onResize);

  // Créer les particules de poussière, centrées sur le modèle (la caméra orbite
  // autour de ce point, pas de l'origine de la scène) pour qu'elles soient visibles.
  const dustParticles = createDustParticles(scene);
  dustParticles.position.copy(controls.target);
  scene.add(dustParticles);
  window.dustParticles = dustParticles; // Expose globally pour la boucle d'animation

  clock.start();
  renderer.setAnimationLoop(() => {
    controls.update();
    preventTerrainClipping();
    if (mixer) mixer.update(clock.getDelta());
    if (skyMaterial) skyMaterial.uniforms.time.value = clock.elapsedTime;
    if (starMaterial) starMaterial.uniforms.time.value = clock.elapsedTime;

    // Mettre à jour les particules de poussière
    if (window.dustParticles && window.dustParticles.userData.dustMaterial) {
      const dustMaterial = window.dustParticles.userData.dustMaterial;
      dustMaterial.uniforms.time.value = performance.now() * 0.001;

      // Projeter le curseur sur un plan face caméra, à la profondeur du nuage de
      // particules, pour obtenir un point 3D que le shader peut utiliser pour disperser
      // les particules proches (effet de répulsion au passage du curseur).
      raycaster.setFromCamera(mouse, camera);
      camera.getWorldDirection(dustPlaneNormal);
      dustMousePlane.setFromNormalAndCoplanarPoint(dustPlaneNormal, window.dustParticles.position);
      if (raycaster.ray.intersectPlane(dustMousePlane, dustMouseIntersect)) {
        dustMouseTarget.copy(dustMouseIntersect).sub(window.dustParticles.position);
      }
      // Lissage (lerp) de la position utilisée par le shader vers la cible : l'effet
      // suit le curseur avec un net retard doux, au lieu de sauter instantanément.
      dustMaterial.uniforms.mouseWorld.value.lerp(dustMouseTarget, 0.035);

      // Déplacement permanent : on écrit directement dans l'attribut position
      // (pas seulement dans le shader) pour que les particules écartées par le
      // curseur restent écartées au lieu de revenir à leur position de départ.
      const posAttr = window.dustParticles.geometry.attributes.position;
      const posArr = posAttr.array;
      const mw = dustMaterial.uniforms.mouseWorld.value;
      const mouseRadius = dustMaterial.uniforms.mouseRadius.value;
      const permanentPushStrength = 0.6;
      let dustMoved = false;
      for (let i = 0; i < posArr.length; i += 3) {
        const dx = posArr[i] - mw.x;
        const dy = posArr[i + 1] - mw.y;
        const dz = posArr[i + 2] - mw.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < mouseRadius * mouseRadius && distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const t = 1 - dist / mouseRadius;
          const force = t * t * permanentPushStrength;
          posArr[i] += (dx / dist) * force;
          posArr[i + 1] += (dy / dist) * force;
          posArr[i + 2] += (dz / dist) * force;
          dustMoved = true;
        }
      }
      if (dustMoved) posAttr.needsUpdate = true;
    }

    // Rotation lente et constante du Plane
    if (planeObject) {
      planeObject.rotation.z += 0.01;
    }

    // Animation de la bulle : oscillation douce de droite à gauche pour attirer l'attention
    if (textBubble) {
      const t = clock.elapsedTime;
      // Mouvement lent et fluide en X (droite-gauche) : ±0.12 unités à 1.5 Hz
      textBubble.position.x = -28.978 + Math.sin(t * 1.5) * 0.12;
      // Position Y stable, pas de mouvement vertical
      textBubble.position.y = textBubbleBaseY;
      // Rotation très subtile qui suit le mouvement horizontal
      textBubble.rotation.z = Math.sin(t * 1.5) * 0.04;
    }

    // Clignotement continu du halo jaune sur la poussière : lueur toujours forte,
    // jamais éteinte, avec un scintillement irrégulier (deux sinusoïdes déphasées
    // + un peu de bruit).
    if (bloomPass) {
      const t = clock.elapsedTime;
      const flicker =
        0.6 +
        0.25 * Math.sin(t * 9.5) +
        0.15 * Math.sin(t * 23.7 + 1.3) +
        0.15 * Math.random();
      bloomPass.strength = 0.15 + flicker * 0.25;
    }

    if (bloomComposer && finalComposer) {
      renderWithBloom();
    } else {
      renderer.render(scene, camera);
    }
  });
}

// Collider de terrain : empêche la caméra de traverser Meshy_output (le sol/rocher).
// On sonde la hauteur du terrain juste sous la position XZ de la caméra (rayon vertical
// depuis un point au-dessus), plutôt que de raycaster depuis ATTIC — ATTIC est posé sur/
// dans ce mesh, donc un rayon sortant depuis la cible le toucherait immédiatement.
const TERRAIN_MARGIN = 0.2;
const TERRAIN_PROBE_HEIGHT = 200;
let terrainMesh = null;
const terrainRaycaster = new THREE.Raycaster();
const terrainRayOrigin = new THREE.Vector3();
const TERRAIN_RAY_DIR = new THREE.Vector3(0, -1, 0);

function preventTerrainClipping() {
  if (!terrainMesh) return;
  terrainRayOrigin.set(camera.position.x, camera.position.y + TERRAIN_PROBE_HEIGHT, camera.position.z);
  terrainRaycaster.set(terrainRayOrigin, TERRAIN_RAY_DIR);
  terrainRaycaster.far = TERRAIN_PROBE_HEIGHT * 2;
  const hits = terrainRaycaster.intersectObject(terrainMesh, false);
  if (!hits.length) return;
  const floor = hits[0].point.y + TERRAIN_MARGIN;
  if (camera.position.y < floor) {
    camera.position.y = floor;
  }
}

// Distance entre le point d'orbite (ATTIC) et le point le plus éloigné de la structure
// (rock/roof/Wall/Window) — la caméra ne doit jamais s'approcher plus près que ça.
function getStructureCollisionRadius(gltf, target) {
  const atticNode = gltf.scene.getObjectByName(ORBIT_TARGET_NAME);
  if (!atticNode) return 0.5;
  const box = new THREE.Box3().setFromObject(atticNode);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  return sphere.center.distanceTo(target) + sphere.radius;
}

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('libs/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

let part2ReadyCallback = null;

window.onScene3DPart2Ready = function onScene3DPart2Ready(callback) {
  if (loadedGltf) callback();
  else part2ReadyCallback = callback;
};

loader.load(
  'asset/model/scene-partie2.glb',
  (gltf) => {
    loadedGltf = gltf;
    if (part2ReadyCallback) part2ReadyCallback();
  },
  (event) => {
    if (window.onScene3DPart2Progress && event.total) {
      window.onScene3DPart2Progress(event.loaded / event.total);
    }
  }
);

function startWhenReady() {
  if (loadedGltf) {
    init(loadedGltf);
  } else {
    setTimeout(startWhenReady, 100);
  }
}

function createDustParticles(scene) {
  // Configuration des particules
  const config = {
    particleCount: 1300,
    radius: 50,
    speed: 0.005,
    gravity: 0.0005,
    oscillationSpeed: 0.3,
    oscillationAmount: 2,
    opacity: 0.4,
    particleSize: 0.7,
    // Blanc volontairement "HDR" (>1.0) : les particules sont additive-blend et
    // atténuées par l'alpha, il faut dépasser cette perte pour franchir le seuil
    // du bloom et produire un halo visible.
    color: new THREE.Color(2.0, 2.0, 2.0),
    // Rayon d'influence du curseur et force de dispersion des particules proches
    mouseRadius: 2.2,
    mouseStrength: 1.6
  };

  // Créer la géométrie
  const geometry = new THREE.BufferGeometry();

  // Générer positions aléatoires dans une sphère
  const positions = new Float32Array(config.particleCount * 3);
  for (let i = 0; i < config.particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = config.radius * Math.random();

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);

  // Vertex Shader
  const vertexShader = `
    uniform float time;
    uniform float speed;
    uniform float gravity;
    uniform float oscillationSpeed;
    uniform float oscillationAmount;
    uniform float radius;
    uniform float particleSize;
    uniform vec3 mouseWorld;
    uniform float mouseRadius;
    uniform float mouseStrength;

    void main() {
      // La position part de l'attribut (déplacé de façon permanente côté CPU
      // quand le curseur pousse une particule), puis on ajoute un mouvement
      // ambiant doux : gravité + oscillation. Pas de répulsion temporaire ici
      // (gérée uniquement côté CPU) pour qu'une particule poussée reste bien
      // à son nouvel emplacement, simplement animée autour de celui-ci.
      vec3 pos = position;

      // Gravité : descente lente et cyclique
      pos.y -= time * speed * gravity;

      // Régénération : quand y trop bas, remonter au sommet
      if (pos.y < -radius * 1.5) {
        pos.y = radius;
      }

      // Oscillation horizontale (flottement naturel)
      pos.x += sin(time * oscillationSpeed + position.z * 0.1) * oscillationAmount;
      pos.z += cos(time * oscillationSpeed * 0.7 + position.x * 0.1) * oscillationAmount;

      // Projection caméra
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      // Taille atténuée par la distance pour un effet volumétrique cohérent
      gl_PointSize = particleSize * (80.0 / -mvPosition.z);
    }
  `;

  // Fragment Shader
  const fragmentShader = `
    uniform vec3 dustColor;
    uniform float opacity;

    void main() {
      // Créer un disque doux (gradient radial)
      vec2 center = gl_PointCoord - 0.5;
      float dist = length(center);

      // Discard pixels en dehors du rayon
      if (dist > 0.5) discard;

      // Dégradé alpha : opaque au centre, transparent aux bords
      float alpha = (1.0 - dist * 2.0) * opacity;

      gl_FragColor = vec4(dustColor, alpha);
    }
  `;

  // Créer le matériau avec les shaders
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      speed: { value: config.speed },
      gravity: { value: config.gravity },
      oscillationSpeed: { value: config.oscillationSpeed },
      oscillationAmount: { value: config.oscillationAmount },
      radius: { value: config.radius },
      dustColor: { value: config.color },
      opacity: { value: config.opacity },
      particleSize: { value: config.particleSize },
      mouseWorld: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
      mouseRadius: { value: config.mouseRadius },
      mouseStrength: { value: config.mouseStrength }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  // Créer le mesh Points
  const dustParticles = new THREE.Points(geometry, material);
  dustParticles.userData.dustMaterial = material;
  // Sur le layer de bloom : c'est la poussière (et plus le Plane) qui reçoit le halo.
  dustParticles.layers.enable(BLOOM_LAYER);

  return dustParticles;
}

window.startScene3DPart2 = function startScene3DPart2() {
  if (started) return;
  started = true;
  startWhenReady();
};

window.setScene3DPart2Visible = function setScene3DPart2Visible(visible) {
  if (visible === revealed) return;
  revealed = visible;
  if (visible) {
    container.hidden = false;
    if (typeof window.startScene3DPart2 === 'function') window.startScene3DPart2();
    requestAnimationFrame(() => container.classList.add('visible'));
  } else {
    container.classList.remove('visible');
  }
};

// Fonction pour naviguer vers la partie 1 : un fondu croisé doux (pas d'overlay,
// pas de vidéo), la partie 2 s'efface pendant que la partie 1 apparaît dessous.
const PART2_FADE_OUT_MS = 1200; // doit rester synchronisé avec la transition CSS de #scene3d-part2

window.goToPart1 = function goToPart1() {
  // Commencer le chargement du modèle Partie 1 IMMÉDIATEMENT au clic sur l'avion,
  // en arrière-plan, sans bloquer la transition. Le modèle sera prêt quand
  // l'animation du fondu croisé sera terminée.
  if (typeof window.startLoadingPart1Model === 'function') {
    window.startLoadingPart1Model();
  }

  container.classList.remove('visible');

  const scene3dDiv = document.getElementById('scene3d');
  if (scene3dDiv) {
    scene3dDiv.hidden = false;
    // Forcer un reflow avant d'ajouter 'visible' : sinon le navigateur applique
    // hidden=false et opacity:1 dans la même frame, et le fondu (transition CSS)
    // ne se joue pas, l'image apparaît d'un coup.
    void scene3dDiv.offsetWidth;
    if (typeof window.playRevealAnimation === 'function') {
      window.playRevealAnimation();
    }
    if (typeof window.startScene3D === 'function') {
      window.startScene3D();
    }
    requestAnimationFrame(() => scene3dDiv.classList.add('visible'));
  }

  setTimeout(() => {
    container.hidden = true;
  }, PART2_FADE_OUT_MS);
};
