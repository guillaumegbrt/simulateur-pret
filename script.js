document.addEventListener('DOMContentLoaded', () => {
    // Références aux éléments de l'interface (avec les ajouts)
    const DOMElements = {
        runBtn: document.getElementById('run-simulation'),
        saveBtn: document.getElementById('save-client'),
        loadBtn: document.getElementById('load-client-input'),
        deptSelect: document.getElementById('departement'),
        communeSelect: document.getElementById('commune'),
        resultsContainer: document.getElementById('results-container'),
        chartCanvas: document.getElementById('results-chart'),
        inputs: {
            salaire: document.getElementById('salaire'),
            immobilier: document.getElementById('immobilier'),
            pct_immobilier: document.getElementById('pct_immobilier'),
            financier: document.getElementById('financier'),
            pct_financier: document.getElementById('pct_financier'),
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
            ptz_eligible: document.getElementById('ptz_eligible'),
            action_logement: document.getElementById('action_logement'),
            tva_reduite: document.getElementById('tva_reduite'),
            include_notaire: document.getElementById('include_notaire'),
            is_new_build: document.getElementById('is_new_build'),
        }
    };

    let zonageData = {};
    let resultsChart = null;

    // --- LOGIQUE DE CALCUL (Portage de LoanSimulator) ---

    function determineZone(dept, commune) {
        return zonageData.communes?.[dept]?.[commune] || 'C';
    }

    function calculatePtzMax(zone, operationCost) {
        const plafonds = { "A": 150000, "B1": 135000, "B2": 120000, "C": 100000 };
        return Math.min(plafonds[zone] || 100000, 0.4 * operationCost);
    }

    function calculateActionLogementMax(isEligible) {
        return isEligible ? 30000 : 0;
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

        for (const vat of vatRates) {
            for (const use_charges of use_charges_options) {
                for (const with_apport of with_apport_options) {
                    
                    for (const scenario of scenarios) {
                        // Skip scenarios if PTZ or AL are not eligible
                        if (scenario.usePtz && !params.ptz_eligible) continue;
                        if (scenario.useAL && !params.action_logement) continue;

                        let label = scenario.label;
                        label += vat === 5.5 ? ' (TVA réduite)' : ' (TVA 20%)';
                        label += use_charges ? ' (avec ch. exist.)' : ' (sans ch. exist.)';
                        label += with_apport ? ' (avec apport)' : ' (sans apport)';

                        const max_mens = maxMensualite(params.income, params.charges, params.debt_ratio, use_charges);
                        if (max_mens <= 0) continue;

                        let low = 50000, high = 1000000;
                        let bestResult = { montant_empruntable: 0, cout_total: 0 };
                        
                        for (let i = 0; i < 50; i++) { // Augmenter les itérations pour plus de précision
                            const cost = (low + high) / 2;
                            const ptz_amt = scenario.usePtz && params.ptz_eligible ? calculatePtzMax(params.zone, cost) : 0;
                            const al_amt = scenario.useAL && params.action_logement ? calculateActionLogementMax(params.action_logement) : 0;
                            const notary = params.include_notary ? (params.is_new_build ? cost * 0.025 : cost * 0.08) : 0;
                            const assurance_monthly = (cost * params.assurance_rate / 100) / 12;
                            const apport = with_apport ? Math.min(params.liquidity, cost * 0.1) : 0;
                            const ptz_monthly = ptz_amt > 0 ? ptz_amt / (params.duration_years * 12) : 0;
                            const al_monthly = al_amt > 0 ? capitalToMonthly(al_amt, 1.0, params.duration_years) : 0; // Taux AL est fixe à 1%
                            
                            let loan_monthly_max_allowed = max_mens - ptz_monthly - al_monthly - assurance_monthly;
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
                                    mensualite: loan_monthly_max_allowed + ptz_monthly + al_monthly + assurance_monthly,
                                    ptz: ptz_amt, ptz_monthly,
                                    action_logement: al_amt, action_logement_monthly: al_monthly,
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
                                    mensualite: loan_monthly_max_allowed + ptz_monthly + al_monthly + assurance_monthly,
                                    ptz: ptz_amt, ptz_monthly,
                                    action_logement: al_amt, action_logement_monthly: al_monthly,
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
        DOMElements.runBtn.addEventListener('click', runSimulation); // Ligne corrigée
        DOMElements.saveBtn.addEventListener('click', saveClient);
        DOMElements.loadBtn.addEventListener('change', loadClient);
    }
    
    function runSimulation() {
        // Appliquer les pourcentages aux revenus immobiliers et financiers
        const salaire = parseFloat(DOMElements.inputs.salaire.value) || 0;
        const immobilier_rev = (parseFloat(DOMElements.inputs.immobilier.value) || 0) * (parseFloat(DOMElements.inputs.pct_immobilier.value) || 0) / 100;
        const financier_rev = (parseFloat(DOMElements.inputs.financier.value) || 0) * (parseFloat(DOMElements.inputs.pct_financier.value) || 0) / 100;

        const income = salaire + immobilier_rev + financier_rev;
        const charges = parseFloat(DOMElements.inputs.conso.value) + parseFloat(DOMElements.inputs.immobilier_credit.value) + parseFloat(DOMElements.inputs.leasing.value);
        const zone = determineZone(DOMElements.deptSelect.value, DOMElements.communeSelect.value);

        const params = {
            income, charges, zone,
            debt_ratio: parseFloat(DOMElements.inputs.taux_endettement.value),
            liquidity: parseFloat(DOMElements.inputs.liquidites.value),
            base_rate: parseFloat(DOMElements.inputs.taux_interet.value),
            assurance_rate: parseFloat(DOMElements.inputs.taux_assurance.value),
            duration_years: parseInt(DOMElements.inputs.duree.value),
            fiscal_parts: parseFloat(DOMElements.inputs.parts_fiscales.value),
            nb_persons: parseInt(DOMElements.inputs.nb_personnes.value),
            ptz_eligible: DOMElements.inputs.ptz_eligible.checked,
            action_logement: DOMElements.inputs.action_logement.checked,
            is_new_build: DOMElements.inputs.is_new_build.checked,
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

        const formatCurrency = (val) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(val);

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
                <p>PTZ : ${formatCurrency(res.ptz)} (${formatCurrency(res.ptz_monthly)}/mois)</p>
                <p>Action Logement : ${formatCurrency(res.action_logement)} (${formatCurrency(res.action_logement_monthly)}/mois)</p>
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

            for (const key in data) {
                 if (key === 'departement') {
                    loadedDept = data[key];
                } else if (key === 'commune') {
                    loadedCommune = data[key];
                } else if (DOMElements.inputs[key]) {
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
                // This setTimeout is a common workaround for synchronous updates that affect asynchronous rendering.
                setTimeout(() => {
                    if (loadedCommune) {
                        DOMElements.communeSelect.value = loadedCommune;
                    }
                }, 100); 
            } else if (loadedCommune) { // Fallback if department is not in the saved data
                DOMElements.communeSelect.value = loadedCommune;
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Permet de recharger le même fichier
    }

    initialize();
});