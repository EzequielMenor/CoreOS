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
- **Estado:** MVP+ en desarrollo activo. La pestaña *Notas* tiene CRUD + FTS5
  + editor Markdown + tags. *Ideas* ejecuta el pipeline completo de inbox.
  *Gastos* y *Tareas* tienen CRUD completo en UI. *Hábitos* y *Sueño* están en 
  proceso de añadir su CRUD (actualmente interactivos solo vía pipeline LLM 
  o toggles básicos).
- **Repo:** privado, single branch (`main`), sin CI configurada.

---

## 2. Tech stack

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | React Native | `0.86.0` |
| Framework | Expo SDK | `~57.0.6` |
| Router | `expo-router` (file-based) | `~57.0.6` |
| Tabs nativos | `expo-router` `unstable-native-tabs` (`NativeTabs`) | 7 pestañas |
| UI cross-platform | `@expo/ui` | `~57.0.6` |
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
| Web runtime | `react-native-web` | `~0.21.0` |
| Lint | ESLint 9 + `eslint-config-expo` (flat config) | `~57.0.0` / `^9.0.0` |
| Babel | `babel-preset-expo` + `react-native-worklets/plugin` | — |
| Gestor | npm (sin lockfile comprometido) | — |

**Path aliases** (`tsconfig.json`):
- `@/*` → `./src/*`
- `@/assets/*` → `./assets/*`

**Experimentos activos** (`app.json`): `typedRoutes: true`,
`reactCompiler: true`. El compilador experimental puede sorprenderte con hooks.

---

## 3. Arquitectura

### Capas

```
src/app/         ENTRY     — 11 pantallas, expo-router file-based, 7 NativeTabs
src/stores/      CORE      — 4 stores Zustand (notes, ideas, tags, ui)
src/components/  INTERNO   — 29 componentes UI compartidos
src/db/          CORE      — singleton SQLite (hotspot, fan-in alto)
src/db/queries/  CORE      — módulos de query por dominio (notes, ideas, tags)
src/services/    ENTRY     — cliente LLM, orquestación inbox
src/hooks/       CORE      — useTheme (fan-in 31), useColorScheme
src/lib/         CORE      — presets Reanimated + haptics
src/constants/   CORE      — tokens de tema (read-only)
```

### Flujo de datos — pipeline inbox

