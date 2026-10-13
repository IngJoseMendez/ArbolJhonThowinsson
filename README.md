# Estructuras · Plataforma de cabezas, líderes e invitaciones

Plataforma web para gestionar la estructura organizativa de un proyecto mediante **cabezas**, **líderes oficiales**
y **personas**. Permite ver cómo crece cada estructura, a qué cabeza pertenece cada persona, qué líder es su responsable
y quién la invitó directamente.

- **Backend:** Node.js 20+ y Express 5.
- **Base de datos:** PostgreSQL. En producción se usa **Neon**, integrado desde el Marketplace de Vercel; sirve cualquier Postgres 13 o superior, como Supabase o el Postgres de Railway.
- **Frontend:** React 19 + Vite. El árbol se dibuja en SVG propio, con carga progresiva de ramas.
- **Despliegue:** Vercel. El cliente se publica como sitio estático y la API como función serverless (`api/index.js`).
- **Pruebas:** `node:test` contra PostgreSQL real, que cubre los 14 criterios de aceptación mediante la API HTTP, más una prueba de rendimiento con 20.000 personas.

### Por qué este stack

- **Latencia mínima por consulta.** Neon corre en AWS, igual que las funciones de Vercel. Si ambos están en la misma
  región, cada consulta tarda 1–2 ms de red; una base de datos en otra nube añadiría decenas de milisegundos a cada
  consulta de cada página.
- **El árbol no recuenta ramas.** `child_count` y `descendant_count` se mantienen dentro de la misma transacción que
  cada alta, rechazo o movimiento. Expandir un nodo con miles de personas debajo es una consulta indexada de una
  sola página. *Auditoría → Verificar integridad* recalcula los contadores y los compara con los guardados.
- **Postgres resuelve este modelo de forma nativa:** índices únicos parciales (teléfono único salvo en registros
  rechazados), triggers `plpgsql` como segunda barrera contra ciclos e invitadores de otra cabeza, colación `"C"`
  para los rangos de rutas, y MVCC para que los registros simultáneos no se bloqueen entre sí.

## Despliegue en Vercel

1. Importe el repositorio en Vercel (*Add New → Project*). `vercel.json` ya define la instalación, la compilación
   (`dist/`) y la función `api/index.js`. En *Settings → Build & Development* deje **Root Directory vacío** (raíz del repositorio): si apunta a `client`, Vercel no desplegará la API.
2. En el proyecto, vaya a *Storage → Create Database → Neon (Postgres)*, elija la **misma región** que sus
   funciones (por ejemplo `us-east-1` / `iad1`) y conéctela al proyecto. Vercel añadirá automáticamente
   `DATABASE_URL` (también `POSTGRES_URL`). No hay que crear tablas: el esquema se crea solo en la primera petición.
3. En *Settings → Environment Variables* añada:

   | Variable | Valor |
   |---|---|
   | `ADMIN_USER` | Usuario del administrador general (por ejemplo `admin`) |
   | `ADMIN_PASSWORD` | Contraseña robusta del administrador general |

4. En *Settings → Functions* elija la región de las funciones igual que la de la base de datos.
5. Despliegue (*Redeploy* si las variables se añadieron después). Entre en `https://su-proyecto.vercel.app/login` y
   cambie la contraseña en *Usuarios y roles → Mi contraseña*. El administrador sólo se crea si la base de datos no
   tiene usuarios. En Vercel nunca se genera una contraseña aleatoria ni se escribe en los registros.

Si prefiere otro proveedor de Postgres (Supabase, Railway…), basta con poner su URL en `DATABASE_URL`. La conexión
usa TLS automáticamente cuando el host no es local (`DATABASE_SSL=false` lo desactiva). Elija siempre una región
cercana a la de las funciones de Vercel.

Datos de ejemplo (opcional, **no recomendado en producción**): `DATABASE_URL="…" npm run seed`.

## Puesta en marcha local

Requiere PostgreSQL 13 o superior:

```bash
createdb arbol                                         # o use la URL de Neon
export DATABASE_URL=postgres://usuario:clave@localhost:5432/arbol
npm install            # dependencias del servidor
npm run build          # instala y compila el cliente (dist/)
npm run seed           # datos de ejemplo (sólo si la BD está vacía)
npm start              # http://localhost:3000
```

