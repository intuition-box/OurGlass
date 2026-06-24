# FUTURE — idées hors-scope POC actuel

Idées capturées pour réflexion, pas encore engagées. Une idée ne devient une
tâche que sur décision explicite (voir `.claude/rules/workflow.md`).

## Streaming payment — payroll accumulatif (2026-06-23)

**Cible :** ajouter une nouvelle page OurGlass dédiée au *payment streaming*,
à côté du système d'abonnement existant.

**Caveat à utiliser :** `erc20Streaming` du Delegation Toolkit.
https://docs.metamask.io/smart-accounts-kit/reference/delegation/caveats#erc20streaming

### Le besoin : deux systèmes distincts, deux publics

**Système 1 — abonnement service (ce qui existe aujourd'hui)**
- Cap *par période* (mensuel), via le caveat `erc20PeriodTransfer`.
- Doit être claim *à chaque période*, **ne s'accumule pas**.
- Le non-cumul est un *choix* : pour une DAO qui paie un service, ça évite de
  laisser traîner un dû qui s'empile si quelqu'un oublie de claim.
- Public : DAO ↔ service.
- Conséquence assumée : si on ne claim pas une période, c'est perdu (use-it-or-lose-it).

**Système 2 — payroll accumulatif (nouveau, à construire)**
- Le paiement **s'accumule en continu** (stream linéaire), via `erc20Streaming`.
- Le bénéficiaire claim quand il veut ; rien n'est perdu s'il ne claim pas
  immédiatement.
- Public : contributeur / salarié (payroll).
- Motivation clé : si le bénéficiaire est empêché de claim (ex. accident,
  indisponibilité), avec le système 1 ce serait une **perte sèche** ; avec le
  système 2 le dû s'accumule et reste réclamable → pas de perte.

### Distinction de design à retenir
- Système 1 = cap périodique non cumulatif (service, DAO).
- Système 2 = stream cumulatif borné par un cap (payroll, contributeur).
- Les deux cohabitent dans OurGlass comme deux flux/pages distincts.

### Montant claimable — stratégie décidée (2026-06-24)
- **POC (maintenant) :** ne pas se casser la tête sur le calcul précis du
  claimable. S'appuyer sur le **timestamp déjà présent dans l'agreement pinné
  sur IPFS** (startDate des terms) pour estimer la plage écoulée. Estimation
  côté client, suffisante pour la démo. Pas de tracking on-chain du déjà-réclamé
  pour l'instant.
- **Plus tard :** stocker les **caveats + délégations sur Intuition** → un
  **graph traversable** avec timestamps → des **plages temporelles précises**
  pour calculer exactement les montants disponibles/réclamés. C'est ce qui
  remplacera l'estimation IPFS et rendra le calcul fiable (y compris si des
  claims viennent de plusieurs sources).
- **Garde-fou :** l'estimation côté client n'est que de l'UX. Le caveat
  `erc20Streaming` sait *exactement* combien est débloqué et l'enforce on-chain.
  Une estimation fausse ne peut pas causer de sur-retrait : au pire un claim
  trop optimiste **revert**. La sécurité ne dépend jamais de notre estimation.

### À creuser (questions ouvertes)
- Paramètres exacts du caveat `erc20Streaming` : confirmés —
  `tokenAddress`, `initialAmount`, `maxAmount`, `amountPerSecond`, `startTime`.
- Répartition des tâches entre les 2 devs : ébauche faite (Dev A = création +
  coeur streaming + owner storage ; Dev B = claim + séparation UI + home +
  owner redeem).
- Écran de choix en amont (2 cartes Abonnement/Stream) recommandé, puis deux
  formulaires dédiés.
- **Stockage Intuition (caveats + délégations en graph)** — chantier suivant
  après le streaming ; débloque le calcul précis des montants.
