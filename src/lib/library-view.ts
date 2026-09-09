import type { Note } from '@/db/queries/notes';

export type LibraryView = 'search' | 'filtered' | 'browse';

// Mientras el usuario escribe, el resultado de búsqueda debe permanecer en pantalla,
// aunque haya un filtro de sección o colección activo.
export function pickLibraryView(
  searchMode: boolean,
  filteredNotes: Note[] | null,
): LibraryView {
  if (searchMode) return 'search';
  if (filteredNotes !== null) return 'filtered';
  return 'browse';
}
