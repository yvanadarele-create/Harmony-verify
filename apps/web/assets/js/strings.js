/* Harmony Verify — the strings that scripts write into the page.
 *
 * The pages themselves are translated at build time (see scripts/i18n), but a
 * chunk of what a reader sees is produced at runtime: the status chip on the
 * home page record, the two widget launchers, form validation, the cookie
 * banner, the booking panel. Those strings live in the JavaScript, so they need
 * their own table.
 *
 * English is not in the table. Every call site passes its English text as the
 * default, which keeps the source readable — t("chat.launch", "Chat with a
 * person") says what it renders — and makes a missing translation degrade to
 * English rather than to a key name.
 *
 * Loaded before the scripts that use it and deliberately tiny: no fetch, no
 * async, so the first thing painted is already in the right language.
 */
(function () {
  "use strict";

  var TABLE = {
    fr: {
      "chip.awaiting": "En attente de relecture",
      "chip.review": "Relecture en cours",
      "chip.corrected": "Corrigé",
      "chip.verified": "Vérifié",

      "chat.launch": "Parler à une personne",
      "chat.title": "Discuter avec l'équipe",
      "chat.online": "Quelqu'un est là",
      "chat.offline": "En dehors des heures d'ouverture",
      "chat.live": "Un collègue prend le relais pendant la journée de travail. Dites-nous ce que vous cherchez à faire et ce qui vous bloque — plus c'est concret, plus cela ira vite.",
      "chat.away": "Personne n'est au bureau pour l'instant. Envoyez quand même votre message, il sera là à l'ouverture",
      "chat.away.next": " — la prochaine plage de travail commence <b>{when}</b> à votre heure.",
      "chat.note": "Vous joignez une personne, pas l'assistant. Merci de ne pas inclure d'identifiants de patients ni de mots de passe.",
      "chat.email": "Votre e-mail pour que nous puissions répondre",
      "chat.message": "De quoi avez-vous besoin ?",
      "chat.send": "Envoyer à l'équipe",
      "chat.prefer": "Vous préférez l'e-mail ?",
      "chat.close": "Fermer la discussion",
      "chat.yourEmail": "Votre e-mail",
      "chat.yourMessage": "Votre message",

      "assist.launch": "Demander à Harmony",
      "assist.title": "Assistant Harmony",
      "assist.sub": "Répond sur la plateforme, pas sur la médecine.",
      "assist.hello": "Bonjour. Je peux expliquer le déroulement d'une vérification, son coût, les délais, qui relit vos productions et comment vos données sont traitées. Que puis-je vous apprendre ?",
      "assist.input": "Posez une question sur les tarifs, les délais, la sécurité…",
      "assist.send": "Envoyer",
      "assist.close": "Fermer l'assistant",
      "assist.human": "Confier cela à une personne",
      "assist.routes": "Voir tous les moyens de nous joindre",
      "assist.humanNow": "Parler à une personne maintenant",
      "assist.question": "Votre question",
      "assist.note": "Cet assistant ne donne pas d'avis médical et ne voit pas vos soumissions. Rien de ce que vous écrivez ici n'est conservé.",

      "film.play": "Lecture",
      "film.pause": "Pause",
      "film.replay": "Revoir",

      "cal.title": "Réserver une démo",
      "cal.sub": "Choisissez un horaire qui vous convient. La prise de rendez-vous est assurée par Calendly, qui se charge dans le panneau ci-dessous et dépose ses propres cookies.",
      "cal.loading": "Ouverture des disponibilités en direct…",
      "cal.close": "Fermer le panneau de réservation",
      "cal.failed": "Calendly ne s'est pas chargé.",
      "cal.newTab": "Ouvrir le calendrier dans un nouvel onglet",
      "cal.contact": "Utiliser le formulaire de contact",

      "form.required": "Ce champ est obligatoire.",
      "form.email": "Merci d'indiquer une adresse e-mail valide.",
      "form.sending": "Envoi en cours…",
      "form.sent": "Merci — votre message est parti. Nous répondons sous deux jours ouvrés.",
      "form.error": "Un problème est survenu. Merci d'écrire directement à ",
      "form.check": "Merci de corriger les champs signalés ci-dessus.",

      "form.required.short": "Obligatoire",
      "form.invalid.short": "Vérifiez cette valeur",
      "wiz.step": "Étape",
      "wiz.of": "sur",
      "wiz.back": "Retour",
      "wiz.next": "Continuer",
      "wiz.submit": "Envoyer la candidature",

      "consent.title": "Les cookies sur ce site",
      "consent.body": "Nous utilisons des cookies strictement nécessaires au fonctionnement du site. Les cookies de mesure d'audience et de marketing restent désactivés tant que vous ne les activez pas, et vous pouvez changer d'avis à tout moment.",
      "consent.accept": "Tout accepter",
      "consent.reject": "Tout refuser",
      "consent.manage": "Préférences",
      "consent.save": "Enregistrer mes choix",
      "consent.region": "Choix relatifs aux cookies",
      "consent.dialogTitle": "Préférences de cookies",
      "consent.dialogIntro": "Choisissez ce que ce site peut stocker. Les éléments cliniques que vous nous transmettez ne servent jamais à la publicité et ne sont jamais partagés avec un prestataire de mesure d'audience.",
      "consent.close": "Fermer les préférences de cookies",
      "consent.privacy": "Lire l'avis de confidentialité",
      "consent.always": "Toujours actif",
      "consent.essential": "Strictement nécessaires",
      "consent.essential.desc": "Maintiennent votre session, répartissent la charge entre nos serveurs et mémorisent ce choix. Le site ne peut pas fonctionner sans eux, ils ne peuvent donc pas être désactivés.",
      "consent.analytics": "Mesure d'audience",
      "consent.analytics.desc": "Mesure agrégée et anonymisée des pages lues et des points de sortie. Jamais reliée à une soumission clinique, jamais vendue.",
      "consent.marketing": "Marketing",
      "consent.marketing.desc": "Mesure si une campagne a mené à une demande de démonstration. Désactivé tant que vous ne l'activez pas."
    },

    es: {
      "chip.awaiting": "Pendiente de revisión",
      "chip.review": "Revisión en curso",
      "chip.corrected": "Corregido",
      "chip.verified": "Verificado",

      "chat.launch": "Hablar con una persona",
      "chat.title": "Chatear con el equipo",
      "chat.online": "Hay alguien disponible",
      "chat.offline": "Fuera del horario de trabajo",
      "chat.live": "Un compañero atiende estos mensajes durante la jornada. Cuéntenos qué intenta hacer y qué se lo impide: cuanto más concreto, más rápido irá.",
      "chat.away": "Ahora mismo no hay nadie en la mesa. Envíelo igualmente y quedará esperando",
      "chat.away.next": " — el siguiente turno empieza el <b>{when}</b> en su hora local.",
      "chat.note": "Esto llega a una persona, no al asistente. Por favor, no incluya identificadores de pacientes ni contraseñas.",
      "chat.email": "Su correo para poder responderle",
      "chat.message": "¿Qué necesita?",
      "chat.send": "Enviar al equipo",
      "chat.prefer": "¿Prefiere el correo?",
      "chat.close": "Cerrar el chat",
      "chat.yourEmail": "Su correo electrónico",
      "chat.yourMessage": "Su mensaje",

      "assist.launch": "Preguntar a Harmony",
      "assist.title": "Asistente de Harmony",
      "assist.sub": "Responde sobre la plataforma, no sobre medicina.",
      "assist.hello": "Hola. Puedo explicarle cómo funciona la verificación, cuánto cuesta, cuánto tarda, quién revisa sus resultados y cómo se tratan sus datos. ¿Qué le resultaría útil?",
      "assist.input": "Pregunte sobre precios, plazos, seguridad…",
      "assist.send": "Enviar",
      "assist.close": "Cerrar el asistente",
      "assist.human": "Que lo vea una persona",
      "assist.routes": "Ver todas las vías de contacto",
      "assist.humanNow": "Hablar ahora con una persona",
      "assist.question": "Su pregunta",
      "assist.note": "Este asistente no ofrece asesoramiento médico ni ve sus envíos. Nada de lo que escriba aquí se guarda.",

      "film.play": "Reproducir",
      "film.pause": "Pausa",
      "film.replay": "Volver a ver",

      "cal.title": "Reservar una demo",
      "cal.sub": "Elija la hora que mejor le venga. La reserva la gestiona Calendly, que se carga en el panel de abajo y deja sus propias cookies.",
      "cal.loading": "Abriendo la disponibilidad en directo…",
      "cal.close": "Cerrar el panel de reserva",
      "cal.failed": "Calendly no se ha cargado.",
      "cal.newTab": "Abrir el calendario en una pestaña nueva",
      "cal.contact": "Usar el formulario de contacto",

      "form.required": "Este campo es obligatorio.",
      "form.email": "Introduzca una dirección de correo válida.",
      "form.sending": "Enviando…",
      "form.sent": "Gracias, su mensaje ha salido. Respondemos en un plazo de dos días laborables.",
      "form.error": "Algo ha fallado. Escriba directamente a ",
      "form.check": "Corrija los campos señalados más arriba.",

      "form.required.short": "Obligatorio",
      "form.invalid.short": "Revise este valor",
      "wiz.step": "Paso",
      "wiz.of": "de",
      "wiz.back": "Atrás",
      "wiz.next": "Continuar",
      "wiz.submit": "Enviar la candidatura",

      "consent.title": "Cookies en este sitio",
      "consent.body": "Usamos cookies estrictamente necesarias para que el sitio funcione. Las cookies de analítica y de marketing están desactivadas hasta que usted las active, y puede cambiar de opinión cuando quiera.",
      "consent.accept": "Aceptar todo",
      "consent.reject": "Rechazar todo",
      "consent.manage": "Preferencias",
      "consent.save": "Guardar mis preferencias",
      "consent.region": "Preferencias de cookies",
      "consent.dialogTitle": "Preferencias de cookies",
      "consent.dialogIntro": "Elija qué puede guardar este sitio. El material clínico que nos envíe nunca se utiliza con fines publicitarios ni se comparte con un proveedor de analítica.",
      "consent.close": "Cerrar las preferencias de cookies",
      "consent.privacy": "Leer el aviso de privacidad",
      "consent.always": "Siempre activo",
      "consent.essential": "Estrictamente necesarias",
      "consent.essential.desc": "Mantienen su sesión, reparten la carga entre nuestros servidores y recuerdan esta preferencia. El sitio no puede funcionar sin ellas, así que no pueden desactivarse.",
      "consent.analytics": "Analítica",
      "consent.analytics.desc": "Medición agregada y anonimizada de qué páginas se leen y dónde abandonan los visitantes. Nunca se vincula a un envío clínico ni se vende.",
      "consent.marketing": "Marketing",
      "consent.marketing.desc": "Mide si una campaña ha llevado a una solicitud de demostración. Desactivado salvo que usted lo active."
    }
  };

  function lang() {
    var code = (document.documentElement.getAttribute("lang") || "en").slice(0, 2);
    return TABLE[code] ? code : "en";
  }

  var table = TABLE[lang()] || null;

  /**
   * t("chat.send", "Send to the team") -> the translation, or the English given.
   * Optional third argument replaces {placeholders}.
   */
  window.HarmonyText = function (key, english, vars) {
    var value = (table && table[key]) || english || "";
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = value.split("{" + name + "}").join(vars[name]);
      });
    }
    return value;
  };

  window.HarmonyText.lang = lang;
})();
