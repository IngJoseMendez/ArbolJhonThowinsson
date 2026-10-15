# Estructuras · Plataforma de cabezas, líderes e invitaciones

Plataforma web para gestionar la estructura organizativa de un proyecto mediante **cabezas**, **líderes oficiales**
y **personas**. Permite ver cómo crece cada estructura, a qué cabeza pertenece cada persona, qué líder es su responsable
y quién la invitó directamente.

- **Backend:** Node.js 20+ y Express 5.
- **Base de datos:** PostgreSQL 13 o superior. Recomendado: el Postgres de **Railway**, junto a la aplicación.
- **Frontend:** React 19 + Vite. El árbol se dibuja en SVG propio, con carga progresiva de ramas.
- **Despliegue:** recomendado **Railway** (servidor siempre encendido + Postgres en red privada). También funciona en
  Vercel (sitio estático + función serverless `api/index.js`) con la base de datos en Railway o Neon.
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

## Despliegue recomendado: todo en Railway (aplicación + PostgreSQL)

Es la opción más rápida y fiable para uso real. El servidor está siempre encendido, sin arranques en frío, y habla
con la base de datos por la red privada de Railway (menos de 1 ms por consulta). Además Railway hace copias de
seguridad programadas de Postgres.

1. En Railway: *New Project → Deploy from GitHub repo* y elija este repositorio y la rama. `railway.json` ya
   define la compilación (`npm run build`), el arranque (`npm start`) y el *healthcheck* (`/api/health`).
2. En el mismo proyecto: *+ New → Database → PostgreSQL*.
3. En el servicio de la aplicación, pestaña *Variables*:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia a la URL **privada**, `*.railway.internal`) |
   | `ADMIN_USER` | Usuario del administrador general |
   | `ADMIN_PASSWORD` | Contraseña robusta (obligatoria en producción; nunca se genera una aleatoria) |

4. *Settings → Networking → Generate Domain* para obtener la URL pública (o conecte su dominio).
5. En el servicio **Postgres → Backups**, active copias **diarias y semanales**.
6. Entre en `/login` y cambie la contraseña del administrador.

Las tablas se crean solas en el primer arranque. La conexión por la red privada no usa TLS porque ya va cifrada; las
URL públicas (`*.proxy.rlwy.net`) usan TLS automáticamente.

## Alternativa: Vercel

1. Importe el repositorio en Vercel (*Add New → Project*). `vercel.json` ya define la instalación, la compilación
   (`dist/`) y la función `api/index.js`. En *Settings → Build & Development* deje **Root Directory vacío** (raíz del repositorio). Si el proyecto ya se creó con Root Directory `client`, también funciona: `client/vercel.json` compila desde la raíz y publica la API con `client/api/index.js` (requiere la opción *Include files outside the root directory*, activada por defecto). Un `404` en `/api/...` indica un despliegue anterior a ese archivo o esa opción desactivada.
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

**Vercel con la base de datos en Railway:** en vez del paso 2, cree el Postgres en Railway y, en Vercel, ponga en
`DATABASE_URL` la URL **pública** de Railway (servicio Postgres → *Variables* → `DATABASE_PUBLIC_URL`, host
`*.proxy.rlwy.net`). La privada (`*.railway.internal`) sólo funciona dentro de Railway. Cada consulta cruza de una
nube a otra, por lo que es más lento que tener todo en Railway.

Si prefiere otro proveedor de Postgres (Supabase…), basta con poner su URL en `DATABASE_URL`. La conexión
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
`PHONE_MOBILE_PREFIXES` (por defecto `300-305,310-324,333,350-351`), `EMAIL_DNS_CHECK` (`1`/`0`; activo en producción),
`ADMIN_PASSWORD`, `TRUST_PROXY` (detrás de un proxy inverso propio; en Vercel se activa automáticamente),
`PHONE_COUNTRY_CODE` (por defecto `57`) y `PHONE_NATIONAL_LENGTH` (por defecto `10`). Con estas dos últimas,
`+57 300 123 4567` y `3001234567` se tratan como el mismo número.
En producción (`NODE_ENV=production`, como en Vercel) la cookie de sesión se marca como `Secure`.

