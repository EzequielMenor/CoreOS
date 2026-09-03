# CoreOS — Guía para agentes de IA

> **Advertencia — Expo SDK 57 cambió la API.**
> Antes de escribir cualquier código, lee la documentación versionada en
> [`https://docs.expo.dev/versions/v57.0.0/`](https://docs.expo.dev/versions/v57.0.0/).
> El proyecto corre **Expo `~57.0.6` / React Native `0.86.0` / React `19.2.3`**.
> Comandos, hooks, plugins y APIs estables en Expo 51–55 pueden no existir aquí.

---

## 1. Resumen del proyecto

**CoreOS** es un *second brain* móvil **single-user, local-first** para el
desarrollador (Ezequiel). Inbox con texto libre → un LLM clasifica →
insert estructurado en SQLite. Sin backend, sin auth, sin multi-tenant.

- **Bundle iOS:** `com.coreos.zettelkasten` · **scheme:** `coreos`
- **Dominio:** gestión personal del conocimiento (estilo zettelkasten) +
  *quantified self* (gastos, tareas, hábitos, sueño).
- **Estado (V1):** 3 tabs (Hoy, Capturar, Biblioteca). Secundarias: `/tareas`,
  `/ajustes`. Captura también por share intent (`capture-share.tsx`).
  *Biblioteca* tiene CRUD + FTS5 + editor Markdown + tags. *Capturar* ejecuta
  el pipeline completo de inbox. *Tareas* tiene CRUD completo en UI.
- **Repo:** **público** ([github.com/EzequielMenor/CoreOS](https://github.com/EzequielMenor/CoreOS)),
  single branch (`main`), sin CI configurada.

---

## 2. Tech stack

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | React Native | `0.86.0` |
| Framework | Expo SDK | `~57.0.8` |
| Router | `expo-router` (file-based) | `~57.0.8` |
| Tabs nativos | `expo-router` `unstable-native-tabs` (`NativeTabs`) | 3 pestañas |
| UI cross-platform | `@expo/ui` | `~57.0.7` |
| Lenguaje | TypeScript (strict) | `~6.0.3` |
| React | React 19 | `19.2.3` |
| Estado | `zustand` | `^5.0.14` |
| DB | `expo-sqlite` (SQLite + FTS5) | `~57.0.1` |
| Iconos | `expo-symbols` (SF Symbols iOS, emoji fallback) | `~57.0.1` |
| Animación | `react-native-reanimated` | `4.5.0` |
| Gestos | `react-native-gesture-handler` | `~2.32.0` |
| Worklets | `react-native-worklets` | `0.10.0` |
| Markdown | `react-native-markdown-display` | `^7.0.2` |
| Toasts | `react-native-toast-message` | `^2.4.0` |
| Almacenamiento seguro | `expo-secure-store` | `~57.0.1` |
| Haptics / efectos | `expo-haptics`, `expo-glass-effect` | `~57.0.1` |
| Pickers | `@react-native-picker/picker` | `2.11.4` |
| Share intent | `expo-sharing` | `~57.0.7` |
| Deeplinks | `expo-linking` | `~57.0.4` |
| Webview | `react-native-webview` | `^14.0.1` |
| Info dispositivo | `expo-device` | `~57.0.1` |
| Constantes Expo | `expo-constants` | `~57.0.3` |
| Web runtime | `react-native-web` | `~0.21.0` |
| Lint | ESLint 9 + `eslint-config-expo` (flat config) | `~57.0.0` / `^9.0.0` |
| Babel | `babel-preset-expo` + `react-native-worklets/plugin` | — |
| Gestor | npm (lockfile `package-lock.json` commiteado) | — |

**Path aliases** (`tsconfig.json`):
- `@/*` → `./src/*`
- `@/assets/*` → `./assets/*`

**Experimentos activos** (`app.json`): `typedRoutes: true`,
`reactCompiler: true`. El compilador experimental puede sorprenderte con hooks.

---

## 3. Arquitectura

### Capas

```
src/app/         ENTRY     — 9 rutas de pantalla, expo-router file-based, 3 NativeTabs
src/stores/      CORE      — Zustand: notes, tags, ui, tareas (gastos/sueno huérfanos, sin UI)
src/components/  INTERNO   — UI compartidos + briefing (Cabecera, TareasPrioritarias)
src/db/          CORE      — singleton SQLite (hotspot, fan-in alto)
src/db/queries/  CORE      — notes, tags, tareas activas (gastos/habitos/sueno sin UI)
src/services/    ENTRY     — cliente LLM, orquestación inbox
src/hooks/       CORE      — useTheme, useColorScheme, useNoteEditor
src/lib/         CORE      — animations (Reanimated + haptics), note-save-gate
src/constants/   CORE      — tokens de tema (read-only)
```

### Flujo de datos — pipeline inbox

```
Entrada libre (texto)
  → tab Capturar / share intent (`capture-share`) / deeplink `coreos://capture`
  → insertInbox(raw_text)                     [db]   persistencia inmediata
  → processPendingInbox()                     [services/inbox.ts, mutex batch]
      → processInboxItem()                    [services/inbox.ts]
          → processInboxText()                [services/llm.ts]   HTTP → MiniMax
      → RouteType { nota | gasto | tarea | habito | sueno }
  → dispatchRoutedResult(type, content, raw_text)  [db/index.tsx ~L656]
      → INSERT en tabla correspondiente
  → Nota: `raw_text` es fuente canónica; captura tipo nota = UNA nota
    con `body_md = raw_text` exacto (LLM solo aporta title/tags).
  → Stores Zustand refrescan en focus
  → Pantalla renderiza vía FlatList / SectionList
```

### Invariantes clave (no negociables)

1. **No backend.** Todo el estado vive en SQLite (`coreos.db`) en disco.
2. **No auth.** Un solo usuario; sus claves viven en `expo-secure-store`.
3. **No hay carpeta `features/`.** La lógica de dominio vive en
   `src/stores/` + `src/db/queries/`.
4. **No NativeWind.** Estilos exclusivamente con `StyleSheet.create` y
   `useTheme()` (ADR-001 implícito).
5. **No `withTransactionAsync` dentro de `dispatchRoutedResult`.** Invariante
   dura documentada como `// I1` en `src/services/inbox.ts`.
6. **I2: UPDATE con guard `WHERE status='pending'` va ANTES que
   `dispatchRoutedResult`.** Sin esto, dos batches concurrentes podrían
   duplicar notas.
7. **I3: Procesamiento de items es secuencial** (`for/await`, nunca
   `Promise.all`). Mantiene orden de captura y evita contention.
8. **I4: Las funciones exportadas de `inbox.ts` nunca lanzan** — siempre
   retornan `ProcessResult` o `BatchResult`. Tragan errores; el caller
   decide reintentar.
9. **Timestamps en `unixepoch()` (segundos)** para `notes.created_at` /
   `notes.updated_at` desde la migración v3 (`v3_notes_ts_seconds`). Las
   tablas `gastos` / `tareas` / `habitos_log` / `sueno_log` / `inbox`
   siguen usando `Date.now()` (ms) — sin normalizar.

---

## 4. Estructura del repo

```
CoreOS/
├── AGENTS.md                    ← este archivo
├── CLAUDE.md                    "@AGENTS.md" — delega aquí
├── README.md                    Scaffold Expo por defecto (sin customizar)
├── app.json                     Config Expo: plugins, typedRoutes, reactCompiler
├── package.json                 Deps + scripts (sin scripts test/typecheck/build)
├── tsconfig.json                Strict TS, path aliases @/*
├── babel.config.js              babel-preset-expo + worklets/plugin
├── eslint.config.js             ESLint 9 flat config (eslint-config-expo)
├── expo-env.d.ts                Tipos auto-generados por Expo
├── assets/                      Splash icon, app icon, favicon, adaptive icons
├── ios/                         Proyecto nativo iOS (gitignored, generado por prebuild)
├── scripts/
│   └── reset-project.js         Reset a scaffold Expo en blanco
├── src/
│   ├── app/                     expo-router: 3 tabs + rutas anidadas
│   ├── components/              Primitivos UI + componentes compuestos
│   ├── constants/               Tokens tema (Colors, Radii, Spacing, Typography)
│   ├── db/
│   │   └── queries/             Módulos de query por dominio
│   ├── hooks/                   useTheme, useColorScheme, useNoteEditor
│   ├── lib/                     animations.ts + note-save-gate
│   ├── services/                llm.ts, inbox.ts
│   └── stores/                  Zustand stores (notes, tags, ui, tareas)
├── docs/
│   └── sdd/                     Spec-Driven Development (ver §6)
│       ├── active/              Fases SDD en curso
│       └── completed/           Fases SDD terminadas
└── repomix-output.xml           Dump completo del repo (~1MB) para contexto IA
```

---

## 5. Rutas y entry points

**Entry module** (`package.json` `"main"`): `expo-router/entry`.

**Root layout:** `src/app/_layout.tsx` → `TabLayout` envuelve la app en
`GestureHandlerRootView` + `SafeAreaProvider` + `ThemeProvider` +
`AnimatedSplashOverlay` + `AppTabs` + `Toast`.

### Mapa de rutas

| Ruta | Archivo | Origen | Tipo |
|------|---------|--------|------|
| `/` | `src/app/(tabs)/index.tsx` | Hoy | Tab |
| `/capturar` | `src/app/(tabs)/capturar.tsx` | Capturar | Tab |
| `/notas` | `src/app/(tabs)/notas/index.tsx` | Biblioteca | Tab |
| `/notas/new` | `src/app/(tabs)/notas/new.tsx` | — | Stack push |
| `/notas/[id]` | `src/app/(tabs)/notas/[id].tsx` | — | Stack |
| `/notas/[id]/edit` | `src/app/(tabs)/notas/[id]/edit.tsx` | — | Stack (oculta) |
| `/tareas` | `src/app/tareas.tsx` | Tareas | Stack (secundaria) |
| `/ajustes` | `src/app/ajustes.tsx` | Ajustes | Stack (secundaria) |
| `/capture-share` | `src/app/capture-share.tsx` | Share intent | Stack (oculta) |

### Tab bar (3 fijas, definidas en `src/components/app-tabs.tsx`)

1. **Hoy** — `house.fill`
2. **Capturar** — `square.and.pencil`
3. **Biblioteca** — `doc.text.fill`

### Servicios

- **`src/services/llm.ts`** — `processInboxText()`. Llama a la API MiniMax
  (compatible OpenAI). Devuelve `{ type: RouteType, content }`.
  Base URL por defecto: `https://api.minimax.io/v1`.
- **`src/services/inbox.ts`** — `processInboxItem()` (un ítem) y
  `processPendingInbox()` (batch con **mutex a nivel de módulo**
  `_batchInFlight`). Pipeline principal.

### DB initialization

`src/db/index.tsx` → `initDb()` crea el esquema legacy y ejecuta
`runMigrations()` para el esquema v1 de notas (FTS5, tags, ideas).

---

## 6. Convenciones

### Idioma

- **Comentarios en código:** español de España, concisos.
- **Identificadores (TS, funciones, variables):** inglés.
- **Cadenas visibles (UI, errores, placeholders):** español.
- **Formato de fechas/números:** locale `es-ES`.

### Naming

- **Componentes:** `kebab-case.tsx` (`themed-text.tsx`, `app-tabs.tsx`).
- **Utilidades:** `camelCase.ts` (`animations.ts`).
- **Pantallas:** el archivo se llama como la ruta (`gastos.tsx`).
- **Rutas:** plural en español (`/notas`, `/gastos`, `/tareas`,
  `/habitos`, `/sueno`, `/ideas`).
- **Funciones:** `camelCase`.
- **Tipos/Interfaces:** `PascalCase` (`NoteRow`, `InboxRow`, `RouteType`).
- **Stores Zustand:** patrón `use<Domain>Store`
  (`useNotesStore`, `useIdeasStore`, `useTagsStore`, `useUiStore`).
- **Tablas DB:** nombres en español (`notes`, `gastos`, `tareas`,
  `habitos_log`, `sueno_log`, `ideas`, `inbox`).

### Estructura

- Un componente por archivo (excepto helpers muy pequeños).
- Pantallas en `src/app/` replicando la ruta.
- Sin barrel exports — imports directos con alias `@/`.
- Tema mediante `useTheme()` → objeto `Colors` (light/dark).

### Formato y lint

- **Formateador:** ESLint (sin Prettier). `eslint-config-expo` flat config.
- **VS Code on save:** `source.fixAll`, `source.organizeImports`,
  `source.sortMembers` (`.vscode/settings.json`).
- **Comando:** `npm run lint` → `expo lint`.
- **Sin prettier, sin stylelint, sin husky.**

### Filosofía — Ponytail mode

El código está anotado con comentarios `// ponytail:` (~40+ sitios) que
marcan simplificaciones deliberadas, techos conocidos y decisiones YAGNI.
**Léelos antes de modificar esa función.** Formato típico:

```
// ponytail: global lock, per-account locks if throughput matters
```

Reglas operativas:

- Sin abstracciones no pedidas: nada de interfaces con una implementación,
  ni factories, ni configs para valores que nunca cambian.
- Borrar > añadir. Aburrido > ingenioso.
- Dif más corto que funcione, gana.
- Cualquier "did X; Y cubre la necesidad. ¿Lo quieres completo? Dilo." —
  no estancar en decisiones resolvibles con defaults.
- Reglas duras (ver §11) **nunca** se simplifican.

### Spec-driven development

Antes de features nuevas, consulta `docs/sdd/active/` para saber si hay
una fase SDD en curso con `design.md` / `spec.md` / `tasks.md`. Las
decisiones arquitectónicas viven ahí o en comentarios `// ponytail:`
— no hay ADRs formales en `codebase-memory`.

---

## 7. Testing

**Estado: SIN INFRAESTRUCTURA.** No hay `jest`, `vitest` ni `detox`
configurados. `package.json` no tiene script `test`. El `README.md`
apunta a la guía oficial de Jest como *opt-in*.

Implicaciones para el agente:

- **No hay regresión automática.** Cualquier cambio queda sin verificar.
- **Si añades cobertura**, usa el preset oficial
  [`jest-preset-expo`](https://docs.expo.dev/versions/v57.0.0/) (Expo 57).
- **Cuidado con el pipeline inbox en tests**: `processPendingInbox()` tiene
  un mutex a nivel de módulo (`_batchInFlight`) que bloquea llamadas
  concurrentes. Cualquier test que dispare batches debe esperar/resetear
  ese lock, o usar directamente `processInboxItem()` por ítem.
- El wrapper de haptics en `src/lib/animations.ts` se diseñó pensando en
  mock futuro — facilita tests sin device real.

---

## 8. Comandos

Desde `package.json`:

| Comando | Qué hace |
|---------|----------|
| `npm install` | Instala dependencias |
| `npm start` · `npx expo start` | Arranca Metro (Expo Go / sim / web) |
| `npm run web` | Arranca con target web |
| `npm run ios` · `npx expo run:ios` | Build + run en simulador iOS |
| `npm run android` · `npx expo run:android` | Build + run en emulador Android |
| `npm run lint` | ESLint vía `expo lint` |
| `npx expo prebuild` | Regenera `ios/` y `android/` |
| `npm run reset-project` | Vuelve al scaffold Expo en blanco |

**Typecheck** (sin script oficial):
`npx tsc --noEmit`

**Sin scripts** de `test`, `build` ni `typecheck` definidos.
Output web es `static` (`app.json`).

---

## 9. Glosario de dominio

| Término | Definición | Dónde vive |
|---------|-----------|-----------|
| **Inbox** | Cola de captura cruda. Texto libre → tabla `inbox` → LLM → dispatch. | `src/db/index.tsx`, `src/services/inbox.ts` |
| **Hoy** | Tab raíz: tareas del día + chip de capturas por clasificar. | `src/app/(tabs)/index.tsx` + `src/components/briefing/` |
| **Capturar** | Tab de captura rápida: textarea única → `insertInbox()` → batch. | `src/app/(tabs)/capturar.tsx` |
| **Biblioteca** | Tab de notas: CRUD + búsqueda FTS5 + filtros tags. | `src/app/(tabs)/notas/`, `src/stores/notes.ts` |
| **capture-share** | Ruta oculta para share intents del SO (`src/app/capture-share.tsx`). | `src/app/capture-share.tsx` |
| **Notas** | Artefacto principal: título + `body_md` + tags. Buscable por FTS5. | `src/db/queries/notes.ts`, `src/stores/notes.ts`, `src/app/(tabs)/notas/` |
| **Gastos** | Gastos: amount, descripción, categoría, fecha. | tabla `gastos`, `src/app/gastos.tsx` (sin UI pública en V1) |
| **Tareas** | Tareas: título, due_date, prioridad, status. | tabla `tareas`, `src/db/queries/tareas.ts`, `src/app/tareas.tsx`, `src/stores/tareas.ts` |
| **Hábitos** | Hábito por día: `habit_name`, status, fecha. | tabla `habitos_log` (sin UI en V1; entra vía LLM) |
| **Sueño** | Registro de sueño: hours, deep_sleep_percentage, quality, fecha. | tabla `sueno_log` (sin UI en V1; entra vía LLM) |
| **Tags** | Etiquetas many-to-many vía `tags` + `note_tags`. Filtrables en lista. | `src/db/queries/tags.ts`, `src/stores/tags.ts` |
| **RouteType** | Output del LLM: `nota` \| `gasto` \| `tarea` \| `habito` \| `sueno`. | `src/services/llm.ts` |
| **dispatchRoutedResult** | INSERT en la tabla correcta. Firma `(type, content, rawText)`. | `src/db/index.tsx:656` |
| **normalizeDueDate** | Parsea `due_date` libre (`hoy`, `mañana`, ISO, d/m/y) → `YYYY-MM-DD`. | `src/db/queries/tareas.ts` |
| **FTS5** | Búsqueda full-text SQLite, tokenizer `porter unicode61`, ranking `bm25`. | tabla `notes_fts` + triggers |
| **MarkdownToolbar** | Toolbar inline del editor (bold, italic, headers, code, link, checklist). | `src/components/MarkdownToolbar.tsx` |
| **AutoSaveDot** | Indicador de guardado: naranja pulsante = dirty, verde estático = saved. | `src/components/AutoSaveDot.tsx` |
| **Ponytail** | Filosofía dev anotada con `// ponytail:` en código — YAGNI con techo. | ~40+ sitios en `src/` |

---

## 10. Configuración y secretos

**No hay `.env`.** El `.gitignore` bloquea `.env*.local` pero no existe
plantilla. **No uses `expo-constants` para secretos**.

### Almacenamiento seguro

Las claves LLM viven en `expo-secure-store` (Keychain iOS /
EncryptedSharedPreferences Android). Keys registrados:

- `llm.baseUrl`
- `llm.apiKey`
- `llm.model`
- `hasOnboarded`

**Default base URL:** `https://api.minimax.io/v1`.
**Default model:** `MiniMax-Text-01`.

> **⚠️ `expo-secure-store` NO está disponible en web.** Cualquier llamada
> a `SecureStore.*` desde el bundle web lanza *"SecureStore no está
> disponible en web"*. El LLM y las features que dependen de claves
> SecureStore **no funcionan en navegador**. Si necesitas que algo corra
> también en web, no uses SecureStore para eso.

### Archivos de config críticos

| Archivo | Propósito |
|---------|-----------|
| `app.json` | Nombre Expo, slug, scheme `coreos`, bundle `com.coreos.zettelkasten`, splash (`#7C5CFF`), plugins (expo-router, expo-sqlite `enableFTS: true`, expo-secure-store, expo-image, expo-status-bar, expo-web-browser), `experiments.typedRoutes`, `experiments.reactCompiler` |
| `tsconfig.json` | Strict mode, `@/*` → `./src/*`, `@/assets/*` → `./assets/*` |
| `babel.config.js` | `babel-preset-expo` + `react-native-worklets/plugin` |
| `src/constants/theme.ts` | Tokens de diseño (Colors light+dark, Radii, Spacing, Typography, Fonts, Shadows) — fuente única de verdad |

### Native modules con caveats

- **Tabs nativos** (`unstable-native-tabs`): solo en simulador/dispositivo
  iOS físico. En Android/web cae a render de tabs alternativo.
- **`react-native-reanimated` 4**: `useAnimatedGestureHandler` está
  **eliminado**. Usa `Gesture.Pan()` de gesture-handler con worklets.
- **`react-compiler`**: experimental. Puede sorprender con hooks.

---

## 11. Reglas duras — MUST NOT

| Regla | Origen |
|-------|--------|
| **No force push a `main`** | `CLAUDE.md` |
| **No secretos hardcoded** | Todas las claves LLM van a `expo-secure-store` |
| **No `rm`** — usa `mavis-trash` (recuperable) | `CLAUDE.md` |
| **No commits con `--no-verify`** | `CLAUDE.md` |
| **No tocar el enrutado de modelos en `settings.json`** sin discusión | `CLAUDE.md` |
| **No añadir NativeWind** | ADR-001 implícito; estilos con `StyleSheet.create` + `useTheme()` |
| **No añadir `react-native-svg`** | ADR-004 implícito; descartado por peso de dep |
| **No añadir backend / auth / Supabase / multi-user** | Decisión de diseño local-first |
| **No crear carpeta `features/`** | Lógica de dominio en `stores/` + `db/queries/` |
| **No usar `withTransactionAsync` dentro de `dispatchRoutedResult`** | Invariante `// I1` en `src/services/inbox.ts` |
| **No añadir tests sin plantear primero la infraestructura** | §7 — sin jest preset configurado |

---

## 12. Landmines conocidas

| # | Trampa | Detalle / mitigación |
|---|--------|----------------------|
| 1 | **Drift de timestamps** | Notas v1: `unixepoch()` (s) tras migración `v3_notes_ts_seconds`. Las tablas `gastos` / `tareas` / `habitos_log` / `sueno_log` / `inbox` siguen en ms (`Date.now()`). Documentado en `src/db/queries/notes.ts:6`. |
| 2 | **SecureStore en web** | `getLLMConfig()` lanza en `SecureStore.*` si la plataforma es web. LLM no usable desde navegador. |
| 3 | **Pantallas básicas** | `habitos.tsx`, `sueno.tsx` son listas con CRUD limitado en UI. El CRUD real entra vía pipeline LLM. `gastos.tsx` y `tareas.tsx` SÍ tienen CRUD completo en UI. |
| 4 | **Sin test infra** | Cualquier cambio queda sin verificar automáticamente. Si añades, usa `jest-preset-expo`. |
| 5 | **Mutex en `processPendingInbox`** | `_batchInFlight` global. Tests que disparen batches deben drainar el lock o usar `processInboxItem()` directo. |
| 6 | **Tabs nativos iOS-only** | `unstable-native-tabs` solo aplica en iOS. Android/web caen a render alternativo. |
| 7 | **`react-native-reanimated` 4 API** | `useAnimatedGestureHandler` eliminado. Usa `Gesture.Pan()` + worklets. |
| 8 | **`react-compiler` experimental** | Hooks pueden comportarse de forma no intuitiva. Si ves algo raro, comprueba que el compilador no esté optimizando mal. |
| 9 | **`NoteSpacing['2xl']`** | Único spacing token nuevo (48px). Notación con bracket por TS. |
| 10 | **Sin scripts `test`/`build`/`typecheck`** | Usa `npx tsc --noEmit` directamente. No hay `npm run build`. |
| 11 | **`react-native-web` ~0.21.0** | Versión mayor del bundler web; algunas APIs nativas no shimmean (ej. SecureStore). |
| 12 | **Repo público: cero secrets** | El repo es público. Todo lo sensible va a `expo-secure-store`. Nunca commitear `.env`, API keys ni dumps con datos personales. |

### Comentarios que merecen respeto

- `// ponytail:` en código → marca simplificación deliberada. Léelo antes de
  "mejorar" esa función.
- `// I1`, `// I2`, `// I3`, `// I4` en `src/services/inbox.ts` → invariantes
  duras. No se negocian.
- Cambia `// ponytail:` por su upgrade path *solo* cuando la métrica que
  nombra (throughput, latencia, etc.) realmente lo justifique.

---

## Fuera de V1

Decisiones tomadas y features conscientemente fuera del alcance actual.
No las implementes sin una fase SDD previa (`docs/sdd/`).

- **UI de gastos / hábitos / sueño.** Las tablas existen y el pipeline LLM
  las rellena; las pantallas públicas están pendientes (datos a salvo).
- **Ideas (artefacto separado).** Eliminado en v3; las ideas legacy se
  copiaron a notas.
- **AI Console / debug de prompts.** No hay UI de inspección de la
  respuesta LLM en V1.
- **Graph / embeddings.** La tabla `note_embeddings` existe en esquema pero
  no hay generación ni consulta. Feature fuera.
- **Hermes vs JSC.** V1 va con el motor por defecto (Hermes en
  release, JSC en dev según Expo).
- **Backend, sync, multi-user.** Decisión de diseño local-first (ver §11).

---

## 13. Mapa de archivos clave

Qualified names para `codebase-memory` (`codebase-memory_search_graph`,
`codebase-memory_trace_path`).

| Qualified name | Archivo | Propósito |
|------|-----------|-----------|
| `CoreOS.src.app._layout.TabLayout` | `src/app/_layout.tsx` | Root layout, init app |
| `CoreOS.src.app.HomeScreen` | `src/app/(tabs)/index.tsx` | Tab "Hoy" (briefing) |
| `CoreOS.src.app.capturar.CapturarScreen` | `src/app/(tabs)/capturar.tsx` | Tab "Capturar" (textarea + batch) |
| `CoreOS.src.app.notas.NotesListScreen` | `src/app/(tabs)/notas/index.tsx` | Tab "Biblioteca" (lista + búsqueda + tags) |
| `CoreOS.src.app.notas.[id].NoteDetailScreen` | `src/app/(tabs)/notas/[id].tsx` | Detalle nota |
| `CoreOS.src.app.notas.new.NewNoteScreen` | `src/app/(tabs)/notas/new.tsx` | Editor nueva nota |
| `CoreOS.src.app.notas.[id].edit.NoteEditorScreen` | `src/app/(tabs)/notas/[id]/edit.tsx` | Editor edición |
| `CoreOS.src.app.tareas.TareasScreen` | `src/app/tareas.tsx` | Lista + CRUD tareas |
| `CoreOS.src.app.ajustes.AjustesScreen` | `src/app/ajustes.tsx` | Ajustes (incluye config LLM) |
| `CoreOS.src.app.capture-share.CaptureShareScreen` | `src/app/capture-share.tsx` | Handler de share intent del SO |
| `CoreOS.src.components.app-tabs.AppTabs` | `src/components/app-tabs.tsx` | NativeTabs bar (3 entradas) |
| `CoreOS.src.db.getDb` | `src/db/index.tsx` | Singleton SQLite (hotspot, fan-in alto) |
| `CoreOS.src.db.initDb` | `src/db/index.tsx` | Init DB + migrations |
| `CoreOS.src.db.dispatchRoutedResult` | `src/db/index.tsx:656` | Dispatcher LLM → INSERT (firma con rawText) |
| `CoreOS.src.db.queries.notes.getSections` | `src/db/queries/notes.ts` | Query compleja notas por sección |
| `CoreOS.src.db.queries.notes.searchNotes` | `src/db/queries/notes.ts` | Búsqueda FTS5 |
| `CoreOS.src.db.queries.tags.listTags` | `src/db/queries/tags.ts` | Listado tags con conteo |
| `CoreOS.src.db.queries.tareas.normalizeDueDate` | `src/db/queries/tareas.ts` | Parser fechas libres → YYYY-MM-DD |
| `CoreOS.src.services.llm.processInboxText` | `src/services/llm.ts` | Llamada API LLM (inyecta fecha local) |
| `CoreOS.src.services.inbox.processInboxItem` | `src/services/inbox.ts` | Pipeline un ítem |
| `CoreOS.src.services.inbox.processPendingInbox` | `src/services/inbox.ts` | Batch con mutex módulo |
| `CoreOS.src.stores.notes.useNotesStore` | `src/stores/notes.ts` | Store Zustand notas |
| `CoreOS.src.stores.tags.useTagsStore` | `src/stores/tags.ts` | Store Zustand tags |
| `CoreOS.src.stores.ui.useUiStore` | `src/stores/ui.ts` | Store UI |
| `CoreOS.src.stores.tareas.useTareasStore` | `src/stores/tareas.ts` | Store Zustand tareas |
| `CoreOS.src.hooks.use-theme.useTheme` | `src/hooks/use-theme.ts` | Tema |
| `CoreOS.src.hooks.useNoteEditor` | `src/hooks/use-note-editor.ts` | Lógica común del editor |
| `CoreOS.src.constants.theme.Colors` | `src/constants/theme.ts` | Tokens tema |
| `CoreOS.src.lib.animations.animations` | `src/lib/animations.ts` | Presets Reanimated + haptics |
| `CoreOS.src.lib.note-save-gate` | `src/lib/note-save-gate.ts` | Guard de guardado del editor |

---

## 14. Procedimiento para agentes

1. Lee este archivo completo.
2. Lee `docs/sdd/active/` — ¿hay una fase SDD en curso para lo que vas a
   tocar? Si la hay, respeta `design.md` y `tasks.md`.
3. Si modificas una función existente, ejecuta
   `codebase-memory_trace_path(project="CoreOS", function_name="…",
   direction="inbound", depth=2)` antes de tocarla.
4. Si necesitas explorar, usa `codebase-memory_search_graph` /
   `codebase-memory_get_architecture` en vez de `grep`/`find` a ciegas.
5. Tras tocar código: `npm run lint` y `npx tsc --noEmit`.
6. **No corras tests** — no hay infra.
7. **No commitees** salvo que te lo pidan explícitamente. El slash
   command `/commit` produce commits conventionals.
8. **No hagas push.** El usuario decide cuándo.
