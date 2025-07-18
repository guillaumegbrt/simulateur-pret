import pandas as pd
import json
import os

def update_zonage_json(excel_path, json_path):
    """
    Met à jour le fichier zonage_ptz.json avec les données d'un fichier Excel.

    Args:
        excel_path (str): Le chemin vers le fichier Excel (par exemple, 'Zonage_ABC.xlsx').
        json_path (str): Le chemin vers le fichier JSON (par exemple, 'zonage_ptz.json').
    """
    try:
        # Lire le fichier Excel avec le nom de feuille "COG24"
        df = pd.read_excel(excel_path, sheet_name='COG24', engine='openpyxl')
        print(f"Fichier Excel '{excel_path}' lu avec succès sur la feuille 'COG24'.")

        # Dictionnaire pour mapper les numéros de département à leurs noms.
        # Cette liste est assez exhaustive pour la France métropolitaine et les DROM.
        departement_names = {
            '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
            '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
            '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
            '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
            '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud',
            '2B': 'Haute-Corse', '21': 'Côte-d\'Or', '22': 'Côtes-d\'Armor', '23': 'Creuse',
            '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme', '27': 'Eure',
            '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne',
            '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine',
            '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura',
            '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire',
            '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne',
            '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne',
            '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse',
            '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
            '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme',
            '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales',
            '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône',
            '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
            '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines',
            '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
            '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne',
            '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
            '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne',
            '95': 'Val-d\'Oise', '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane',
            '974': 'La Réunion', '976': 'Mayotte'
        }

        new_data = {
            "departements": {},
            "communes": {}
        }

        # Itérer sur les lignes du DataFrame
        # Rappel : Colonne B est l'index 1, Colonne C est l'index 2, Colonne D est l'index 3
        for index, row in df.iterrows():
            try:
                dept_code = str(row[1]).strip()
                commune_name = str(row[2]).strip()
                zone = str(row[3]).strip()

                # Assurez-vous que les codes de département ont 2 ou 3 chiffres (pour les DOM)
                # et gère les cas spéciaux comme 2A/2B pour la Corse.
                if len(dept_code) == 1 and dept_code.isdigit():
                    dept_code = '0' + dept_code
                
                # Ajouter le département et son nom
                if dept_code in departement_names:
                    new_data["departements"][dept_code] = departement_names[dept_code]
                else:
                    print(f"Attention: Le département '{dept_code}' (ligne {index}) n'a pas de nom défini dans le script. Ajouté en utilisant son code.")
                    new_data["departements"][dept_code] = f"Département {dept_code}"

                # Ajouter la commune et sa zone
                if dept_code not in new_data["communes"]:
                    new_data["communes"][dept_code] = {}
                new_data["communes"][dept_code][commune_name] = zone
            except KeyError as ke:
                print(f"Erreur de colonne à la ligne {index}: {ke}. Assurez-vous que les colonnes B, C, D existent et sont bien celles attendues. Ligne ignorée: {row.tolist()}")
            except Exception as e:
                print(f"Erreur inattendue lors du traitement de la ligne {index}: {row.tolist()} - {e}")

        # Charger le JSON existant si il y en a un pour fusionner
        existing_data = {"departements": {}, "communes": {}}
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                try:
                    existing_data = json.load(f)
                    print(f"Fichier JSON existant '{json_path}' lu avec succès.")
                except json.JSONDecodeError:
                    print(f"Avertissement: Le fichier '{json_path}' est vide ou mal formé. Il sera écrasé.")
        
        # Fusionner les données (les nouvelles données de l'Excel écrasent les anciennes pour les mêmes clés)
        merged_data = {
            "departements": {**existing_data.get("departements", {}), **new_data["departements"]},
            "communes": {**existing_data.get("communes", {}), **new_data["communes"]}
        }

        # Écrire les données mises à jour dans le fichier JSON
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(merged_data, f, ensure_ascii=False, indent=2)
        print(f"Fichier '{json_path}' mis à jour avec succès.")

    except FileNotFoundError:
        print(f"Erreur: Le fichier '{excel_path}' n'a pas été trouvé. Veuillez vérifier le chemin.")
    except Exception as e:
        print(f"Une erreur inattendue est survenue: {e}")

# --- Utilisation du script ---
if __name__ == "__main__":
    # >>> IMPORTANT : Remplacez ces chemins par les vôtres <<<
    # Utilisez 'r' devant la chaîne pour les chemins Windows afin d'éviter les erreurs d'échappement.
    # Exemple pour Windows : r'C:\Users\VotreNom\Documents\MonDossier\Zonage ABC juillet 2024.xlsx'
    # Ou utilisez des barres obliques : 'C:/Users/VotreNom/Documents/MonDossier/Zonage ABC juillet 2024.xlsx'
    
    excel_file = r'C:\Users\guillaume.guilbert\OneDrive - PLASTIC OMNIUM\Documents\0-Outils\Python\Simulateur pret\Zonage ABC juillet 2024.xlsx' 
    json_file = r'C:\Users\guillaume.guilbert\OneDrive - PLASTIC OMNIUM\Documents\0-Outils\Python\Simulateur pret\zonage_ptz.json'

    update_zonage_json(excel_file, json_file)