```
Entrada libre (texto)
  → CaptureModal / QuickCaptureInput
  → insertInbox(raw_text)                     [db]
  → processPendingInbox()                     [services/inbox.ts, mutex batch]
      → processInboxItem()                    [services/inbox.ts]
          → processInboxText()                [services/llm.ts]   HTTP → MiniMax
      → RouteType { nota | gasto | tarea | habito | sueno }
  → dispatchRoutedResult(type, content)       [db/index.tsx 436-537]
      → INSERT en tabla correspondiente
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
6. **Timestamps en `unixepoch()` (segundos)** para el esquema v1 de notas.
   Las notas *legacy* del dispatcher usan `Date.now()` (ms) — hay drift
   conocido (ver §12).

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
│   ├── app/                     expo-router: 7 tabs + rutas anidadas
│   ├── components/              Primitivos UI + componentes compuestos
│   ├── constants/               Tokens tema (Colors, Radii, Spacing, Typography)
│   ├── db/
│   │   └── queries/             Módulos de query por dominio
│   ├── hooks/                   useTheme, useColorScheme
│   ├── lib/                     animations.ts + haptics
│   ├── services/                llm.ts, inbox.ts
│   └── stores/                  Zustand stores (notes, ideas, tags, ui)
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
| `/` | `src/app/index.tsx` | Hub | Tab |
| `/notas` | `src/app/notas/index.tsx` | Notas | Tab |
| `/notas/new` | `src/app/notas/new.tsx` | — | Stack push |
| `/notas/[id]` | `src/app/notas/[id].tsx` | — | Stack |
| `/notas/[id]/edit` | `src/app/notas/[id]/edit.tsx` | — | Stack (oculta) |
| `/ideas` | `src/app/ideas/index.tsx` | (push desde Hub) | Stack |
| `/tareas` | `src/app/tareas.tsx` | Tareas | Tab |
| `/gastos` | `src/app/gastos.tsx` | Gastos | Tab |
| `/habitos` | `src/app/habitos.tsx` | Hábitos | Tab |
| `/sueno` | `src/app/sueno.tsx` | Sueño | Tab |
| `/ajustes` | `src/app/ajustes.tsx` | Ajustes | Tab |

### Tab bar (7 fijas, definidas en `src/components/app-tabs.tsx`)

1. **Home** — `house.fill`
2. **Notas** — `doc.text.fill`
3. **Tareas** — `checkmark.circle.fill`
4. **Gastos** — `eurosign.circle.fill`
5. **Hábitos** — `flame.fill`
6. **Sueño** — `moon.zzz.fill`
7. **Ajustes** — `gearshape.fill`

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
| **Notas** | Artefacto principal: título + `body_md` + tags. Buscable por FTS5. | `src/db/queries/notes.ts`, `src/stores/notes.ts`, `src/app/notas/` |
| **Ideas** | Snippets de 3 estados: `inbox` → `processed` (nota) o `discarded`. | `src/db/queries/ideas.ts`, `src/stores/ideas.ts`, `src/app/ideas/` |
| **Gastos** | Gastos: amount, descripción, categoría, fecha. | tabla `gastos`, `src/app/gastos.tsx` |
| **Tareas** | Tareas: título, due_date, prioridad, status. | tabla `tareas`, `src/app/tareas.tsx` |
| **Hábitos** | Hábito por día: `habit_name`, status, fecha. | tabla `habitos_log`, `src/app/habitos.tsx` |
| **Sueño** | Registro de sueño: hours, deep_sleep_percentage, quality, fecha. | tabla `sueno_log`, `src/app/sueno.tsx` |
| **Tags** | Etiquetas many-to-many vía `tags` + `note_tags`. Filtrables en lista. | `src/db/queries/tags.ts`, `src/stores/tags.ts` |
| **RouteType** | Output del LLM: `nota` \| `gasto` \| `tarea` \| `habito` \| `sueno`. | `src/services/llm.ts` |
| **dispatchRoutedResult** | INSERT en la tabla correcta según `RouteType`. | `src/db/index.tsx:436-537` |
| **FTS5** | Búsqueda full-text SQLite, tokenizer `porter unicode61`, ranking `bm25`. | tabla `notes_fts` + triggers |
| **MarkdownToolbar** | Toolbar inline del editor (bold, italic, headers, code, link, checklist). | `src/components/MarkdownToolbar.tsx` |
| **AutoSaveDot** | Indicador de guardado: naranja pulsante = dirty, verde estático = saved. | `src/components/AutoSaveDot.tsx` |
| **CaptureModal** | Modal de captura rápida (sin tematizar todavía — ver §12). | `src/components/CaptureModal.tsx` |
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
| 1 | **Drift de timestamps** | Notas legacy: `Date.now()` (ms). Notas v1: `unixepoch()` (s). Documentado en `src/db/queries/notes.ts:6`. |
| 2 | **SecureStore en web** | `getLLMConfig()` lanza en `SecureStore.*` si la plataforma es web. LLM no usable desde navegador. |
| 3 | **Pantallas básicas** | `habitos.tsx`, `sueno.tsx` son listas con CRUD limitado en UI. El CRUD real entra vía pipeline LLM. `gastos.tsx` y `tareas.tsx` SÍ tienen CRUD completo en UI. |
| 4 | **CaptureModal** | `src/components/CaptureModal.tsx` usa `useTheme()`. Ya no tiene colores hardcoded. |
| 5 | **Sin test infra** | Cualquier cambio queda sin verificar automáticamente. Si añades, usa `jest-preset-expo`. |
| 6 | **Mutex en `processPendingInbox`** | `_batchInFlight` global. Tests que disparen batches deben drainar el lock o usar `processInboxItem()` directo. |
| 7 | **Tabs nativos iOS-only** | `unstable-native-tabs` solo aplica en iOS. Android/web caen a render alternativo. |
| 8 | **`react-native-reanimated` 4 API** | `useAnimatedGestureHandler` eliminado. Usa `Gesture.Pan()` + worklets. |
| 9 | **`react-compiler` experimental** | Hooks pueden comportarse de forma no intuitiva. Si ves algo raro, comprueba que el compilador no esté optimizando mal. |
| 10 | **`NoteSpacing['2xl']`** | Único spacing token nuevo (48px). Notación con bracket por TS. |
| 11 | **Sin scripts `test`/`build`/`typecheck`** | Usa `npx tsc --noEmit` directamente. No hay `npm run build`. |
| 12 | **`react-native-web` ~0.21.0** | Versión mayor del bundler web; algunas APIs nativas no shimmean (ej. SecureStore). |

### Comentarios que merecen respeto

- `// ponytail:` en código → marca simplificación deliberada. Léelo antes de
  "mejorar" esa función.
