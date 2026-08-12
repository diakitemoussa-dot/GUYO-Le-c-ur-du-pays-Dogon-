## Objective
Faire fonctionner entièrement le voyage partie 2 → partie 1 sur « Le cœur de Bananin » (GitHub Pages) : clic sur l'avion en papier → village (textes + audio), y compris après un aller-retour (scroll en partie 1 → retour partie 2 → re-clic avion).

## Important Details
- **Navigation d'étape (remplace la bulle 3D)** : la bulle « clic sur l'avion en papier » de `scene3d-part2.js` a été retirée (`createTextBubble`, variables `textBubble*`, son animation). À la place, bouton fixe `#stage-nav-btn` (HTML + CSS `.stage-nav-btn`) piloté par `main.js` : au grenier (étape 2) il affiche « l'histoire → » (= `goToPart1`) ; dans l'histoire (étape 1) « → le grenier » (= scrollTo 0 + `setScene3DPart2Visible(true)` après 120 ms). L'état est synchronisé par `window.setStageNav` appelé dans `goToPart1` et `setScene3DPart2Visible`. Le bouton est masqué quand l'écran de fin (DOGOKUN SORO) est visible (il a son propre RETOUR). L'avion en papier reste cliquable (easter egg).
- Projet actif : `C:\Users\Kabakoo Apprenant.e\Desktop\MES PROJETS\projects\active\Le coeur de Bananin`. Le repo à `...\MES PROJETS\Le coeur de Bananin` (workspace root) est vide/obsolète — NE PAS travailler dedans. Les serveurs locaux (http-server) peuvent servir l'un ou l'autre ; vérifier par `curl`/hash avant de conclure.
- Git : `origin https://github.com/diakitemoussa-dot/Le-coeur-de-Bananin.git`, branche `main`, Pages `legacy` → `https://diakitemoussa-dot.github.io/Le-coeur-de-Bananin/`. Dernier commit : `10824b5` (« fix: retirer la bulle AR … »), avant : `30fa1f7` (caméra partie 1 = `gltf.cameras[0]`).
- **Deux bugs racines corrigés dans `dbb3211`** :
  1. `scene3d.js` → `startWhenReady()` : l'ancien retry faisait `setTimeout(startWhenReady, 100)` SANS réinitialiser `initPending`, donc une seule relance : si le GLB partie 1 mettait >100 ms à charger (toujours le cas en réseau), `init()` n'était JAMAIS appelé → la partie 1 restait vide/noire malgré le clic (c'était le « même problème » persisté). Fix : `setTimeout(() => { initPending = false; startWhenReady(); }, 100)` (polling jusqu'au chargement) + `try/catch` autour de `init` avec `console.error`.
  2. `scene3d-part2.js` → le garde anti-double-clic `navigationStarted` était local à `init()` et ne se réinitialisait jamais → après le 1er clic de la session, l'avion restait muet. Fix : variable module-level `planeNavigationStarted` (déclarée près de `PLANE_HIT_RADIUS`) + reset `planeNavigationStarted = false` dans `setScene3DPart2Visible(true)` (le retour partie 2 passe par là via `updateModelFade` dans `scene3d.js` : `window.setScene3DPart2Visible(opacity <= 0.001)`).
- Tous les hooks de debug temporaires (`window.__part2Debug`, `window.__p1`) ont été RETIRÉS avant le commit (19 références nettoyées dans scene3d-part2.js, plus scene3d.js).
- Garde aussi : `scene3d-part2.js` contient toujours le fix `2e040cf` : `goToPart1()` fait `window.scrollTo(0, 0)` + masque `#end-chapter-screen`.
- **Caméra partie 1 (`30fa1f7`)** : `init()` réutilise directement `gltf.cameras[0]` (ou fallback `new THREE.PerspectiveCamera(45, ...)`) — position, rotation ET FOV viennent du GLB, rien n'est modifié. Seul l'aspect + `updateProjectionMatrix()` sont rafraîchis au resize (`onResize`). `findCameraNode`/`syncCameraFromNode`/`cameraNode`/`CAMERA_FOV_DEG`/`tempScale` supprimés.
  - Mécanique confirmée (GLTFLoader r164) : un nœud GLB qui n'a QUE une caméra → `objects.length===1` → le nœud de la scène EST l'objet caméra, et le loader applique `translation`/`rotation` du nœud DIRECTEMENT sur `gltf.cameras[0]`. Donc `gltf.cameras[0]` porte déjà la pose monde, et comme la caméra est dans `gltf.scene`, le mixer l'anime via la `CameraAction`.
  - `CameraAction` (scene-bananin.glb) : translation animée 178 keyframes (0→8,125 s), la caméra recule x=-3,57 → -12,82 pendant le scroll ; rotation constante = pose du nœud (quat [-0.0674, -0.7039, -0.0674, 0.7039], regard ≈ +X, légèrement vers le bas) ; scale=1. Pose caméra PC : (-3.567, 3.135, -1.632), FOV 22,9° ; mobile (scene-bananin-mobile.glb) : (8.842, 0, 0), FOV 39,6°.
  - **Comportement mesuré (readPixels WebGL réel)** : au démarrage (scroll 0) le canvas 3D est quasi vide (~1,5 % opaque — caméra au bord du modèle, FOV étroit) ; à mi-scroll le village remplit l'écran (100 %, 186 couleurs). C'est le choix assumé de l'utilisateur (il corrigera la pose dans le GLB/Blender plus tard si besoin).
