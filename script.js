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

        // Nouveaux éléments pour le type de bien
        propertyTypeRadios: document.querySelectorAll('input[name="property_type"]'),
        
        // Options spécifiques "Bien neuf"
        newBuildOptionsDiv: document.getElementById('new-build-options'),
        typeBienRadios: document.querySelectorAll('input[name="type_bien"]'),
        notaryOptionsDiv: document.getElementById('notary-options'),
        notaryTypeRadios: document.querySelectorAll('input[name="notary_type"]'),
        tvaReduiteLabel: document.getElementById('tva-reduite-label'), // Label complet pour cacher/montrer

        // Nouveaux éléments spécifiques "Bien ancien"
        oldBuildOptionsDiv: document.getElementById('old-build-options'),
        hasWorksCheckbox: document.getElementById('has_works'),
        workCostGroup: document.getElementById('work-cost-group'),
        
        inputs: {
            salaire: document.getElementById('salaire'),
            immobilier: document.getElementById('immobilier'),
            pct_immobilier: document.getElementById('pct_immobilier'),
            financier: document.getElementById('financier'),
            pct_financier: document.getElementById('pct_financier'),
            rfr_n2: document.getElementById('rfr_n2'),
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
            tva_reduite: document.getElementById('tva_reduite'), // Checkbox itself
            work_cost: document.getElementById('work_cost') // Nouveau input
        }
    };

    let zonageData = {};
    let resultsChart = null;

    // --- PLAFONDS PTZ ET ACTION LOGEMENT (RFR N-2) ---
    const PTZ_RFR_THRESHOLDS = {
        "A":    [49000, 68600, 88200, 102900, 117600, 132300, 147000, 161700],
        "A bis": [49000, 68600, 88200, 102900, 117600, 132300, 147000, 161700],
        "B1":   [34500, 48300, 62100, 72450, 82800, 93150, 103500, 113850],
        "B2":   [31500, 44100, 56700, 66150, 75600, 85050, 94500, 103950],
        "C":    [28500, 39900, 51300, 59850, 68400, 76950, 85500, 94050]
    };

    const ACTION_LOGEMENT_RFR_THRESHOLDS = {
        "A bis": [43953, 65691, 86112, 102812, 122326, 137649],
        "A":     [43953, 65691, 78963, 94585, 111971, 126001],
        "B1":    [35825, 47842, 57531, 69455, 81705, 92080],
        "B2":    [32243, 43056, 51778, 62510, 73535, 82873],
        "C":     [32243, 43056, 51778, 62510, 73535, 82873]
    };
    const ACTION_LOGEMENT_ADDITIONAL_PERSON_THRESHOLD = {
        "A bis": 15335, "A": 14039, "B1": 10273, "B2": 9243, "C": 9243
    };

    // --- LOGIQUE DE CALCUL ---

    function determineZone(dept, commune) {
        return zonageData.communes?.[dept]?.[commune] || 'C';
    }

    function isPtzEligible(rfr, nbPersons, zone) {
        const index = Math.min(nbPersons - 1, 7);
        const threshold = PTZ_RFR_THRESHOLDS[zone]?.[index];
        return rfr <= threshold;
    }

    function calculatePtzMaxAmount(rfr, nbPersons, zone, operationCost, typeBien) {
        if (!isPtzEligible(rfr, nbPersons, zone)) {
            return 0;
        }
        
        let ptz_max_base = operationCost * 0.4; // 40% du coût total de l'opération

        // Plafonnement spécifique pour appartement/maison
        if (typeBien === 'appartement') {
            ptz_max_base = Math.min(ptz_max_base, operationCost * 0.5); // 50% du prix de l'appartement
        } else if (typeBien === 'maison') {
            ptz_max_base = Math.min(ptz_max_base, operationCost * 0.3); // 30% du prix de la maison
        }
        
        // Le PTZ est également plafonné par des montants fixes selon la zone et le nombre de personnes.
        const plafondsPtzOperation = { "A": 150000, "B1": 135000, "B2": 120000, "C": 100000 };
        ptz_max_base = Math.min(ptz_max_base, plafondsPtzOperation[zone] || 100000);

        return Math.floor(ptz_max_base);
    }

    function isActionLogementEligible(rfr, nbPersons, zone) {
        let effectiveZone = zone;
        if (zone === "C") effectiveZone = "B2"; // Action Logement n'a pas de zone C distincte pour les plafonds

        const baseThresholds = ACTION_LOGEMENT_RFR_THRESHOLDS[effectiveZone];
        if (!baseThresholds) return false;

        let threshold;
        if (nbPersons >= 1 && nbPersons <= 6) {
            threshold = baseThresholds[nbPersons - 1];
        } else if (nbPersons > 6) {
            const additionalPersons = nbPersons - 6;
            threshold = baseThresholds[5] + (additionalPersons * ACTION_LOGEMENT_ADDITIONAL_PERSON_THRESHOLD[effectiveZone]);
        } else {
            return false;
        }
        return rfr <= threshold;
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
        // VAT rate now depends on property_type
        const vatRates = (params.property_type === 'neuf' && params.test_reduced_vat) ? [5.5] : [20.0];

        const scenarios = [
            { id: 'CA', label: 'Crédit Amortissable seul', usePtz: false, useAL: false },
            { id: 'CA+PTZ', label: 'Crédit Amortissable + PTZ', usePtz: true, useAL: false },
            { id: 'CA+AL', label: 'Crédit Amortissable + Action Logement', usePtz: false, useAL: true },
            { id: 'CA+PTZ+AL', label: 'Crédit Amortissable + PTZ + Action Logement', usePtz: true, useAL: true }
        ];

        const hasExistingCharges = params.charges > 0;
        const hasLiquidity = params.liquidity > 0;

        const use_charges_options = hasExistingCharges ? [true, false] : [false];
        const with_apport_options = hasLiquidity ? [true, false] : [false];

        // Déterminer l'éligibilité réelle à Action Logement (PTZ est plus complexe, voir ci-dessous)
        const al_is_eligible_by_rfr = isActionLogementEligible(params.rfr_n2, params.nb_persons, params.zone);

        for (const vat of vatRates) {
            for (const use_charges of use_charges_options) {
                for (const with_apport of with_apport_options) {
                    
                    for (const scenario of scenarios) {
                        // Action Logement est possible pour tous types si éligible RFR
                        if (scenario.useAL && !al_is_eligible_by_rfr) continue;

                        let label = scenario.label;
                        label += vat === 5.5 ? ' (TVA réduite)' : ' (TVA 20%)';
                        label += use_charges ? ' (avec ch. exist.)' : ' (sans ch. exist.)';
                        label += with_apport ? ' (avec apport)' : ' (sans apport)';

                        const max_mens = maxMensualite(params.income, params.charges, params.debt_ratio, use_charges);
                        if (max_mens <= 0) continue;

                        let low = 50000, high = 2000000;
                        let bestResult = { montant_empruntable: 0, cout_total: 0, ptz: 0 }; // Initialize ptz here
                        
                        for (let i = 0; i < 100; i++) { // Binary search for optimal 'cost'
                            const cost = (low + high) / 2;
                            
                            // --- CALCUL DES FRAIS DE NOTAIRE ---
                            let notary_fee_rate = 0;
                            if (params.property_type === 'neuf') {
                                if (params.notary_type === 'none') {
                                    notary_fee_rate = 0;
                                } else if (params.notary_type === 'reduced') {
                                    notary_fee_rate = 0.025; // Environ 2.5% pour le neuf
                                }
                            } else if (params.property_type === 'recent') {
                                notary_fee_rate = 0.04; // 4% pour le récent
                            } else if (params.property_type === 'ancien') {
                                notary_fee_rate = 0.08; // 8% pour l'ancien
                            }
                            const notary = cost * notary_fee_rate;

                            // --- CALCUL DU PTZ ---
                            let ptz_amt = 0;
                            if (scenario.usePtz) { // Si le current scénario est censé inclure le PTZ
                                const ptz_eligible_rfr_zone = isPtzEligible(params.rfr_n2, params.nb_persons, params.zone);

                                if (params.property_type === 'neuf' && ptz_eligible_rfr_zone) {
                                    ptz_amt = calculatePtzMaxAmount(params.rfr_n2, params.nb_persons, params.zone, cost, params.type_bien);
                                } else if (params.property_type === 'ancien' && params.has_works && ptz_eligible_rfr_zone) {
                                    // PTZ for l'ancien with works if > 25% of total cost and zone B2 or C
                                    if ((params.work_cost / cost > 0.25) && (params.zone === 'B2' || params.zone === 'C')) {
                                        ptz_amt = calculatePtzMaxAmount(params.rfr_n2, params.nb_persons, params.zone, cost, 'appartement');
                                    }
                                }
                            }
                            
                            // --- CALCUL ACTION LOGEMENT ---
                            const al_amt = scenario.useAL && al_is_eligible_by_rfr ? calculateActionLogementMax(al_is_eligible_by_rfr) : 0;

                            const assurance_monthly = (cost * params.assurance_rate / 100) / 12;
                            // Apport personnel limité à 10% du coût du bien pour ce simulateur
                            const apport = with_apport ? Math.min(params.liquidity, cost * 0.1) : 0;
                            
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
                                    mensualite: loan_monthly_max_allowed + assurance_monthly,
                                    ptz: ptz_amt, ptz_monthly: 0, // PTZ has no monthly payment
                                    action_logement: al_amt, action_logement_monthly: al_amt > 0 ? capitalToMonthly(al_amt, 1.0, params.duration_years) : 0, // Assuming 1% for Action Logement if it has a payment
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
                                 bestResult = {
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
                        
                        // Exclure le scénario si un PTZ était prévu mais est finalement de 0
                        if (scenario.usePtz && bestResult.ptz === 0) {
                            continue; 
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
        if (DOMElements.communeSelect.options.length > 0) {
            DOMElements.communeSelect.selectedIndex = 0;
        }
    }

    function updateVisibility() {
        const propertyType = document.querySelector('input[name="property_type"]:checked').value;

        // Hide all specific option groups first
        DOMElements.newBuildOptionsDiv.style.display = 'none';
        DOMElements.notaryOptionsDiv.style.display = 'none';
        DOMElements.tvaReduiteLabel.style.display = 'none';
        DOMElements.oldBuildOptionsDiv.style.display = 'none';
        DOMElements.workCostGroup.style.display = 'none';

        if (propertyType === 'neuf') {
            DOMElements.newBuildOptionsDiv.style.display = 'block';
            DOMElements.notaryOptionsDiv.style.display = 'block';
            DOMElements.tvaReduiteLabel.style.display = 'block';
        } else if (propertyType === 'ancien') {
            DOMElements.oldBuildOptionsDiv.style.display = 'block';
            if (DOMElements.hasWorksCheckbox.checked) {
                DOMElements.workCostGroup.style.display = 'block';
            }
        }
        // 'recent' type doesn't have specific sub-options to show/hide here.
    }

    async function initialize() {
        try {
            const response = await fetch('zonage_ptz.json');
            zonageData = await response.json();
            
            const depts = Object.keys(zonageData.departements).sort((a, b) => {
                const numA = parseInt(a);
                const numB = parseInt(b);
                if (isNaN(numA) || isNaN(numB)) {
                    return a.localeCompare(b);
                }
                return numA - numB;
            });

            DOMElements.deptSelect.innerHTML = depts.map(d => `<option value="${d}">${d} - ${zonageData.departements[d]}</option>`).join('');
            
            if (DOMElements.deptSelect.options.length > 0) {
                DOMElements.deptSelect.value = "75";
            }
            updateCommunes();
            if(DOMElements.communeSelect.options.length > 0 && Array.from(DOMElements.communeSelect.options).some(opt => opt.value === "Paris")) {
               DOMElements.communeSelect.value = "Paris";
            }

        } catch (error) {
            console.error("Erreur de chargement du fichier de zonage:", error);
            DOMElements.resultsContainer.innerHTML = "<p>Erreur: Impossible de charger les données de zonage.</p>";
        }

        DOMElements.deptSelect.addEventListener('change', updateCommunes);
        
        // Listen to changes on all property type radios
        DOMElements.propertyTypeRadios.forEach(radio => {
            radio.addEventListener('change', updateVisibility);
        });
        // Listen to changes on has_works checkbox
        DOMElements.hasWorksCheckbox.addEventListener('change', updateVisibility);

        DOMElements.runBtn.addEventListener('click', runSimulation);
        DOMElements.saveBtn.addEventListener('click', saveClient);
        DOMElements.loadBtn.addEventListener('change', loadClient);

        // Initialiser l'état des options au chargement de la page
        updateVisibility();
    }
    
    function runSimulation() {
        const salaire = parseFloat(DOMElements.inputs.salaire.value) || 0;
        const immobilier_rev = (parseFloat(DOMElements.inputs.immobilier.value) || 0) * (parseFloat(DOMElements.inputs.pct_immobilier.value) || 0) / 100;
        const financier_rev = (parseFloat(DOMElements.inputs.financier.value) || 0) * (parseFloat(DOMElements.inputs.pct_financier.value) || 0) / 100;

        const income = salaire + immobilier_rev + financier_rev;
        const charges = parseFloat(DOMElements.inputs.conso.value) + parseFloat(DOMElements.inputs.immobilier_credit.value) + parseFloat(DOMElements.inputs.leasing.value);
        const zone = determineZone(DOMElements.deptSelect.value, DOMElements.communeSelect.value);

        const propertyType = document.querySelector('input[name="property_type"]:checked').value;
        
        let selectedTypeBien = null; // 'appartement' or 'maison' only relevant for 'neuf'
        if (propertyType === 'neuf') {
            selectedTypeBien = document.querySelector('input[name="type_bien"]:checked').value;
        }

        let selectedNotaryType = null; // 'none' or 'reduced' only relevant for 'neuf'
        if (propertyType === 'neuf') {
            selectedNotaryType = document.querySelector('input[name="notary_type"]:checked').value;
        }

        const hasWorks = (propertyType === 'ancien') ? DOMElements.hasWorksCheckbox.checked : false;
        const workCost = hasWorks ? (parseFloat(DOMElements.inputs.work_cost.value) || 0) : 0;


        const params = {
            income, charges, zone,
            rfr_n2: parseFloat(DOMElements.inputs.rfr_n2.value) || 0,
            nb_persons: parseInt(DOMElements.inputs.nb_personnes.value) || 1,
            debt_ratio: parseFloat(DOMElements.inputs.taux_endettement.value),
            liquidity: parseFloat(DOMElements.inputs.liquidites.value),
            base_rate: parseFloat(DOMElements.inputs.taux_interet.value),
            assurance_rate: parseFloat(DOMElements.inputs.taux_assurance.value),
            duration_years: parseInt(DOMElements.inputs.duree.value),
            fiscal_parts: parseFloat(DOMElements.inputs.parts_fiscales.value),
            
            property_type: propertyType, // Nouveau paramètre principal
            type_bien: selectedTypeBien, // Pour neuf (appartement/maison)
            notary_type: selectedNotaryType, // Pour neuf (none/reduced)
            has_works: hasWorks, // Pour ancien (avec/sans travaux)
            work_cost: workCost, // Pour ancien (coût des travaux)

            test_reduced_vat: DOMElements.inputs.tva_reduite.checked
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

        let maxAmount = 0;
        if (sortedResults.length > 0) {
            maxAmount = Math.max(...sortedResults.map(r => r.montant_empruntable));
        }

        const backgroundColors = sortedResults.map(r => {
            if (r.montant_empruntable === maxAmount && maxAmount > 0) {
                return 'rgba(0, 128, 0, 0.7)';
            } else if (r.tva < 20) {
                return 'rgba(225, 0, 15, 0.7)';
            } else {
                return 'rgba(0, 90, 156, 0.7)';
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
                    datalabels: {
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
            plugins: [ChartDataLabels]
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
        
        // Save property type radio selection
        dataToSave.property_type = document.querySelector('input[name="property_type"]:checked').value;

        // Save new build specific radios if applicable
        if (dataToSave.property_type === 'neuf') {
            const selectedTypeBienRadio = document.querySelector('input[name="type_bien"]:checked');
            dataToSave.type_bien = selectedTypeBienRadio ? selectedTypeBienRadio.value : null;

            const selectedNotaryTypeRadio = document.querySelector('input[name="notary_type"]:checked');
            dataToSave.notary_type = selectedNotaryTypeRadio ? selectedNotaryTypeRadio.value : null;
        } else {
            dataToSave.type_bien = null;
            dataToSave.notary_type = null;
        }
        
        // has_works and work_cost are already in DOMElements.inputs and handled above for save.

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
            let loadedPropertyType = null;
            let loadedTypeBien = null;
            let loadedNotaryType = null;

            for (const key in data) {
                 if (key === 'departement') {
                    loadedDept = data[key];
                } else if (key === 'commune') {
                    loadedCommune = data[key];
                } else if (key === 'property_type') {
                    loadedPropertyType = data[key];
                } else if (key === 'type_bien') {
                    loadedTypeBien = data[key];
                } else if (key === 'notary_type') {
                    loadedNotaryType = data[key];
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

            if (loadedDept) {
                DOMElements.deptSelect.value = loadedDept;
                updateCommunes();
                setTimeout(() => { // Small delay to ensure communes are loaded
                    if (loadedCommune) {
                        DOMElements.communeSelect.value = loadedCommune;
                    }
                    applyLoadedRadiosAndVisibility(loadedPropertyType, loadedTypeBien, loadedNotaryType);
                }, 100); 
            } else {
                applyLoadedRadiosAndVisibility(loadedPropertyType, loadedTypeBien, loadedNotaryType);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    function applyLoadedRadiosAndVisibility(loadedPropertyType, loadedTypeBien, loadedNotaryType) {
        // Set property type radio
        if (loadedPropertyType) {
            const radio = document.querySelector(`input[name="property_type"][value="${loadedPropertyType}"]`);
            if (radio) radio.checked = true;
        }

        // Update visibility based on loaded property type and other checkboxes
        updateVisibility(); 

        // Set 'type_bien' radio (Appartement/Maison)
        if (loadedTypeBien) {
            const radio = document.querySelector(`input[name="type_bien"][value="${loadedTypeBien}"]`);
            if (radio) radio.checked = true;
        }

        // Set 'notary_type' radio (Pas de frais/Frais réduits)
        if (loadedNotaryType) {
            const radio = document.querySelector(`input[name="notary_type"][value="${loadedNotaryType}"]`);
            if (radio) radio.checked = true;
        }
    }

    initialize();
});