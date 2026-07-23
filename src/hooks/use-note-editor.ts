/**
 * useNoteEditor — hook compartido por new.tsx y [id]/edit.tsx.
 *
 * Sustituye el editor duplicado de notas. Maneja:
 *  - Estado `content` (lienzo único multilínea) + `tagNames`.
 *  - Autoguardado con debounce + flush on AppState/blur.
 *  - Guardia ref-backed (`savingRef`) para evitar creates/update concurrentes.
 *  - Persistencia del id en `noteIdRef` + `noteId` (no navegar tras crear).
 *  - Split title/body en flushSave; primera línea no vacía => title.
 *
 * Modos:
 *  - new  → sin `existingNoteId`. Primera escritura crea la nota; id persiste en ref.
 *  - edit → con `existingNoteId` + `loadNote`. Carga inicial vía DB, luego solo update.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Toast from 'react-native-toast-message';

import type { MarkdownFormatAction } from '@/components/MarkdownToolbar';
import type {
  CreateNoteInput,
  UpdateNoteInput,
} from '@/db/queries/notes';
import { haptic } from '@/lib/animations';

const AUTO_SAVE_DEBOUNCE_MS = 3000;

export interface NoteContent {
  title: string;
  body_md: string;
  tags: string[];
}

export interface UseNoteEditorOptions {
  /** Crea una nota nueva. Obligatorio en modo new. */
  onCreateNote?: (input: CreateNoteInput) => Promise<number>;
  /** Actualiza una nota existente. Obligatorio en modo edit. */
  onUpdateNote?: (id: number, patch: UpdateNoteInput) => Promise<void>;
  /** Crea un tag nuevo on-the-fly desde el picker. */
  onCreateTag?: (name: string) => Promise<void>;
  /** Si se define, el hook opera en modo edit y carga la nota al montar. */
  existingNoteId?: number;
  /** Loader para modo edit. Devuelve null si la nota no existe. */
  loadNote?: (id: number) => Promise<NoteContent | null>;
}

export interface UseNoteEditorResult {
  content: string;
  tagNames: string[];
  selection: { start: number; end: number };
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  dirty: boolean;
  lastSavedAt: number | null;
  loading: boolean;
  notFound: boolean;
  noteId: number | null;
  handleContentChange: (next: string) => void;
  handleSelectionChange: (next: { start: number; end: number }) => void;
  handleFormat: (action: MarkdownFormatAction) => void;
  handleTagChange: (next: string[]) => void;
  handleRemoveTag: (name: string) => void;
  handleCreateTag: (name: string) => Promise<void>;
  handleSavePress: () => void;
}

// ponytail: contrato — `text.split('\n')`, primera línea no vacía => title,
// resto => `split.slice(1).join('\n')`. Sin trim final: se preservan líneas
// vacías intencionales dentro del body (separadores visuales del usuario).
export function splitTitleBody(content: string): {
  title: string;
  body_md: string;
} {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length > 0) {
      const title = lines[i];
      const body = lines.slice(i + 1).join('\n');
      return { title, body_md: body };
    }
  }
  return { title: '', body_md: '' };
}

// ponytail: round-trip estable para notas con title no vacío. Para notas con
// title='' y body_md no vacío, el editor mantiene un flag `legacyEmptyTitle`
// (ver useNoteEditor.loadNote) y escribe `title=''` directamente sin pasar
// por esta función — así evitamos la colisión "primera línea del body =>
// title" que rompe notas heredadas del dispatcher LLM / convertIdeaToNote.
export function joinTitleBody(title: string, body_md: string): string {
  if (!title) return body_md;
  if (!body_md) return title;
  return `${title}\n${body_md}`;
}

type FormatTokens = { prefix: string; suffix?: string; placeholder: string };

const FORMAT_TOKENS: Record<MarkdownFormatAction, FormatTokens> = {
  bold: { prefix: '**', suffix: '**', placeholder: 'negrita' },
  italic: { prefix: '_', suffix: '_', placeholder: 'cursiva' },
  h1: { prefix: '# ', placeholder: 'Encabezado' },
  h2: { prefix: '## ', placeholder: 'Subtítulo' },
  code: { prefix: '`', suffix: '`', placeholder: 'código' },
  link: { prefix: '[', suffix: '](https://)', placeholder: 'texto' },
  checklist: { prefix: '- [ ] ', placeholder: 'tarea' },
};

