import { create } from 'zustand';
import * as notesRepo from '@/db/queries/notes';
import type {
  CreateNoteInput,
  Note,
  Sections,
  UpdateNoteInput,
} from '@/db/queries/notes';

interface NotesState {
  sections: Sections;
  searchResults: Note[];
  searchQuery: string;
  selectedTagIds: number[];
  loading: boolean;
  error: string | null;

  fetchSections: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  toggleTagFilter: (tagId: number) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<number>;
  updateNote: (id: number, patch: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  restoreNote: (id: number) => Promise<void>;
  pinNote: (id: number, pinned: boolean) => Promise<void>;
}

const MOCK_MODE = false;

const nowSec = Math.floor(Date.now() / 1000);
const DAY_SEC = 86400;

const MOCK_SECTIONS: Sections = {
  pinned: [
    {
      id: 1,
      title: 'Principios de arquitectura limpia',
      body_md: '## Reglas principales\n- Separación de responsabilidades\n- Independencia de frameworks\n- Facilidad de pruebas unitarias',
      status: 'active',
      pinned: 1,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 5,
      updated_at: nowSec - DAY_SEC * 1,
      deleted_at: null,
      tags: ['arquitectura', 'aprendizaje'],
    },
    {
      id: 2,
      title: 'Ideas para CoreOS v2',
      body_md: '## Roadmap v2\n- Integración con modelos locales (LLM)\n- Sincronización P2P cifrada\n- Soporte para widgets dinámicos',
      status: 'active',
      pinned: 1,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 3,
      updated_at: nowSec - 3600,
      deleted_at: null,
      tags: ['proyecto', 'react-native'],
    },
  ],
  today: [
    {
      id: 3,
      title: 'Reunión de equipo - Sync semanal',
      body_md: '### Puntos a tratar\n1. Estado del módulo de notas\n2. Optimización de rendimiento FTS5\n3. Siguiente sprint',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - 7200,
      updated_at: nowSec - 3600,
      deleted_at: null,
      tags: ['proyecto', 'personal'],
    },
    {
      id: 4,
      title: 'Refactorización del Store de Notas',
      body_md: 'Inyectar modo MOCK_MODE para pruebas visuales en React Native sin dependencia de SQLite directo.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - 3600,
      updated_at: nowSec - 1800,
      deleted_at: null,
      tags: ['react-native', 'arquitectura'],
    },
    {
      id: 5,
      title: 'Lista de compras y tareas',
      body_md: '- Comprar cable USB-C\n- Revisar documentación de Expo SQLite\n- Configurar variables de entorno',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - 1800,
      updated_at: nowSec - 900,
      deleted_at: null,
      tags: ['personal'],
    },
  ],
  yesterday: [
    {
      id: 6,
      title: 'Investigación sobre Zustand y React Native',
      body_md: 'Evaluar el uso de middleware para persistencia local y sincronización de estado global.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC - 7200,
      updated_at: nowSec - DAY_SEC - 3600,
      deleted_at: null,
      tags: ['react-native', 'aprendizaje'],
    },
    {
      id: 7,
      title: 'Notas sobre optimización de imágenes',
      body_md: 'Usar formatos WebP y caching eficiente para reducir el uso de memoria en UI.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC - 3600,
      updated_at: nowSec - DAY_SEC - 1800,
      deleted_at: null,
      tags: ['arquitectura'],
    },
  ],
  thisWeek: [
    {
      id: 8,
      title: 'Diseño de la interfaz del sistema',
      body_md: 'Definir paleta de colores oscuros/claros y componentes reutilizables con StyleSheet.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 3,
      updated_at: nowSec - DAY_SEC * 3,
      deleted_at: null,
      tags: ['react-native', 'proyecto'],
    },
    {
      id: 9,
      title: 'Guía de estilo y buenas prácticas',
      body_md: 'Recomendaciones de TypeScript, estandarización de imports y nombrado de funciones.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 4,
      updated_at: nowSec - DAY_SEC * 4,
      deleted_at: null,
      tags: ['aprendizaje'],
    },
    {
      id: 10,
      title: 'Estrategia de respaldo de datos',
      body_md: 'Exportación periódica a archivos JSON/Markdown cifrados.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 5,
      updated_at: nowSec - DAY_SEC * 5,
      deleted_at: null,
      tags: ['arquitectura', 'proyecto'],
    },
  ],
  earlier: [
    {
      id: 11,
      title: 'Inicio del proyecto CoreOS',
      body_md: '# CoreOS\nPrimer borrador del sistema operativo personal y centro de control.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 15,
      updated_at: nowSec - DAY_SEC * 15,
      deleted_at: null,
      tags: ['proyecto'],
    },
    {
      id: 12,
      title: 'Recopilación de recursos de aprendizaje',
      body_md: 'Links y libros recomendados sobre patrones de diseño e ingeniería de software.',
      status: 'active',
      pinned: 0,
      parent_id: null,
      created_at: nowSec - DAY_SEC * 30,
      updated_at: nowSec - DAY_SEC * 20,
      deleted_at: null,
      tags: ['aprendizaje', 'personal'],
    },
  ],
};

const EMPTY_SECTIONS: Sections = {
  pinned: [],
  today: [],
  yesterday: [],
  thisWeek: [],
  earlier: [],
};

function setError(error: string | null): { error: string | null } {
  console.error('[useNotesStore]', error);
  return { error };
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  sections: MOCK_MODE ? MOCK_SECTIONS : EMPTY_SECTIONS,
  searchResults: [],
  searchQuery: '',
  selectedTagIds: [],
  loading: false,
  error: null,

  fetchSections: async () => {
    if (MOCK_MODE) return;
    set({ loading: true, error: null });
    try {
      const ids = get().selectedTagIds;
      const tagFilter = ids.length > 0 ? ids : null;
      const sections = await notesRepo.getSections(tagFilter);
      set({ sections, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchSections failed'),
        loading: false,
      });
    }
  },

  search: async (query) => {
    set({ searchQuery: query, error: null });
    const trimmed = query.trim();
    if (!trimmed) {
      set({ searchResults: [] });
      return;
    }
    set({ loading: true });
    try {
      const results = await notesRepo.searchNotes(trimmed);
      set({ searchResults: results, loading: false });
    } catch (e) {
      set({
        searchResults: [],
        loading: false,
        ...setError(e instanceof Error ? e.message : 'search failed'),
      });
    }
  },

  clearSearch: () => set({ searchResults: [], searchQuery: '' }),

  toggleTagFilter: async (tagId) => {
    const current = get().selectedTagIds;
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    set({ selectedTagIds: next });
    await get().fetchSections();
  },

  createNote: async (input) => {
    try {
      const id = await notesRepo.createNote(input);
      await get().fetchSections();
      return id;
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createNote failed'));
      throw e;
    }
  },

  updateNote: async (id, patch) => {
    try {
      await notesRepo.updateNote(id, patch);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'updateNote failed'));
      throw e;
    }
  },

  deleteNote: async (id) => {
    try {
      await notesRepo.deleteNote(id);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'deleteNote failed'));
      throw e;
    }
  },

  restoreNote: async (id) => {
    try {
      await notesRepo.restoreNote(id);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'restoreNote failed'));
      throw e;
    }
  },

  pinNote: async (id, pinned) => {
    try {
      await notesRepo.pinNote(id, pinned);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'pinNote failed'));
      throw e;
    }
  },
}));