Usuarios de ejemplo creados por `npm run seed`:

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `Admin1234!` | Administrador general |
| `admin.norte` | `Norte1234!` | Administrador de la Cabeza Norte |
| `admin.sur` | `Sur12345!` | Administrador de la Cabeza Sur |
| `juan` | `Juan1234!` | Líder (Juan Pérez, `LID-JUAN-PEREZ`) |
| `maria` | `Maria1234!` | Persona registrada (María Gómez, no es líder) |

Desarrollo con recarga: `npm run dev:server` y, en otra terminal, `npm run dev:client` (Vite en :5173 con proxy a la API).

Pruebas: necesitan un PostgreSQL en el que el usuario pueda crear bases de datos (`CREATEDB`). Cada archivo de
pruebas crea una base temporal y la elimina al terminar.

```bash
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/postgres npm test
N=20000 npm run seed:large       # genera una cabeza masiva para probar el árbol
```

Variables de entorno: `DATABASE_URL` (o `POSTGRES_URL`), `DATABASE_SSL`, `DB_POOL_SIZE`, `PORT`, `ADMIN_USER`,
`ADMIN_PASSWORD`, `TRUST_PROXY` (detrás de un proxy inverso propio; en Vercel se activa automáticamente),
`PHONE_COUNTRY_CODE` (por defecto `57`) y `PHONE_NATIONAL_LENGTH` (por defecto `10`). Con estas dos últimas,
`+57 300 123 4567` y `3001234567` se tratan como el mismo número.
En producción (`NODE_ENV=production`, como en Vercel) la cookie de sesión se marca como `Secure`.

## Modelo de datos

```
heads ─┐                         users ── user_head_scopes ── heads
       │ head_id (pertenencia)     │ person_id
people ┼─ inviter_id → people  (invitación directa: árbol)
       ├─ leader_id  → people  (responsabilidad organizativa; debe ser líder de la misma cabeza)
       ├─ invite_link_id → invite_links (enlace usado al registrarse)
       └─ registered_by_user_id → users (registro manual)
invite_links (token, kind leader|person, owner_person_id, status, max_uses, expires_at)
person_history (historial funcional por persona)   audit_log (auditoría técnica)   sessions
```

Cada persona tiene: identificador único (`PER-XXXXXX`), nombre y contacto, **cabeza** (`head_id`),
**líder responsable** (`leader_id`, en modo `auto` o `manual`), **invitador directo** (`inviter_id`),
**quién la registró** (`registered_by_user_id`), **método** (`manual` / `invitation`), fecha, **estado**
(`active`, `pending`, `inactive`, `rejected`) e historial.

### Las tres relaciones no se mezclan

1. **Pertenencia** (`head_id`): una sola cabeza por persona. Un trigger impide que el invitador sea de otra cabeza,
   y un índice único parcial (que excluye los registros rechazados) sobre el teléfono y el documento impide que la
   misma persona aparezca registrada en dos cabezas.
2. **Responsabilidad** (`leader_id`): por defecto es el líder oficial más cercano en la cadena de invitación. Un
   administrador puede asignar otro líder de la misma cabeza (`leader_mode = manual`). Al designar o retirar un
   líder, o al mover una rama, se recalculan automáticamente las asignaciones en modo automático, y cada cambio
   queda en el historial.
3. **Invitación directa** (`inviter_id`): es el árbol que se visualiza. Invitar **no** convierte a nadie en líder.
   Solo un administrador puede designar líderes, y únicamente un líder oficial puede tener una cuenta con rol de líder.

### Estrategia de árbol

Se usa un *materialized path*: `path = "/1/5/9/"` (colación `"C"`) junto a `depth`, con un índice `(path, status)`.

- Para obtener una rama completa o su tamaño basta un rango indexado (`path > p AND path < p || '~'`), sin recursión.
- Los ancestros (camino desde la cabeza) se leen directamente de la ruta.
- Los hijos directos se consultan con el índice `(inviter_id, status)` y con paginación.
- Un movimiento de rama reescribe las rutas de todo el subárbol en una sola sentencia, dentro de una transacción.
- Las relaciones circulares se detectan comparando rutas, tanto en el servicio como mediante un trigger.

Los contadores de cada nodo (`child_count`, `descendant_count`) se actualizan en la misma transacción que el cambio
que los afecta, de modo que siempre coinciden con los registros. *Auditoría → Verificar integridad* recorre rutas, profundidades, cabezas, líderes, raíces y
duplicados.

## Enlaces e invitaciones

