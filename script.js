document.addEventListener('DOMContentLoaded', () => {
    // Références aux éléments de l'interface
    const DOMElements = {
        runBtn: document.getElementById('run-simulation'),
        saveBtn: document.getElementById('save-client'),
        loadBtn: document.getElementById('load-client-input'),
        deptSelect: document.getElementById('departement'),
        communeSelect: document.getElementById('commune'),
        resultsContainer: document.getElementById('results-container'),
        chartCanvas: document.getElementById('results-chart'),
        newBuildCheckbox: document.getElementById('is_new_build'), // Renommé pour clarté
        newBuildOptionsDiv: document.getElementById('new-build-options'), // Nouveau div pour les radios
        typeBienRadios: document.querySelectorAll('input[name="type_bien"]'), // Nouveaux boutons radio
        inputs: {
            salaire: document.getElementById('salaire'),
            immobilier: document.getElementById('immobilier'),
            pct_immobilier: document.getElementById('pct_immobilier'),
            financier: document.getElementById('financier'),
            pct_financier: document.getElementById('pct_financier'),
            rfr_n2: document.getElementById('rfr_n2'), // Nouveau
            conso: document.getElementById('conso'),
            immobilier_credit: document.getElementById('immobilier_credit'),
            leasing: document.getElementById('leasing'),
            liquidites: document.getElementById('liquidites'),
            taux_endettement: document.getElementById('taux_endettement'),
            taux_interet: document.getElementById('taux_interet'),
            taux_assurance: document.getElementById('taux_assurance'),
            duree: document.getElementById('duree'),
            parts_fiscales: document.getElementById('parts_fiscales'),
            nb_personnes: document.getElementById('nb_personnes'),
            tva_reduite: document.getElementById('tva_reduite'),
            include_notaire: document.getElementById('include_notaire'),
            is_new_build: document.getElementById('is_new_build'), // Toujours inclus pour l'accès direct à sa valeur checked
        }
    };

    let zonageData = {};
    let resultsChart = null;

    // --- PLAFONDS PTZ ET ACTION LOGEMENT (RFR N-2) ---
    // Les plafonds sont basés sur le nombre de personnes et la zone.
    // Sources: Infos de l'utilisateur

    const PTZ_RFR_THRESHOLDS = {
        "A":    [49000, 68600, 88200, 102900, 117600, 132300, 147000, 161700],
        "A bis": [49000, 68600, 88200, 102900, 117600, 132300, 147000, 161700], // Zone A bis a les mêmes plafonds que A
        "B1":   [34500, 48300, 62100, 72450, 82800, 93150, 103500, 113850],
        "B2":   [31500, 44100, 56700, 66150, 75600, 85050, 94500, 103950],
        "C":    [28500, 39900, 51300, 59850, 68400, 76950, 85500, 94050]
    };

    const ACTION_LOGEMENT_RFR_THRESHOLDS = {
        "A bis": [43953, 65691, 86112, 102812, 122326, 137649],
        "A":     [43953, 65691, 78963, 94585, 111971, 126001],
        "B1":    [35825, 47842, 57531, 69455, 81705, 92080],
        "B2":    [32243, 43056, 51778, 62510, 73535, 82873], // B2 et C ont les mêmes plafonds
        "C":     [32243, 43056, 51778, 62510, 73535, 82873]
    };
    // Pour Action Logement, la personne supplémentaire a un montant fixe à ajouter au 6 personnes et plus.
    const ACTION_LOGEMENT_ADDITIONAL_PERSON_THRESHOLD = {
        "A bis": 15335,
        "A":     14039,
        "B1":    10273,
        "B2":    9243,
        "C":     9243
    };

    // --- LOGIQUE DE CALCUL ---

    function determineZone(dept, commune) {
        return zonageData.communes?.[dept]?.[commune] || 'C';
    }

    function isPtzEligible(rfr, nbPersons, zone) {
        // Le nombre de personnes est indexé à partir de 1, mais les tableaux commencent à l'index 0.
        // Pour 1 personne, index 0 ; pour 8 personnes et +, index 7
        const index = Math.min(nbPersons - 1, 7); // Max index 7 for 8+ persons
        const threshold = PTZ_RFR_THRESHOLDS[zone]?.[index];
        return rfr <= threshold;
    }

    function calculatePtzMaxAmount(rfr, nbPersons, zone, operationCost, typeBien) {
        if (!isPtzEligible(rfr, nbPersons, zone)) {
            return 0;
        }
        // Plafonnement du PTZ par le coût de l'opération (40% du coût total)
        let ptz_max_base = Math.min(operationCost * 0.4, PTZ_RFR_THRESHOLDS[zone]?.[Math.min(nbPersons - 1, 7)] || 0);
        
        // Plafonnement spécifique pour appartement/maison
        if (typeBien === 'appartement') {
            ptz_max_base = Math.min(ptz_max_base, operationCost * 0.5); // 50% du prix de l'appartement
        } else if (typeBien === 'maison') {
            ptz_max_base = Math.min(ptz_max_base, operationCost * 0.3); // 30% du prix de la maison
        }
        
        // Ancien plafonnement par zone, remplacé par l'utilisation du RFR_THRESHOLDS qui donne déjà les plafonds par personne
        // Pour être sûr de ne pas dépasser les plafonds RFR du barème, on reprend le seuil RFR converti en montant max de prêt
        // (qui sont les valeurs directes dans les tableaux PTZ_RFR_THRESHOLDS).
        // Si le calcul ci-dessus utilise un montant plus faible, c'est celui-là qui prévaut.
        
        return Math.floor(ptz_max_base); // Retourne un montant entier
    }


    function isActionLogementEligible(rfr, nbPersons, zone) {
        // Action Logement a "A bis" et "A" séparés, et "B2 et C" regroupés
        let effectiveZone = zone;
        if (zone === "C") effectiveZone = "B2"; // B2 et C ont les mêmes plafonds

        const baseThresholds = ACTION_LOGEMENT_RFR_THRESHOLDS[effectiveZone];
        if (!baseThresholds) return false;

        let threshold;
        if (nbPersons >= 1 && nbPersons <= 6) {
            threshold = baseThresholds[nbPersons - 1];
        } else if (nbPersons > 6) {
            // Pour 7 personnes, prendre le seuil de 6 personnes + 1 fois le montant par personne supplémentaire
            // Pour 8 personnes, prendre le seuil de 6 personnes + 2 fois le montant par personne supplémentaire, etc.
            const additionalPersons = nbPersons - 6;
            threshold = baseThresholds[5] + (additionalPersons * ACTION_LOGEMENT_ADDITIONAL_PERSON_THRESHOLD[effectiveZone]);
        } else {
            return false; // Nb personnes invalide
        }
        return rfr <= threshold;
    }

    function calculateActionLogementMax(isEligible) {
        return isEligible ? 30000 : 0; // Le montant reste fixe à 30 000€ si éligible
    }

    function maxMensualite(income, charges, debtRatio, includeCharges) {
        return Math.max(0, (income * (debtRatio / 100)) - (includeCharges ? charges : 0));
    }

    function capitalToMonthly(capital, rate, years) {
        if (years === 0) return 0;
        const r = rate / 100 / 12;
        const n = years * 12;
        if (r === 0) return capital / n;
        return capital * r / (1 - Math.pow(1 + r, -n));
    }

    function monthlyToCapital(mensualite, rate, years) {
        if (years === 0) return 0;
        const r = rate / 100 / 12;
        const n = years * 12;
        if (r === 0) return mensualite * n;
        return mensualite * (1 - Math.pow(1 + r, -n)) / r;
    }
    
    function simulate(params) {
        let results = [];
        const vatRates = params.test_reduced_vat ? [5.5] : [20.0];

        const scenarios = [
            { id: 'CA', label: 'Crédit Amortissable seul', usePtz: false, useAL: false },
            { id: 'CA+PTZ', label: 'Crédit Amortissable + PTZ', usePtz: true, useAL: false },
            { id: 'CA+AL', label: 'Crédit Amortissable + Action Logement', usePtz: false, useAL: true },
            { id: 'CA+PTZ+AL', label: 'Crédit Amortissable + PTZ + Action Logement', usePtz: true, useAL: true }
        ];

        // Déterminer les options de simulation basées sur les entrées de l'utilisateur
        const hasExistingCharges = params.charges > 0;
        const hasLiquidity = params.liquidity > 0;

        const use_charges_options = hasExistingCharges ? [true, false] : [false];
        const with_apport_options = hasLiquidity ? [true, false] : [false];

        // Déterminer l'éligibilité réelle au PTZ et AL
        const ptz_is_eligible_by_rfr = isPtzEligible(params.rfr_n2, params.nb_persons, params.zone);
        const al_is_eligible_by_rfr = isActionLogementEligible(params.rfr_n2, params.nb_persons, params.zone);

        for (const vat of vatRates) {
            for (const use_charges of use_charges_options) {
                for (const with_apport of with_apport_options) {
                    
                    for (const scenario of scenarios) {
                        // Skip scenarios if PTZ or AL are not eligible by RFR
                        if (scenario.usePtz && (!params.is_new_build || !ptz_is_eligible_by_rfr)) continue;
                        if (scenario.useAL && !al_is_eligible_by_rfr) continue;

                        let label = scenario.label;
                        label += vat === 5.5 ? ' (TVA réduite)' : ' (TVA 20%)';
                        label += use_charges ? ' (avec ch. exist.)' : ' (sans ch. exist.)';
                        label += with_apport ? ' (avec apport)' : ' (sans apport)';

                        const max_mens = maxMensualite(params.income, params.charges, params.debt_ratio, use_charges);
                        if (max_mens <= 0) continue;

                        let low = 50000, high = 2000000; // Augmenter la plage de recherche
                        let bestResult = { montant_empruntable: 0, cout_total: 0 };
                        
                        for (let i = 0; i < 100; i++) { // Augmenter les itérations pour plus de précision
                            const cost = (low + high) / 2;
                            
                            // Calcul du PTZ et AL basé sur l'éligibilité réelle par RFR et type de bien
                            const ptz_amt = scenario.usePtz && params.is_new_build && ptz_is_eligible_by_rfr ? 
                                            calculatePtzMaxAmount(params.rfr_n2, params.nb_persons, params.zone, cost, params.type_bien) : 0;
                            const al_amt = scenario.useAL && al_is_eligible_by_rfr ? calculateActionLogementMax(al_is_eligible_by_rfr) : 0;

                            const notary = params.include_notary ? (params.is_new_build ? cost * 0.025 : cost * 0.08) : 0;
                            const assurance_monthly = (cost * params.assurance_rate / 100) / 12;
                            const apport = with_apport ? Math.min(params.liquidity, cost * 0.1) : 0;
                            
                            // PTZ est à taux zéro, donc pas de mensualités d'intérêt, seulement le remboursement du capital sur 10 ans (période la plus courte)
                            // La période du PTZ peut être plus longue, mais pour la mensualité du prêt amortissable, on considère la durée totale.
                            // Pour les besoins de ce simulateur, le PTZ n'a pas de mensualité affectant le taux d'endettement ici.
                            // Le montant du PTZ réduit simplement le capital à emprunter via le crédit amortissable principal.
                            // Ici, nous ne calculons pas la mensualité du PTZ séparément, car il est "à taux zéro" et ne pèse pas sur le taux d'endettement.
                            // Sa mensualité est souvent incluse dans la mensualité globale ou remboursée plus tard.
                            // Pour simplifier et éviter de surcharger le calcul d'endettement, nous ne lui attribuons pas de mensualité "limitante" ici.

                            let loan_monthly_max_allowed = max_mens - assurance_monthly;
                            if (loan_monthly_max_allowed < 0) {
                                high = cost;
                                continue;
                            }

                            const loan_amt = monthlyToCapital(loan_monthly_max_allowed, params.base_rate, params.duration_years);
                            const total_cost_with_notary = cost + notary;
                            const total_funded = loan_amt + ptz_amt + al_amt + apport;
                            const gap = total_cost_with_notary - total_funded;

                            if (Math.abs(gap) < 1) { // Tolérance pour la convergence
                                 bestResult = {
                                    nom: label,
                                    mensualite: loan_monthly_max_allowed + assurance_monthly, // Mensualité du crédit amortissable + assurance
                                    ptz: ptz_amt, ptz_monthly: 0, // PTZ n'a pas de mensualité pour le taux d'endettement ici
                                    action_logement: al_amt, action_logement_monthly: al_amt > 0 ? capitalToMonthly(al_amt, 1.0, params.duration_years) : 0, // AL a une mensualité à 1%
                                    assurance_monthly, tva: vat, cout_total: cost,
                                    credit_amortissable: loan_amt, credit_monthly: loan_monthly_max_allowed,
                                    notary, montant_empruntable: loan_amt + ptz_amt + al_amt, apport
                                };
                                break;
                            }

                            if (gap > 0) {
                                high = cost;
                            } else {
                                low = cost;
                                 bestResult = { // Update bestResult even if gap < 0 to get the closest lower bound
                                    nom: label,
                                    mensualite: loan_monthly_max_allowed + assurance_monthly,
                                    ptz: ptz_amt, ptz_monthly: 0,
                                    action_logement: al_amt, action_logement_monthly: al_amt > 0 ? capitalToMonthly(al_amt, 1.0, params.duration_years) : 0,
                                    assurance_monthly, tva: vat, cout_total: cost,
                                    credit_amortissable: loan_amt, credit_monthly: loan_monthly_max_allowed,
                                    notary, montant_empruntable: loan_amt + ptz_amt + al_amt, apport
                                };
                            }
                        }
                        if (bestResult.montant_empruntable > 0) {
                            results.push(bestResult);
                        }
                    }
                }
            }
        }
        return results;
    }

    // --- GESTION DE L'INTERFACE ---

    function updateCommunes() {
        const dept = DOMElements.deptSelect.value;
        const communes = Object.keys(zonageData.communes?.[dept] || {}).sort((a,b) => a.localeCompare(b));
        DOMElements.communeSelect.innerHTML = communes.map(c => `<option value="${c}">${c}</option>`).join('');
        // Sélectionner la première commune par défaut si la liste n'est pas vide
        if (DOMElements.communeSelect.options.length > 0) {
            DOMElements.communeSelect.selectedIndex = 0;
        }
    }

    function toggleNewBuildOptions() {
        if (DOMElements.newBuildCheckbox.checked) {
            DOMElements.newBuildOptionsDiv.style.display = 'block';
        } else {
            DOMElements.newBuildOptionsDiv.style.display = 'none';
        }
    }

    async function initialize() {
        try {
            const response = await fetch('zonage_ptz.json');
            zonageData = await response.json();
            
            // Tri des départements par numéro (code) au lieu du nom
            const depts = Object.keys(zonageData.departements).sort((a, b) => {
                // Gérer les codes alpha-numériques comme '2A', '2B' pour la Corse
                const numA = parseInt(a);
                const numB = parseInt(b);

                if (isNaN(numA) || isNaN(numB)) { // Pour les codes comme 2A, 2B (e.g., Corse)
                    return a.localeCompare(b);
                }
                return numA - numB;
            });

            DOMElements.deptSelect.innerHTML = depts.map(d => `<option value="${d}">${d} - ${zonageData.departements[d]}</option>`).join('');
            
            // Initialisation des valeurs par défaut après le remplissage des options
            if (DOMElements.deptSelect.options.length > 0) {
                DOMElements.deptSelect.value = "75"; // Définit Paris comme département par défaut
            }
            updateCommunes(); // Met à jour les communes pour le département 75
            // La commune "Paris" devrait être sélectionnée par défaut si elle existe
            if(DOMElements.communeSelect.options.length > 0 && Array.from(DOMElements.communeSelect.options).some(opt => opt.value === "Paris")) {
               DOMElements.communeSelect.value = "Paris";
            }

        } catch (error) {
            console.error("Erreur de chargement du fichier de zonage:", error);
            DOMElements.resultsContainer.innerHTML = "<p>Erreur: Impossible de charger les données de zonage.</p>";
        }

        DOMElements.deptSelect.addEventListener('change', updateCommunes);
        DOMElements.newBuildCheckbox.addEventListener('change', toggleNewBuildOptions); // Écouteur pour le checkbox "Bien neuf"
        DOMElements.runBtn.addEventListener('click', runSimulation);
        DOMElements.saveBtn.addEventListener('click', saveClient);
        DOMElements.loadBtn.addEventListener('change', loadClient);

        // Initialiser l'état des options "Appartement/Maison" au chargement
        toggleNewBuildOptions();
    }
    
    function runSimulation() {
        // Appliquer les pourcentages aux revenus immobiliers et financiers
        const salaire = parseFloat(DOMElements.inputs.salaire.value) || 0;
        const immobilier_rev = (parseFloat(DOMElements.inputs.immobilier.value) || 0) * (parseFloat(DOMElements.inputs.pct_immobilier.value) || 0) / 100;
        const financier_rev = (parseFloat(DOMElements.inputs.financier.value) || 0) * (parseFloat(DOMElements.inputs.pct_financier.value) || 0) / 100;

        const income = salaire + immobilier_rev + financier_rev;
        const charges = parseFloat(DOMElements.inputs.conso.value) + parseFloat(DOMElements.inputs.immobilier_credit.value) + parseFloat(DOMElements.inputs.leasing.value);
        const zone = determineZone(DOMElements.deptSelect.value, DOMElements.communeSelect.value);

        // Récupérer le type de bien sélectionné
        const selectedTypeBien = DOMElements.newBuildCheckbox.checked ? 
                                 document.querySelector('input[name="type_bien"]:checked').value : null;

        const params = {
            income, charges, zone,
            rfr_n2: parseFloat(DOMElements.inputs.rfr_n2.value) || 0, // Nouveau
            nb_persons: parseInt(DOMElements.inputs.nb_personnes.value) || 1, // Assurez-vous d'avoir au moins 1 personne
            debt_ratio: parseFloat(DOMElements.inputs.taux_endettement.value),
            liquidity: parseFloat(DOMElements.inputs.liquidites.value),
            base_rate: parseFloat(DOMElements.inputs.taux_interet.value),
            assurance_rate: parseFloat(DOMElements.inputs.taux_assurance.value),
            duration_years: parseInt(DOMElements.inputs.duree.value),
            fiscal_parts: parseFloat(DOMElements.inputs.parts_fiscales.value),
            is_new_build: DOMElements.inputs.is_new_build.checked,
            type_bien: selectedTypeBien, // Nouveau
            test_reduced_vat: DOMElements.inputs.tva_reduite.checked,
            include_notary: DOMElements.inputs.include_notaire.checked
        };
        
        const results = simulate(params);
        displayResults(results);
        plotGraph(results);
    }

    function displayResults(results) {
        DOMElements.resultsContainer.innerHTML = '';
        if (results.length === 0) {
            DOMElements.resultsContainer.innerHTML = '<p class="placeholder">Aucun scénario n\'a pu être calculé avec ces paramètres.</p>';
            return;
        }

        const formatCurrency = (val) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

        results.sort((a,b) => b.montant_empruntable - a.montant_empruntable).forEach(res => {
            const card = document.createElement('div');
            card.className = 'result-card';
            if (res.tva < 20) card.classList.add('tva-reduite');
            
            card.innerHTML = `
                <h3>${res.nom}</h3>
                <p><strong>Capacité d'emprunt : ${formatCurrency(res.montant_empruntable)}</strong></p>
                <p>Mensualité totale : ${formatCurrency(res.mensualite)}</p>
                <hr>
                <p>Crédit principal : ${formatCurrency(res.credit_amortissable)} (${formatCurrency(res.credit_monthly)}/mois)</p>
                <p>PTZ : ${formatCurrency(res.ptz)}</p>
                <p>Action Logement : ${formatCurrency(res.action_logement)}</p>
                <p>Assurance : ${formatCurrency(res.assurance_monthly)}/mois</p>
                <p>Apport personnel : ${formatCurrency(res.apport)}</p>
                <p>Frais de notaire estimés : ${formatCurrency(res.notary)}</p>
                <p><strong>Coût total du bien : ${formatCurrency(res.cout_total)}</strong></p>
            `;
            DOMElements.resultsContainer.appendChild(card);
        });
    }

    function plotGraph(results) {
        if (resultsChart) {
            resultsChart.destroy();
        }
        
        const sortedResults = [...results].sort((a, b) => a.montant_empruntable - b.montant_empruntable);

        // Trouver le montant le plus élevé pour la couleur verte
        let maxAmount = 0;
        if (sortedResults.length > 0) {
            maxAmount = Math.max(...sortedResults.map(r => r.montant_empruntable));
        }

        const backgroundColors = sortedResults.map(r => {
            if (r.montant_empruntable === maxAmount && maxAmount > 0) {
                return 'rgba(0, 128, 0, 0.7)'; // Vert pour le plus haut montant
            } else if (r.tva < 20) {
                return 'rgba(225, 0, 15, 0.7)'; // Rouge pour TVA réduite
            } else {
                return 'rgba(0, 90, 156, 0.7)'; // Bleu par défaut
            }
        });

        const borderColors = sortedResults.map(r => {
            if (r.montant_empruntable === maxAmount && maxAmount > 0) {
                return 'rgb(0, 128, 0)';
            } else if (r.tva < 20) {
                return 'rgb(225, 0, 15)';
            } else {
                return 'rgb(0, 90, 156)';
            }
        });


        const data = {
            labels: sortedResults.map(r => r.nom),
            datasets: [{
                label: 'Montant Empruntable',
                data: sortedResults.map(r => r.montant_empruntable),
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1
            }]
        };

        resultsChart = new Chart(DOMElements.chartCanvas, {
            type: 'bar',
            data: data,
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Empruntable : ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(context.raw)}`;
                            }
                        }
                    },
                    datalabels: { // Configuration du plugin DataLabels
                        anchor: 'end',
                        align: 'end',
                        formatter: (value) => {
                            return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
                        },
                        color: 'black',
                        font: {
                            weight: 'bold'
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Montant Empruntable (€)'
                        },
                        beginAtZero: true
                    }
                }
            },
            plugins: [ChartDataLabels] // Enregistrement du plugin
        });
    }

    function saveClient() {
        const dataToSave = {};
        for (const key in DOMElements.inputs) {
            const el = DOMElements.inputs[key];
            dataToSave[key] = el.type === 'checkbox' ? el.checked : el.value;
        }
        dataToSave.departement = DOMElements.deptSelect.value;
        dataToSave.commune = DOMElements.communeSelect.value;
        
        // Sauvegarder l'état du type de bien sélectionné
        const selectedTypeBienRadio = document.querySelector('input[name="type_bien"]:checked');
        if (selectedTypeBienRadio) {
            dataToSave.type_bien = selectedTypeBienRadio.value;
        } else {
            dataToSave.type_bien = null;
        }

        const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `client_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    function loadClient(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = JSON.parse(e.target.result);
            let loadedDept = null;
            let loadedCommune = null;
            let loadedTypeBien = null;

            for (const key in data) {
                 if (key === 'departement') {
                    loadedDept = data[key];
                } else if (key === 'commune') {
                    loadedCommune = data[key];
                } else if (key === 'type_bien') { // Charger le type de bien
                    loadedTypeBien = data[key];
                }
                else if (DOMElements.inputs[key]) {
                    const el = DOMElements.inputs[key];
                    if (el.type === 'checkbox') {
                        el.checked = data[key];
                    } else {
                        el.value = data[key];
                    }
                }
            }

            // Set department and then update communes
            if (loadedDept) {
                DOMElements.deptSelect.value = loadedDept;
                updateCommunes(); // This will populate the commune dropdown
                // Now, try to set the commune after a small delay to ensure options are rendered
                setTimeout(() => {
                    if (loadedCommune) {
                        DOMElements.communeSelect.value = loadedCommune;
                    }
                    // Après avoir chargé le département/commune, on gère l'affichage du type de bien
                    toggleNewBuildOptions(); 
                    if (loadedTypeBien) {
                        const radioToSelect = document.querySelector(`input[name="type_bien"][value="${loadedTypeBien}"]`);
                        if (radioToSelect) {
                            radioToSelect.checked = true;
                        }
                    }
                }, 100); 
            } else { // Fallback if department is not in the saved data or if it's the initial load state
                toggleNewBuildOptions(); // Just ensure visibility is correct
                if (loadedTypeBien) {
                    const radioToSelect = document.querySelector(`input[name="type_bien"][value="${loadedTypeBien}"]`);
                    if (radioToSelect) {
                        radioToSelect.checked = true;
                    }
                }
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Permet de recharger le même fichier
    }

    initialize();
});