- Côté détection du clic : `setupPlaneButton` utilise `pointerdown/pointerup` (seuil mouvement <10 px) + `isPlaneHit` = raycast sphère `PLANE_HIT_RADIUS=1.5` autour du worldPos du plane. Valide.
- Les `.glb` : partie 1 `asset/model/scene-bananin.glb` (desktop, 1 880 404 octets, path mobile `scene-bananin-mobile.glb` sous 700 px) ; partie 2 `asset/model/SCENE_1.glb` (2,79 Mo, remplace l'ancien `scene-partie2.glb` de 5,7 Mo) ; draco dans `libs/draco/` (`draco_decoder.wasm` + `draco_wasm_wrapper.js`).
- **AR Samsung vs iPhone (`main.js`)** : sur Samsung, WebXR (« immersive-ar ») est peu fiable dans les deux sens (plante le navigateur — bug pilote ANGLE/Exynos, cf. issues model-viewer #3495/#4661/#4665 — OU répond « non supporté » alors qu'ARCore/Scene Viewer fonctionne). `detectARMode()` → `isSamsung()` (UA `Samsung`, `SM-…`, `GT-…`, `SGH-…`, `SCV`/`SC-…`) : sur TOUT Samsung on renvoie directement `scene-viewer` SANS consulter WebXR (model-viewer 3.4.0 choisit scene-viewer sur n'importe quel Android non-Firefox via `dh=lh&&!hh&&!uh`). Autres Android ARCore → `webxr` ; iOS → `quick-look`. `tryActivateAR()` est enveloppé de try/catch → un échec d'activation affiche l'écran d'incompatibilité au lieu de planter la page.

## Work State
### Completed
- Bulle AR de la partie 1 village retirée (`10824b5` poussé) : suppression de `arBubble`/`arBubbleBaseY`, `createTextBubble` (code mort), `createARTextBubble`, son animation dans `applyParallaxAndRender` et sa création dans `init` (ligne « n'oublie pas que clic sur le AR … ») + `tempBoxSize`. SHA-256 déployé == local (`4648463A…`).
- Caméra partie 1 réutilise `gltf.cameras[0]` tel quel (commit `30fa1f7` poussé, SHA-256 déployé == local : `087B0F8A…`).
- Smoke tests PASS en local ET déployé (desktop + mobile 512px) : clic1 → village, scroll → partie 2, clic2 → retour partie 1.
- Identification + fix des 2 bugs racines (voir ci-dessus), commit `dbb3211` poussé.
- Vérifs locales et déployées :
  - Fichiers déployés == fichiers locaux (SHA-256 identiques : scene3d.js `217B075B…`, scene3d-part2.js `C1BE2395…`).
  - Smoke test end-to-end (`C:\Users\KABAKO~1.E\AppData\Local\Temp\opencode\smoke-nav.cjs`) PASS sur `http://localhost:8093/` ET sur le site déployé : clic1 → village visible (scrollY 0, canvas partie 1 créé, skyOpacity "1") ; scroll max → partie 2 réapparaît (skyOpacity "0") ; clic2 → retour partie 1 (scrollY 0, `#scene3d-part2` hidden).
  - Le clic1 vérifie aussi l'init partie 1 : `document.querySelector("#scene3d canvas")` doit exister (sinon partie 1 jamais rendue).
- En ligne, l'attente peut être longue (GLB 5,7 Mo) : timeout du smoke à 180 s pour part2, 150 s pour canvas. La première passe « canvas timeout » était juste le réseau.

### Active
- Rien de bloqué. Les hooks debug `__part2Debug`/`__p1` sont retirés du code : pour retrouver la position écran de l'avion dans un test, le smoke test clique à des positions FIXES connues (NDC ~(0.42,−0.4) au chargement, ~(0.35,−0.15) au retour) avec boucle de ré-essais jusqu'à ce que l'état DOM confirme la navigation — ne dépend plus des hooks.

### Blocked
- Rien.

## Next Move (si reprise)
- Si besoin de re-tester le déplacement : utiliser `smoke-nav.cjs` (profil chrome nettoyé automatiquement, `--disable-http-cache`, port 9334). Ne PAS se fier à des sessions Chrome persistantes : le `http-server` sert `cache-control: max-age=86400` et un profil Chrome réutilisé sert du JS périmé (vérifier avec un profil vierge).
- Si nouveau changement : `git add`/commit/push depuis `projects\active\Le coeur de Bananin`, attendre ~45 s pour Pages, comparer les SHA-256 local vs déployé, puis `smoke-nav.cjs <URL déployée>`.

## Relevant Files
- `...\projects\active\Le coeur de Bananin\scene3d.js` : `startWhenReady` (fix polling, ~l.808), `init` (~l.676, caméra = `gltf.cameras[0]`), `startLoadingPart1Model` (lazy loading), `updateModelFade` (~l.567), `setProgress`/`getScrollProgress`/`onScroll`, `onResize` (aspect + `updateProjectionMatrix`).
- `...\projects\active\Le coeur de Bananin\scene3d-part2.js` : `planeNavigationStarted` (~l.286), `setScene3DPart2Visible` avec reset (~l.930), `setupPlaneButton`/`isPlaneHit`, `goToPart1` (scrollTo 0, ~l.950), `startScene3DPart2`.
- `...\projects\active\Le coeur de Bananin\main.js` : `transitionToScene3D` (affiche partie 2 d'abord), `playRevealAnimation`, écran fin + bouton RETOUR (~l.460).
- Serveur local actif : `http://localhost:8093/` (et 8091/8092). Fichiers temp : `C:\Users\KABAKO~1.E\AppData\Local\Temp\opencode\smoke-nav.cjs`, `smoke-mobile.cjs`, `cam-probe.cjs`, `clip-test.cjs`, `inspect-camera.cjs`, `inspect-anims.cjs`, `inspect-camaction.cjs`, `inspect-geom.cjs`, `inspect-tree.cjs`, `GLTFLoader-r164.js`.