## Registro de personas y ubicación (Santa Marta)

El registro manual y el registro por enlace usan **exactamente los mismos campos y validaciones** (`PersonFields`
en el cliente y `validatePersonData` / `resolveLocation` en el servidor):

| Campo | Regla |
|---|---|
| Nombres · Apellidos | Dos campos obligatorios, sólo letras; se capitalizan al salir del campo. Se guardan por separado (`first_names`, `last_names`) y juntos en `full_name` para búsquedas y listados. En registros anteriores, *Editar datos* propone la separación para revisarla |
| Cédula | Obligatoria y única. Acepta cédulas antiguas de 4 a 8 dígitos o el NUIP de 10 dígitos que empieza por 1 (Resolución 3571 de 2003). Rechaza números de relleno (todos iguales o en secuencia). Se muestra con puntos de miles |
| Dirección | Obligatoria |
| Celular / WhatsApp | Obligatorio y único. 10 dígitos con prefijo móvil colombiano (300–305, 310–324, 333, 350–351; configurable con `PHONE_MOBILE_PREFIXES`). Al escribir o pegar se quita `+57` y se formatea `300 555 0123`. En el celular abre el teclado numérico |
| Localidad → Barrio/Vereda | Localidad obligatoria, barrio opcional. El formulario no pide la comuna: el barrio se busca entre todos los de la localidad (cada opción indica su comuna o corregimiento) y la comuna se **deduce** y se guarda, así que los filtros y conteos por comuna siguen funcionando |
| ¿Contamos contigo en este camino? | Sí / No, obligatorio en el registro por enlace (`supports`). Debajo, el eslogan «En tus manos tienes el poder del cambio». Filtro en el directorio y edición en la ficha |

El formulario ya no pide correo. La API sigue aceptándolo (opcional, con validación) y la ficha lo muestra si existe.

Si la ubicación no aparece, la persona elige **«¿Tu localidad no está aquí? Escríbela»** (o «¿Tu barrio no está aquí?
Escríbelo»). Un barrio escrito a mano queda sin comuna; al agregarlo al catálogo el administrador elige su comuna o
corregimiento. El texto se guarda aparte (`geo_*_text`), el registro queda **pendiente de verificación geográfica** y nunca
se crea nada en el catálogo sin revisión. En *Ubicaciones → Por verificar* un administrador agrupa esos textos y decide
entre **agregarlos al catálogo** (sólo el administrador general) o **corregir los registros** asignándoles una ubicación
existente. Cada cambio queda en el historial.

El catálogo inicial (3 localidades, 9 comunas, 4 corregimientos y 114 barrios), sus fuentes y sus limitaciones se
describen en [`docs/geografia-santa-marta.md`](docs/geografia-santa-marta.md). El catálogo de barrios es **parcial**.
Se completa desde *Ubicaciones → Catálogo*, donde se pueden crear, editar, mover y desactivar ubicaciones, o importar un
CSV sin generar duplicados.

Filtros por localidad, comuna y barrio (dependientes y combinables con cabeza, líder, estado y fecha) en el directorio
y en el árbol, con el número de coincidencias. *Ubicaciones → Personas por ubicación* muestra cuántas personas hay en
cada nivel y enlaza a su listado.

## Tipos de registro, enlaces de registro y panel del líder

**Tipos de registro** (*Enlaces → Tipos y colores*): cada tipo tiene nombre y color, y pertenece a **Cabeza**, **Líder**
o **Persona**. Los tres tipos base vienen creados: se puede cambiar su color y su nombre, pero no desactivarlos. El
administrador general crea tipos nuevos, por ejemplo «Voto seguro» (persona), «Líder aspirante» (líder) o «Concejal»
(cabeza). El tipo queda guardado en cada registro: se ve en la ficha y en el directorio, y se puede filtrar.

