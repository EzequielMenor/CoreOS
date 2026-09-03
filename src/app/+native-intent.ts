// Intercepta share intents iOS y los redirige al handler /capture-share.
// Cualquier otra URL pasa inalterada.
export default async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  try {
    if (new URL(path).hostname === 'expo-sharing') return '/capture-share';
  } catch {
    // path no parseable como URL → no es share intent
  }
  return path;
}
