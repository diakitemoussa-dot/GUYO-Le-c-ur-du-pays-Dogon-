// boot.js — script classique (sans module, sans dépendance CDN).
//
// Il est le SEUL à piloter l'écran de chargement, et fonctionne même si les
// gros modules (three.js, animejs…) tardent à se télécharger : l'écran ne
// peut plus rester bloqué « dès le chargement ». L'expérience (partie 2 +
// grenier 3D) est révélée par window.revealExperience dès que le code est
// prêt, et l'écran de chargement s'efface alors — ou au plus tard après
// MAX_LOADING_MS, quel que soit l'état du téléchargement.
//
// NB : on NE retire PAS l'écran de chargement du DOM tant que les modules ne
// sont pas exécutés, car loading-animation.js lit le canvas et le SVG qui
// vivent dedans (une suppression prématurée ferait planter main.js).
(function () {
  'use strict';

  var MIN_LOADING_MS = 2500;  // laisse jouer l'animation du logo (décoratif)
  var MAX_LOADING_MS = 12000; // filet de sécurité absolu
  var ERROR_TIMEOUT_MS = 45000; // sans modules du tout, affiche une erreur
  var revealed = false;
  var startTime = performance.now();

  function showPart2LoadingMessage(message) {
    var spinner = document.getElementById('part2-loading');
    if (!spinner) return;
    var label = spinner.querySelector('.part2-loading-label');
    if (label) label.textContent = message;
    spinner.classList.remove('hidden');
  }

  // Masque l'écran (opacité 0, pointer-events none) sans le détruire.
  function hideLoadingScreen() {
    var el = document.getElementById('loading-screen');
    if (!el) return;
    el.classList.add('fade-out');
  }

  // Appelle window.revealExperience dès qu'il existe, puis retire l'écran de
  // chargement du DOM une fois que les modules ont pu lire leurs éléments.
  function pollRevealExperience() {
    if (typeof window.revealExperience === 'function') {
      window.revealExperience();
      setTimeout(function () {
        var el = document.getElementById('loading-screen');
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 1200);
    } else {
      setTimeout(pollRevealExperience, 100);
    }
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    hideLoadingScreen();
    pollRevealExperience();
  }

  // Chemin rapide : les modules sont déjà prêts → révèle dès que l'animation
  // du logo a eu le temps de jouer.
  (function pollReady() {
    if (typeof window.revealExperience === 'function') {
      var elapsed = performance.now() - startTime;
      if (elapsed >= MIN_LOADING_MS) {
        reveal();
        return;
      }
    }
    setTimeout(pollReady, 100);
  })();

  // Chemin lent (modules CDN qui traînent) : révélation forcée. Planifié dès
  // l'évaluation du script, car DOMContentLoaded peut lui-même être retardé
  // par des ressources lentes et ne doit pas repousser le filet de sécurité.
  setTimeout(function () {
    if (!revealed) reveal();
  }, MAX_LOADING_MS);

  // Échec total : aucun module arrivé après ERROR_TIMEOUT_MS → message d'erreur
  // clair dans l'indicateur du grenier.
  setTimeout(function () {
    if (typeof window.revealExperience !== 'function') {
      showPart2LoadingMessage('impossible de charger l\u2019expérience. vérifie ta connexion puis recharge la page.');
    }
  }, ERROR_TIMEOUT_MS);
})();