**Enlaces de registro** (*Enlaces → Nuevo enlace de registro*): el formulario se ve en el celular con el color y el
nombre del tipo, así se sabe qué enlace es. Según el tipo:

| Pertenece a | Quien se registra… | Requiere |
|---|---|---|
| Persona | Queda como persona invitada por quien se indique | Cabeza y persona de la que cuelga |
| Líder | Queda como **líder oficial automáticamente** (código `LID-…`, su enlace para invitar y su panel) | Cabeza; padrino opcional (sin padrino cuelga de la cabeza) |
| Cabeza | Crea una **cabeza nueva** («Concejal Nombre Apellido», con el color del tipo) y queda como su primer líder | Sólo el administrador general; 1 registro por enlace por defecto |

**Enlaces para compartir** (tarjetas de color al inicio de *Enlaces*, con botones de WhatsApp y Copiar):

- **Cabezas y líderes: enlaces de un solo uso.** Cada toque en WhatsApp o Copiar genera un enlace personal y nuevo,
  con un código aleatorio de 12 caracteres. Sirve para un único registro y caduca a los 7 días si no se usa
  (`ONE_TIME_LINK_DAYS`). Si la persona lo reenvía, nadie más puede registrarse con él. El uso se controla en el
  servidor, bloqueando el enlace en la base de datos, así que dos registros simultáneos no pueden pasar ambos.
  Una vez usado, el enlace queda apagado aunque el registro se rechace, y no se puede reactivar ni ampliar. La
  tarjeta muestra los enviados, los usados y los que siguen sin usar, y permite anular los que no se han usado.
- **Personas: enlace general**, reutilizable (uno por cabeza y líder del que cuelgan), pensado para difundirse.
- Los enlaces generales sin límite de cabezas y líderes de versiones anteriores se desactivaron en la migración v7.

Cabeza, padrino y tipo se toman del enlace en el servidor, nunca del formulario. Los enlaces admiten límite de
registros, caducidad y desactivación, como los demás.

**Panel del líder** (`/panel/<enlace secreto>`): de solo lectura y sin usuario ni contraseña. Muestra cuántas personas
hay en su red (directas y por debajo), las altas de los últimos 7 y 30 días, cuántas dijeron «cuenten conmigo», la
lista de su red con los celulares enmascarados y el botón «Comparte tu link para unir más personas».

- Es un enlace **distinto** del de invitación: compartir el enlace de invitación no da acceso al panel.
- Para abrirlo pide los **últimos 4 dígitos de la cédula**. Tras 8 intentos fallidos se bloquea 15 minutos.
- En la base de datos sólo se guarda la huella (sha256) del enlace. Se muestra una vez, al registrarse o al generarlo
  desde la ficha, y no se puede volver a consultar.
- Desde la ficha del líder se ve cuándo lo abrió por última vez. Ahí se puede generar uno nuevo, que invalida el
  anterior, o desactivarlo.

## Expansión del árbol

| Control | Efecto |
|---|---|
| **Expandir nivel** (pastilla `+N` del nodo) | Abre sólo el siguiente nivel |
| **Expandir todo** (botón `⌄⌄` junto al nodo, barra de acciones o panel lateral) | Descarga la rama completa por bloques de 2.000 personas ordenados por ruta y abre **todos** los niveles, incluidos los que nunca se habían abierto. Muestra el progreso y se puede cancelar |
| **Contraer todo** | Cierra todos los niveles de la rama elegida sin tocar las demás |
| Desde la ficha | *Ver rama completa* abre la rama de la persona con todos sus niveles expandidos |

Los nodos sin personas debajo se marcan con un punto gris. Con 20.000 personas expandidas el lienzo sólo dibuja los
nodos visibles en pantalla, y la vista de lista está virtualizada.

**Estado persistente:** las ramas abiertas, el zoom y la posición, la persona seleccionada y los filtros se conservan
al ir a una ficha u otra página y volver (en memoria), y al recargar la pestaña (`sessionStorage`, por usuario; se
borra al cerrar sesión). Al volver, los datos se refrescan en segundo plano sin cerrar ninguna rama.

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
