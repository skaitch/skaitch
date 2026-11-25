/**
 * /confidentialite: privacy policy of the skAItch web application.
 * Describes only what the code actually stores; update it with any new processing.
 */
export const USAGE_RETENTION_DAYS = 90;

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <p><a href="/">← Retour à skAItch</a></p>
      <h1>Politique de confidentialité</h1>
      <p className="legal-meta">Application web skAItch — dernière mise à jour : 16 novembre 2026.</p>

      <h2>Responsable du traitement</h2>
      <p>
        {/* TODO(owner): name the data controller and a contact address before going to production. */}
        Le service skAItch est édité par <strong>[éditeur à compléter]</strong>.
        Pour toute question ou pour exercer vos droits : <strong>[adresse de contact à compléter]</strong>.
      </p>

      <h2>Données traitées</h2>
      <ul>
        <li><strong>Compte</strong> : identifiant, adresse e-mail et fournisseur de connexion (Google, Apple ou e-mail et mot de passe), gérés par Firebase Authentication. Le mot de passe n'est jamais connu de skAItch.</li>
        <li><strong>Projets</strong> : les maquettes, leurs noms, descriptions et vignettes, enregistrés dans Firestore pour vous permettre de les retrouver.</li>
        <li><strong>Réglages IA</strong> : vos préférences et les clés de fournisseurs IA que vous enregistrez. Les clés sont chiffrées côté serveur et ne sont jamais renvoyées au navigateur. Les demandes IA sont transmises au fournisseur que vous avez choisi, selon ses propres conditions.</li>
        <li><strong>Accès MCP</strong> : les clés d'API que vous créez pour connecter un assistant, et les demandes en attente le temps de leur exécution.</li>
      </ul>

      <h2 id="statistiques">Statistiques d'usage</h2>
      <p>
        Pour surveiller le bon fonctionnement du service, skAItch compte les opérations que chaque compte demande au serveur
        (import IFC, sauvegarde de projet, tour de chat, appel d'outil MCP…). Pour chaque jour (UTC), seuls sont enregistrés
        le type d'opération, le nombre d'appels, leur durée par tranche et leur résultat (réussie, refusée, en échec, délai dépassé).
      </p>
      <ul>
        <li>Le <strong>contenu</strong> de vos projets, de vos conversations et de vos clés n'est jamais enregistré dans ces statistiques.</li>
        <li>Aucun historique appel par appel n'est conservé : seuls des totaux journaliers existent.</li>
        <li>Les totaux rattachés à votre compte sont <strong>supprimés automatiquement après {USAGE_RETENTION_DAYS} jours</strong>. Les totaux par type d'opération, qui ne désignent aucun compte, sont conservés.</li>
        <li>Seuls les <strong>administrateurs</strong> du service peuvent consulter ces statistiques ; votre navigateur ne peut ni les lire ni les modifier.</li>
        <li>Aucun suivi n'a lieu dans le navigateur (pas de mesure d'audience, ni de traceur publicitaire).</li>
      </ul>

      <h2>Hébergement et sous-traitants</h2>
      <p>L'application est hébergée par Vercel ; les comptes et les données sont stockés par Google Firebase. Ces prestataires conservent leurs propres journaux techniques pour une durée limitée.</p>

      <h2>Vos droits</h2>
      <p>
        Vous pouvez supprimer vos projets et vos clés depuis l'application. Vous disposez d'un droit d'accès, de rectification,
        d'effacement et d'opposition sur vos données, ainsi que du droit d'introduire une réclamation auprès de la CNIL.
      </p>
    </main>
  );
}
