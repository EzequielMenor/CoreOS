import { pickLibraryView } from '../library-view';

describe('pickLibraryView', () => {
  // `searchMode` llega ya podado por la pantalla (`query.trim().length > 0`), así que
  // un query de solo espacios entra acá como false.
  it.each([
    ['searching while a filter is active', true, [], 'search'],
    ['searching with no filter active', true, null, 'search'],
    ['no search with an empty filtered result', false, [], 'filtered'],
    ['no search with no filter active', false, null, 'browse'],
  ])('%s', (_name, searchMode, filteredNotes, expected) => {
    expect(pickLibraryView(searchMode, filteredNotes)).toBe(expected);
  });
});