- `// I1`, `// I2` en `src/services/inbox.ts` → invariantes duras. No se
  negocian.
- Cambia `// ponytail:` por su upgrade path *solo* cuando la métrica que
  nombra (throughput, latencia, etc.) realmente lo justifique.

---

## 13. Mapa de archivos clave

Qualified names para `codebase-memory` (`codebase-memory_search_graph`,
`codebase-memory_trace_path`).

| Qualified name | Archivo | Propósito |
|------|-----------|-----------|
| `CoreOS.src.app._layout.TabLayout` | `src/app/_layout.tsx` | Root layout, init app |
| `CoreOS.src.app.HomeScreen` | `src/app/index.tsx` | Hub home |
| `CoreOS.src.app.notas.NotesListScreen` | `src/app/notas/index.tsx` | Lista notas + búsqueda + tags |
| `CoreOS.src.app.notas.[id].NoteDetailScreen` | `src/app/notas/[id].tsx` | Detalle nota |
| `CoreOS.src.app.notas.new.NewNoteScreen` | `src/app/notas/new.tsx` | Editor nueva nota |
| `CoreOS.src.app.notas.[id].edit.NoteEditorScreen` | `src/app/notas/[id]/edit.tsx` | Editor edición |
| `CoreOS.src.app.ideas.IdeasInboxScreen` | `src/app/ideas/index.tsx` | Inbox ideas (3 estados) |
| `CoreOS.src.app.gastos.GastosScreen` | `src/app/gastos.tsx` | Lista gastos |
| `CoreOS.src.app.tareas.TareasScreen` | `src/app/tareas.tsx` | Lista tareas |
| `CoreOS.src.app.habitos.HabitosScreen` | `src/app/habitos.tsx` | Lista hábitos |
| `CoreOS.src.app.sueno.SuenoScreen` | `src/app/sueno.tsx` | Lista sueño |
| `CoreOS.src.app.ajustes.AjustesScreen` | `src/app/ajustes.tsx` | Ajustes |
| `CoreOS.src.components.app-tabs.AppTabs` | `src/components/app-tabs.tsx` | NativeTabs bar (7 entradas) |
| `CoreOS.src.db.getDb` | `src/db/index.tsx` | Singleton SQLite (hotspot, fan-in 31) |
| `CoreOS.src.db.initDb` | `src/db/index.tsx` | Init DB + migrations |
| `CoreOS.src.db.dispatchRoutedResult` | `src/db/index.tsx:436-537` | Dispatcher LLM → INSERT |
| `CoreOS.src.db.queries.notes.getSections` | `src/db/queries/notes.ts` | Query compleja notas por sección |
| `CoreOS.src.db.queries.notes.searchNotes` | `src/db/queries/notes.ts` | Búsqueda FTS5 |
| `CoreOS.src.db.queries.ideas.convertIdeaToNote` | `src/db/queries/ideas.ts` | Idea → Nota |
| `CoreOS.src.db.queries.tags.listTags` | `src/db/queries/tags.ts` | Listado tags con conteo |
| `CoreOS.src.services.llm.processInboxText` | `src/services/llm.ts` | Llamada API LLM |
| `CoreOS.src.services.inbox.processInboxItem` | `src/services/inbox.ts` | Pipeline un ítem |
| `CoreOS.src.services.inbox.processPendingInbox` | `src/services/inbox.ts` | Batch con mutex módulo |
| `CoreOS.src.stores.notes.useNotesStore` | `src/stores/notes.ts` | Store Zustand notas |
| `CoreOS.src.stores.ideas.useIdeasStore` | `src/stores/ideas.ts` | Store Zustand ideas |
| `CoreOS.src.stores.tags.useTagsStore` | `src/stores/tags.ts` | Store Zustand tags |
| `CoreOS.src.stores.ui.useUiStore` | `src/stores/ui.ts` | Store UI |
| `CoreOS.src.hooks.use-theme.useTheme` | `src/hooks/use-theme.ts` | Tema (hotspot, fan-in 31) |
| `CoreOS.src.constants.theme.Colors` | `src/constants/theme.ts` | Tokens tema |
| `CoreOS.src.lib.animations.animations` | `src/lib/animations.ts` | Presets Reanimated + haptics |

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
