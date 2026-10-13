# Catálogo geográfico de Santa Marta: fuentes, estructura y limitaciones

Consulta realizada el 13 de octubre de 2026. Datos cargados en `server/data/santa-marta.json`.

## División territorial verificada

Santa Marta (Distrito Turístico, Cultural e Histórico) se organiza en **3 localidades**. Cada localidad agrupa
**comunas urbanas** (antiguas comunas 1 a 9) y **corregimientos rurales**. Así lo describen los documentos de la
Alcaldía: los informes de gestión de 2022 y 2023, el PACC y el Plan Distrital de Gestión del Riesgo.

| Localidad | Área urbana | Área rural |
|---|---|---|
| 1 · Cultural Tayrona – San Pedro Alejandrino | Comunas 1, 6 y 9 | Corregimientos Bonda y Guachaca |
| 2 · Histórica – Rodrigo de Bastidas | Comunas 2, 3, 4 y 5 | Corregimiento Taganga |
| 3 · Turística – Perla del Caribe | Comunas 7 y 8 | Corregimiento Minca |

Nombres de las comunas, consistentes en varias fuentes; la numeración coincide con la del ICBF:
1 María Eugenia – Pando · 2 Central · 3 Pescaíto · 4 Polideportivo – El Jardín · 5 Santafé – Bastidas ·
6 Mamatoco – 11 de Noviembre · 7 Gaira – Rodadero · 8 Pozos Colorados – Don Jaca · 9 Parque – Bureche.

## Diferencia de nomenclatura y estructura adoptada

La división oficial **no es uniformemente "Localidad → Comuna → Barrio"**. La zona rural usa
**corregimientos → veredas**. Para mantener tres niveles compatibles con el sistema, el catálogo usa:

| Nivel | Tipos admitidos |
|---|---|
| 1. Localidad | localidad |
| 2. Comuna | comuna (urbana) o **corregimiento** (rural) |
| 3. Barrio | barrio (urbano) o **vereda** (rural) |

El tipo se guarda en cada registro (`kind`) y la interfaz lo muestra, de modo que no se presenta un corregimiento
como si fuera una comuna.

Gaira: algunas fuentes secundarias la llaman corregimiento, pero los documentos oficiales la sitúan dentro del área
urbana de la Comuna 7. Por eso aparece como barrio "Gaira Centro" de la Comuna 7.

## Barrios: fuentes y limitaciones

- **No existe en línea una fuente oficial única y completa de barrios por comuna** que se pudiera descargar desde
  este entorno, cuya red sólo permite el buscador web y bloquea la descarga directa de santamarta.gov.co e icbf.gov.co.
- Los barrios cargados (114) proceden de:
  - **ICBF**: cobertura publicada de los Centros Zonales Santa Marta 1 y 2, una entidad oficial. Son la mayoría.
  - **Fuente secundaria (SEC)**: blog Hábitat y Cultura y el documento "Comunas Santa Marta". Se identifican en el
    catálogo con `source = SEC` para que un administrador los confirme.
- Se **excluyeron** los barrios que las fuentes asignan a comunas distintas (lista en `excluidos_por_conflicto`),
  para no crear relaciones erróneas: El Trébol, La Lucha/19 de Abril, El Mayor, Luz del Mundo, Salamanca, Santa
  Lucía, Tayrona 1 y 2, César Mendoza, Bella Vista, El Refugio y Santafé.
- **Veredas**: no se cargó ninguna; no se encontró un listado fiable por corregimiento.
- **El catálogo de barrios es parcial.** Santa Marta tiene bastantes más barrios que los cargados.

## Cómo completar o corregir el catálogo

1. *Administración → Catálogo geográfico*: crear, renombrar, mover o desactivar localidades, comunas,
   corregimientos, barrios y veredas.
2. *Importar CSV* (`localidad;comuna;barrio;tipo;fuente`) para cargar un listado oficial completo, por ejemplo de la
   Secretaría de Planeación o la cartografía del POT. La importación no duplica registros: compara nombres
   normalizados dentro del mismo nivel superior.
3. *Ubicaciones por verificar*: revisar los barrios, comunas o localidades que las personas escriben a mano. Desde
   ahí se pueden **agregar al catálogo** (y reasignar a todas las personas con ese mismo texto) o **corregir el
   registro** asignando una ubicación existente.

Fuente oficial recomendada para completar los barrios: Secretaría de Planeación Distrital (cartografía de barrios
del POT 2020-2032) o la Oficina de Participación Ciudadana (Juntas de Acción Comunal por barrio).
