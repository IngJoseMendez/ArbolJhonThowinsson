// Catálogo geográfico inicial de Santa Marta. Fuentes y limitaciones: docs/geografia-santa-marta.md
// (módulo JS para que el empaquetador de funciones serverless lo incluya siempre).
export default {
  "version": 1,
  "consultado": "2026-10-13",
  "fuentes": {
    "ALC": "Alcaldía de Santa Marta — Informes de gestión 2022 y 2023, PACC y Plan Distrital de Gestión del Riesgo (composición de localidades por comunas y corregimientos)",
    "ICBF": "ICBF — Cobertura publicada de los Centros Zonales Santa Marta 1 y Santa Marta 2 (barrios por comuna)",
    "SEC": "Fuente secundaria (blog Hábitat y Cultura / documento Scribd 'Comunas Santa Marta'); requiere verificación con el POT"
  },
  "localidades": [
    {
      "codigo": "L1",
      "nombre": "Localidad 1",
      "alias": "Cultural Tayrona – San Pedro Alejandrino",
      "fuente": "ALC",
      "unidades": [
        {
          "codigo": "C1",
          "tipo": "comuna",
          "nombre": "Comuna 1",
          "alias": "María Eugenia – Pando",
          "fuente": "ALC",
          "barrios": [
            [
              "1º de Mayo",
              "ICBF"
            ],
            [
              "Acacias",
              "ICBF"
            ],
            [
              "Alto Simón Bolívar",
              "ICBF"
            ],
            [
              "Boulevard de la 19",
              "ICBF"
            ],
            [
              "Corea",
              "ICBF"
            ],
            [
              "Daniel Sánchez",
              "ICBF"
            ],
            [
              "El Piñón I",
              "ICBF"
            ],
            [
              "El Piñón II",
              "ICBF"
            ],
            [
              "Las Américas",
              "ICBF"
            ],
            [
              "Las Colinas del Pando",
              "ICBF"
            ],
            [
              "Loma Fresca",
              "ICBF"
            ],
            [
              "Los Faroles",
              "ICBF"
            ],
            [
              "María Eugenia",
              "ICBF"
            ],
            [
              "Pando",
              "ICBF"
            ],
            [
              "Pando I",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "C6",
          "tipo": "comuna",
          "nombre": "Comuna 6",
          "alias": "Mamatoco – 11 de Noviembre",
          "fuente": "ALC",
          "barrios": [
            [
              "Bolivariana",
              "ICBF"
            ],
            [
              "El Bosque",
              "ICBF"
            ],
            [
              "El Carmen",
              "ICBF"
            ],
            [
              "El Parque",
              "ICBF"
            ],
            [
              "Malvinas",
              "ICBF"
            ],
            [
              "Mamatoco",
              "ICBF"
            ],
            [
              "Once de Noviembre",
              "ICBF"
            ],
            [
              "Rosalía",
              "ICBF"
            ],
            [
              "Timayui I",
              "ICBF"
            ],
            [
              "Timayui II",
              "ICBF"
            ],
            [
              "Timayui III",
              "ICBF"
            ],
            [
              "Yucal 1",
              "ICBF"
            ],
            [
              "Yucal 2",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "C9",
          "tipo": "comuna",
          "nombre": "Comuna 9",
          "alias": "Parque – Bureche",
          "fuente": "ALC",
          "barrios": [
            [
              "Acodis",
              "ICBF"
            ],
            [
              "Altos de Santa Cruz",
              "ICBF"
            ],
            [
              "Andrea Carolina",
              "ICBF"
            ],
            [
              "Santa Cruz",
              "ICBF"
            ],
            [
              "Tamacá",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "R-BONDA",
          "tipo": "corregimiento",
          "nombre": "Bonda",
          "alias": "Corregimiento",
          "fuente": "ALC",
          "barrios": []
        },
        {
          "codigo": "R-GUACHACA",
          "tipo": "corregimiento",
          "nombre": "Guachaca",
          "alias": "Corregimiento",
          "fuente": "ALC",
          "barrios": []
        }
      ]
    },
    {
      "codigo": "L2",
      "nombre": "Localidad 2",
      "alias": "Histórica – Rodrigo de Bastidas",
      "fuente": "ALC",
      "unidades": [
        {
          "codigo": "C2",
          "tipo": "comuna",
          "nombre": "Comuna 2",
          "alias": "Central",
          "fuente": "ALC",
          "barrios": [
            [
              "Alambique",
              "ICBF"
            ],
            [
              "Bavaria",
              "ICBF"
            ],
            [
              "Bellavista",
              "ICBF"
            ],
            [
              "Centro Histórico",
              "ICBF"
            ],
            [
              "El Pueblito",
              "ICBF"
            ],
            [
              "La Gran Vía",
              "ICBF"
            ],
            [
              "La Logia",
              "ICBF"
            ],
            [
              "Minuto de Dios",
              "ICBF"
            ],
            [
              "Miramar",
              "ICBF"
            ],
            [
              "Taminaca 1",
              "ICBF"
            ],
            [
              "Taminaca 2",
              "ICBF"
            ],
            [
              "Tierra Baja",
              "ICBF"
            ],
            [
              "Urbanización Colón",
              "ICBF"
            ],
            [
              "Villa Sara",
              "ICBF"
            ],
            [
              "Bavaria Reservado",
              "SEC"
            ],
            [
              "Bolívar",
              "SEC"
            ],
            [
              "Boston",
              "SEC"
            ],
            [
              "Costa Verde",
              "SEC"
            ],
            [
              "El Prado",
              "SEC"
            ],
            [
              "El Territorial",
              "SEC"
            ],
            [
              "La Esperanza",
              "SEC"
            ],
            [
              "La Tenería",
              "SEC"
            ],
            [
              "Los Ángeles",
              "SEC"
            ],
            [
              "Los Troncos",
              "SEC"
            ],
            [
              "Puerto Mosquito",
              "SEC"
            ],
            [
              "Santa Cecilia",
              "SEC"
            ],
            [
              "Santa Verónica",
              "SEC"
            ],
            [
              "Villa del Rosario",
              "SEC"
            ]
          ]
        },
        {
          "codigo": "C3",
          "tipo": "comuna",
          "nombre": "Comuna 3",
          "alias": "Pescaíto",
          "fuente": "ALC",
          "barrios": [
            [
              "20 de Julio",
              "ICBF"
            ],
            [
              "Alfonso López",
              "ICBF"
            ],
            [
              "Barrio Obrero",
              "ICBF"
            ],
            [
              "Betania",
              "ICBF"
            ],
            [
              "Cristo Rey",
              "ICBF"
            ],
            [
              "Olaya Herrera",
              "ICBF"
            ],
            [
              "San Fernando",
              "ICBF"
            ],
            [
              "San Jorge",
              "ICBF"
            ],
            [
              "San Martín",
              "ICBF"
            ],
            [
              "Santa Mónica",
              "ICBF"
            ],
            [
              "Veracruz",
              "ICBF"
            ],
            [
              "Villa Aurora",
              "ICBF"
            ],
            [
              "El Pradito",
              "SEC"
            ],
            [
              "El Recreo",
              "SEC"
            ],
            [
              "Ensenada Juan XXIII",
              "SEC"
            ],
            [
              "Ensenada Olaya",
              "SEC"
            ],
            [
              "Los Almendros",
              "SEC"
            ],
            [
              "Manguitos",
              "SEC"
            ],
            [
              "Miraflores",
              "SEC"
            ],
            [
              "Norte",
              "SEC"
            ],
            [
              "Pescaíto",
              "SEC"
            ]
          ]
        },
        {
          "codigo": "C4",
          "tipo": "comuna",
          "nombre": "Comuna 4",
          "alias": "Polideportivo – El Jardín",
          "fuente": "ALC",
          "barrios": [
            [
              "Alto Jardín",
              "ICBF"
            ],
            [
              "Andrea Doria",
              "ICBF"
            ],
            [
              "Cundí",
              "ICBF"
            ],
            [
              "Elvira María",
              "ICBF"
            ],
            [
              "Jardín",
              "ICBF"
            ],
            [
              "Juan XXIII",
              "ICBF"
            ],
            [
              "Libertador",
              "ICBF"
            ],
            [
              "Los Alcázares",
              "ICBF"
            ],
            [
              "Los Cocos",
              "ICBF"
            ],
            [
              "Los Naranjos",
              "ICBF"
            ],
            [
              "Mercado Público",
              "ICBF"
            ],
            [
              "Modelo",
              "ICBF"
            ],
            [
              "Nueva Granada",
              "ICBF"
            ],
            [
              "Nuevo Jardín",
              "ICBF"
            ],
            [
              "San Francisco",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "C5",
          "tipo": "comuna",
          "nombre": "Comuna 5",
          "alias": "Santafé – Bastidas",
          "fuente": "ALC",
          "barrios": [
            [
              "Alto Delicias",
              "ICBF"
            ],
            [
              "Bastidas",
              "ICBF"
            ],
            [
              "Belén",
              "ICBF"
            ],
            [
              "Buenos Aires",
              "ICBF"
            ],
            [
              "Galicia",
              "ICBF"
            ],
            [
              "La Estrella",
              "ICBF"
            ],
            [
              "Nueva Galicia",
              "ICBF"
            ],
            [
              "Paraíso",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "R-TAGANGA",
          "tipo": "corregimiento",
          "nombre": "Taganga",
          "alias": "Corregimiento",
          "fuente": "ALC",
          "barrios": []
        }
      ]
    },
    {
      "codigo": "L3",
      "nombre": "Localidad 3",
      "alias": "Turística – Perla del Caribe",
      "fuente": "ALC",
      "unidades": [
        {
          "codigo": "C7",
          "tipo": "comuna",
          "nombre": "Comuna 7",
          "alias": "Gaira – Rodadero",
          "fuente": "ALC",
          "barrios": [
            [
              "Cerro Intermedio",
              "ICBF"
            ],
            [
              "Cerro La Llorona",
              "ICBF"
            ],
            [
              "El Valle de Gaira",
              "ICBF"
            ],
            [
              "Gaira Centro",
              "ICBF"
            ],
            [
              "La Magdalena",
              "ICBF"
            ],
            [
              "Rodadero Tradicional",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "C8",
          "tipo": "comuna",
          "nombre": "Comuna 8",
          "alias": "Pozos Colorados – Don Jaca",
          "fuente": "ALC",
          "barrios": [
            [
              "Bello Sol",
              "ICBF"
            ],
            [
              "Taroa",
              "ICBF"
            ],
            [
              "Vista del Mar",
              "ICBF"
            ]
          ]
        },
        {
          "codigo": "R-MINCA",
          "tipo": "corregimiento",
          "nombre": "Minca",
          "alias": "Corregimiento",
          "fuente": "ALC",
          "barrios": []
        }
      ]
    }
  ],
  "excluidos_por_conflicto": [
    [
      "El Trébol",
      "aparece en Comuna 1 y Comuna 6"
    ],
    [
      "La Lucha / 19 de Abril",
      "aparece en Comuna 1 y Comuna 6"
    ],
    [
      "El Mayor",
      "aparece en Comuna 1 y Comuna 2"
    ],
    [
      "Luz del Mundo",
      "aparece en Comuna 6 y Comuna 9"
    ],
    [
      "Salamanca",
      "aparece en Comuna 4 y Comuna 5"
    ],
    [
      "Santa Lucía",
      "aparece en Comunas 3, 5 y 9"
    ],
    [
      "Tayrona 1 y 2",
      "aparece en Comuna 3 y Comuna 5"
    ],
    [
      "César Mendoza",
      "aparece en Comuna 3 y Comuna 4"
    ],
    [
      "Bella Vista",
      "aparece en Comuna 8 y se confunde con Bellavista (Comuna 2)"
    ],
    [
      "El Refugio",
      "aparece en Comuna 2 (Urbanización El Refugio) y Comuna 6"
    ],
    [
      "Santafé",
      "nombre de barrio en Comuna 3 y nombre de la Comuna 5"
    ]
  ]
};
