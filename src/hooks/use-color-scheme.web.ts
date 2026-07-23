import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Suscripción vacía: useSyncExternalStore como señal de hidratación SSR/cliente.
// Devuelve false en server snapshot, true en client snapshot.
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Para soporte de static rendering en web, este valor se rehidrata en cliente.
 * useSyncExternalStore evita el set-state-in-effect del patrón useEffect clásico.
 */
export function useColorScheme() {
  const colorScheme = useRNColorScheme();
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  return hydrated ? (colorScheme ?? 'light') : 'light';
}