- **Líder:** el código es fácil de recordar y único (`LID-JUAN-PEREZ`, `LID-JUAN-PEREZ-2` para un homónimo), con el enlace `/registro/LID-JUAN-PEREZ`.
- **Persona:** al activarse recibe una invitación personal con un sufijo aleatorio no adivinable (`/registro/INV-MARIA-GOMEZ-7KQ3`).
  Puede desactivarse por cabeza.
- El servidor deriva la cabeza, el invitador y el líder **exclusivamente del token**. Cualquier `head_id`, `inviter_id`,
  `leader_id`, `is_leader` o `status` que se envíe en la URL o en el cuerpo de la petición se ignora.
- Los enlaces pueden desactivarse (por ejemplo, si están comprometidos), regenerarse, limitarse en número de usos
  o tener fecha de caducidad. Una persona inactiva o un líder retirado invalidan su enlace automáticamente.
- Aprobación opcional por cabeza: los registros por enlace quedan como `pending` hasta que se aprueban
  (sección *Enlaces → Pendientes*).
- El formulario público está pensado para el celular, se comparte por WhatsApp o con `navigator.share`, pide solo
  nombre y teléfono (el municipio y el correo son opcionales) y exige consentimiento con la finalidad explicada.
  Incluye un campo trampa contra bots y un límite de peticiones por IP. Ante un duplicado no revela a quién
  pertenece el dato.

## Roles y permisos (verificados en el servidor)

| Rol | Alcance |
|---|---|
| Administrador general | Todo: cabezas, líderes, personas, enlaces, usuarios, auditoría |
| Administrador de cabeza | Solo las cabezas que tiene asignadas (consulta y gestión) |
| Líder | Consulta su rama de invitación y las personas que tiene asignadas, sin modificar |
| Persona registrada | Su ficha, su rama (contactos de terceros enmascarados) y su invitación personal |

Todas las consultas de personas pasan por `scopeSql()` (`server/permissions.js`), y todas las modificaciones por
`canManagePerson` / `canManageHead`. Un recurso fuera del alcance responde 404, para no revelar que existe.

Otras medidas: contraseñas con `scrypt`, sesión en una cookie `HttpOnly` y `SameSite=Lax` con el token guardado
como hash, verificación de origen en las peticiones que modifican datos, límites de peticiones en el acceso y en el
registro, cabeceras de seguridad, y validación y normalización de todas las entradas. Las acciones sensibles se
registran en `audit_log` y los cambios de cada persona en `person_history`.

## Interfaz

- **Dashboard:** totales, personas por cabeza y por líder, registros recientes con su invitador, y crecimiento
  acumulado por cabeza con tooltip.
- **Cabezas:** creación, edición, archivado y configuración (aprobación, invitaciones personales). La ficha de cada
  cabeza tiene resumen, líderes y árbol, y permite cambiar de cabeza.
- **Líderes:** fichas con código, enlace (copiar, WhatsApp, compartir), personas asignadas, rama y registros por enlace.
- **Árbol:** zoom con rueda o pellizco, desplazamiento, expandir y contraer ramas con la cantidad de personas debajo
  de cada nodo, carga progresiva y paginada (50 hijos por página), dibujo solo de los nodos visibles, búsqueda que
  localiza a la persona y resalta su camino, foco en una rama o líder, filtros por estado y fechas, y una vista
  alternativa de **lista jerárquica virtualizada**.
- **Directorio:** búsqueda, filtros, ordenamiento, paginación y acceso a la ficha o a la posición en el árbol.
- **Ficha:** las tres relaciones por separado, la posición en el árbol, la rama por niveles, a quién ha invitado,
  su enlace, sus datos según permisos, el historial y las acciones autorizadas (designar o retirar liderazgo, cambiar
  el responsable, mover la rama con motivo, activar o desactivar, aprobar o rechazar, crear acceso).
- **Enlaces e invitaciones:** uso de cada enlace, quién lo generó, desactivación, límites y pendientes.
- **Usuarios y roles**, **Auditoría** y verificación de integridad.

## Criterios de aceptación

`tests/acceptance.test.js` comprueba cada criterio contra la API real: varias cabezas con árboles independientes,
alta de líderes, registro manual, cadenas de invitación sin conversión en líder, posición correcta en el árbol,
invitador directo frente a líder responsable, enlaces no manipulables, ausencia de duplicados y ciclos, búsqueda y
localización, permisos por rol, coherencia de los contadores con los registros e historial y auditoría.
`tests/performance.test.js` genera 20.000 personas y comprueba los tiempos de respuesta de la raíz, de los hijos,
de la búsqueda, del camino, de la ficha, del directorio, del dashboard y de la integridad.