function applyFormat(
  text: string,
  selection: { start: number; end: number },
  action: MarkdownFormatAction,
): { text: string; cursor: number } {
  const { prefix, suffix, placeholder } = FORMAT_TOKENS[action];
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const middle = selected.length > 0 ? selected : placeholder;
  const next = `${before}${prefix}${middle}${suffix ?? ''}${after}`;
  const cursor = (before + prefix + middle).length;
  return { text: next, cursor };
}

export function useNoteEditor(opts: UseNoteEditorOptions): UseNoteEditorResult {
  const { existingNoteId, loadNote } = opts;

  const [content, setContent] = useState('');
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(
    existingNoteId != null && Number.isFinite(existingNoteId) && existingNoteId > 0,
  );
  const [notFound, setNotFound] = useState(false);
  const [noteId, setNoteId] = useState<number | null>(
    existingNoteId != null && Number.isFinite(existingNoteId) && existingNoteId > 0
      ? existingNoteId
      : null,
  );

  // ponytail: refs siempre al día para callbacks no-React (AppState, blur)
  // y para la guardia contra creates/update concurrentes.
  const contentRef = useRef(content);
  const tagNamesRef = useRef(tagNames);
  const dirtyRef = useRef(false);
  const noteIdRef = useRef<number | null>(noteId);
  const savingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ponytail: flag para round-trip estable de notas legacy con title='' y
  // body_md no vacío (creadas por convertIdeaToNote / dispatchRoutedResult).
  // Mientras esté a true, flushSave conserva title='' y vuelca contentRef a
  // body_md sin pasar por splitTitleBody. Se libera en el primer markDirty.
  const legacyEmptyTitleRef = useRef(false);
  // ponytail: useRef(opts) inicializa con los callbacks del primer render,
  // que son los mismos que pasan en renders siguientes (selectors Zustand
  // estables + loadNote con useCallback([], ...)). No requiere useEffect de
  // sincronización: evita lint react-hooks/exhaustive-deps y mantiene la
  // identidad de flushSave / scheduleSave / markDirty estable.
  const optsRef = useRef(opts);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  useEffect(() => {
    tagNamesRef.current = tagNames;
  }, [tagNames]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  // Carga inicial en modo edit.
  useEffect(() => {
    if (existingNoteId == null || !loadNote) {
      return;
    }
    if (!Number.isFinite(existingNoteId) || existingNoteId <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotFound(true);
      return;
    }
    let active = true;
    setLoading(true);
    setNotFound(false);
    loadNote(existingNoteId)
      .then((fetched) => {
        if (!active) return;
        if (!fetched) {
          setNotFound(true);
          return;
        }
        // ponytail: si la nota heredada tiene title='' y body_md no vacío,
        // cargamos body directo en el editor y marcamos legacyEmptyTitleRef
        // para preservar title='' al guardar hasta que el usuario edite.
        if (!fetched.title && fetched.body_md) {
          setContent(fetched.body_md);
          legacyEmptyTitleRef.current = true;
        } else {
          setContent(joinTitleBody(fetched.title, fetched.body_md));
          legacyEmptyTitleRef.current = false;
        }
        setTagNames(fetched.tags);
      })
      .catch((error: unknown) => {
        console.error('[useNoteEditor] loadNote failed', error);
        if (!active) return;
        setNotFound(true);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [existingNoteId, loadNote]);

  const flushSave = useCallback(async () => {
    // ponytail: guardia ref-backed. Evita doble create si AppState + setTimeout
    // o dos focus blurs disparan flushSave concurrentemente.
    if (savingRef.current) return;
    if (!dirtyRef.current) return;

    // ponytail: notas heredadas con title='' y body_md no vacío se preservan
    // tal cual mientras el usuario no edite. Tras la primera edición,
    // markDirty libera el flag y entramos en el camino normal de splitTitleBody.
    const snap = legacyEmptyTitleRef.current
      ? { title: '', body_md: contentRef.current }
      : splitTitleBody(contentRef.current);
    const snapTags = tagNamesRef.current;

    if (!snap.title && !snap.body_md && snapTags.length === 0) {
      // Nada que guardar todavía — no crees nota vacía.
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    setDirty(false);

    const currentId = noteIdRef.current;
    try {
      if (currentId == null) {
        const { onCreateNote } = optsRef.current;
        if (!onCreateNote) return;
        const id = await onCreateNote({
          title: snap.title,
          body_md: snap.body_md,
          status: 'active',
          tagNames: snapTags,
        });
        noteIdRef.current = id;
        setNoteId(id);
        setLastSavedAt(Math.floor(Date.now() / 1000));
        void haptic.tap.light();
      } else {
        const { onUpdateNote } = optsRef.current;
        if (!onUpdateNote) return;
        await onUpdateNote(currentId, {
          title: snap.title,
          body_md: snap.body_md,
          tagNames: snapTags,
        });
        setLastSavedAt(Math.floor(Date.now() / 1000));
        void haptic.tap.light();
      }
    } catch (error) {
      dirtyRef.current = true;
      setDirty(true);
      console.error('[useNoteEditor] save failed', error);
      Toast.show({
        type: 'error',
        text1: currentId == null ? 'No se pudo crear la nota' : 'No se pudo guardar',
        text2: 'Reintentaremos en la próxima edición.',
        visibilityTime: 4000,
      });
    } finally {
      savingRef.current = false;
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flushSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Flush on background / inactive.
  useEffect(() => {
    const handler = (status: AppStateStatus) => {
      if (status === 'background' || status === 'inactive') {
        void flushSave();
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => {
      sub.remove();
    };
  }, [flushSave]);

  // Flush on route blur.
  useFocusEffect(
    useCallback(
      () => () => {
        void flushSave();
      },
      [flushSave],
    ),
  );

  // Limpia el timeout pendiente al desmontar.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const markDirty = useCallback(() => {
    // ponytail: el usuario está editando; soltamos el flag legacy para que
    // splitTitleBody normal se aplique en el próximo flushSave.
    legacyEmptyTitleRef.current = false;
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirty(true);
    }
    scheduleSave();
  }, [scheduleSave]);

  const handleContentChange = useCallback(
    (next: string) => {
      setContent(next);
      markDirty();
    },
    [markDirty],
  );

  const handleSelectionChange = useCallback(
    (next: { start: number; end: number }) => {
      setSelection(next);
    },
    [],
  );

  const handleFormat = useCallback(
    (action: MarkdownFormatAction) => {
      setContent((current) => {
        const result = applyFormat(current, selection, action);
        queueMicrotask(() => {
          setSelection({ start: result.cursor, end: result.cursor });
        });
        return result.text;
      });
      markDirty();
    },
    [selection, markDirty],
  );

  const handleTagChange = useCallback(
    (next: string[]) => {
      setTagNames(next);
      markDirty();
    },
    [markDirty],
  );

  const handleRemoveTag = useCallback(
    (name: string) => {
      void haptic.tap.light();
      setTagNames((current) => current.filter((n) => n !== name));
      markDirty();
    },
    [markDirty],
  );

  const handleCreateTag = useCallback(
    async (name: string) => {
      const { onCreateTag } = optsRef.current;
      if (!onCreateTag) return;
      try {
        await onCreateTag(name);
        // ponytail: actualizar estado local SOLO tras confirmar persistencia.
        // Si onCreateTag lanza, el UI queda sincronizado con la DB (tag no
        // aparece en la barra ni se vuelve a autoseleccionar al reabrir).
        setTagNames((current) =>
          current.includes(name) ? current : [...current, name],
        );
        markDirty();
      } catch (error) {
        console.error('[useNoteEditor] createTag failed', error);
        Toast.show({
          type: 'error',
          text1: 'No se pudo crear el tag',
          text2: 'Inténtalo de nuevo.',
          visibilityTime: 4000,
        });
      }
    },
    [markDirty],
  );

  const handleSavePress = useCallback(async () => {
    Keyboard.dismiss();
    void haptic.notify.success();
    if (dirtyRef.current) {
      await flushSave();
    } else if (noteIdRef.current != null || contentRef.current.trim().length > 0) {
      setLastSavedAt(Math.floor(Date.now() / 1000));
    }
  }, [flushSave]);

  return {
    content,
    tagNames,
    selection,
    pickerOpen,
    setPickerOpen,
    dirty,
    lastSavedAt,
    loading,
    notFound,
    noteId,
    handleContentChange,
    handleSelectionChange,
    handleFormat,
    handleTagChange,
    handleRemoveTag,
    handleCreateTag,
    handleSavePress,
  };
}
